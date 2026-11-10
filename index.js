import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 3000;
const log = (lvl, msg, extra = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), lvl, msg, ...extra }));

// world rules (server-authoritative)
const B = { halfX: 28, minZ: -9, maxZ: 30 };
const SPEED = 3.2, TICK_MS = 100, GRACE_MS = 20000, CELL = 12, AOI_CAP = 40;
const POSES = ['idle', 'sit', 'bow'], GENDERS = ['male', 'female'], OUTFITS = ['thai', 'white', 'cream'];

const players = new Map(); // id -> player
const byToken = new Map(); // token -> player (survives reconnect for GRACE_MS)
let seq = 0;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const r2 = v => Math.round(v * 100) / 100;
const cleanName = s => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'ผู้ศรัทธา';
const online = () => { let n = 0; for (const p of players.values()) if (p.socket) n++; return n; };

const app = express();
app.disable('x-powered-by');
app.get('/healthz', (_q, res) => res.json({ ok: true, online: online(), tracked: players.size, uptime: Math.round(process.uptime()) }));
app.use(express.static(__dirname, { maxAge: '1h' }));
app.use((err, _q, res, _n) => { log('error', 'http', { err: err.message }); res.status(500).end(); });

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 2048, pingInterval: 10000, pingTimeout: 15000,
  cors: process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(',') } : undefined,
});

io.on('connection', socket => {
  let n = 0, windowStart = Date.now();
  const allow = () => { // per-socket flood guard
    const t = Date.now();
    if (t - windowStart >= 1000) { windowStart = t; n = 0; }
    if (++n > 120) { log('warn', 'flood-disconnect', { sid: socket.id }); socket.disconnect(true); return false; }
    return n <= 40;
  };

  socket.on('join', raw => {
    if (!allow() || !raw || typeof raw !== 'object') return;
    const token = typeof raw.token === 'string' && /^[\w-]{8,64}$/.test(raw.token) ? raw.token : null;
    const gender = GENDERS.includes(raw.gender) ? raw.gender : null;
    const outfit = OUTFITS.includes(raw.outfit) ? raw.outfit : null;
    if (!token || !gender || !outfit) return;
    let p = byToken.get(token);
    if (!p) {
      if (players.size >= MAX_PLAYERS) { socket.emit('full'); socket.disconnect(true); return; }
      p = { id: (++seq).toString(36) + Math.random().toString(36).slice(2, 6), token, x: (Math.random() - 0.5) * 6, z: 12, r: Math.PI, moving: 0, pose: 'idle', lastMove: Date.now() };
      players.set(p.id, p); byToken.set(token, p);
    } else if (p.socket && p.socket !== socket) p.socket.disconnect(true); // same player, new connection
    Object.assign(p, { name: cleanName(raw.name), gender, outfit, socket, known: new Set(), dropAt: 0, lastMove: Date.now() });
    socket.data.p = p;
    socket.emit('welcome', { id: p.id, x: p.x, z: p.z, r: p.r, pose: p.pose });
    log('info', 'join', { id: p.id, online: online() });
  });

  socket.on('move', m => {
    const p = socket.data.p;
    if (!allow() || !p || !m || p.pose !== 'idle' || !isNum(m.x) || !isNum(m.z) || !isNum(m.r)) return;
    const now = Date.now(), dt = Math.min((now - p.lastMove) / 1000, 1);
    p.lastMove = now;
    const x = clamp(m.x, -B.halfX, B.halfX), z = clamp(m.z, B.minZ, B.maxZ);
    if (Math.hypot(x - p.x, z - p.z) > SPEED * 1.6 * dt + 0.6) { socket.emit('correct', { x: p.x, z: p.z, r: p.r }); return; } // speed/teleport check
    p.x = x; p.z = z; p.r = clamp(m.r, -10, 10); p.moving = m.m ? 1 : 0;
  });

  socket.on('pose', v => {
    const p = socket.data.p;
    if (!allow() || !p || !POSES.includes(v)) return;
    if (p.pose === 'bow' && v === 'bow') return;
    p.pose = v; if (v !== 'idle') p.moving = 0;
  });

  socket.on('pingt', (t, cb) => { if (typeof cb === 'function') cb(t); }); // for load test latency

  socket.on('disconnect', () => {
    const p = socket.data.p;
    if (p && p.socket === socket) { p.socket = null; p.dropAt = Date.now() + GRACE_MS; p.moving = 0; }
  });
});

// ---- 10 Hz tick: area-of-interest snapshots (3x3 grid cells, nearest AOI_CAP players)
const cell = v => Math.floor(v / CELL), key = (cx, cz) => (cx + 50) * 100 + (cz + 50);
setInterval(() => {
  try {
    const now = Date.now(), grid = new Map();
    for (const p of players.values()) {
      if (!p.socket && now > p.dropAt) { players.delete(p.id); byToken.delete(p.token); continue; }
      const k = key(cell(p.x), cell(p.z));
      const a = grid.get(k); if (a) a.push(p); else grid.set(k, [p]);
    }
    for (const p of players.values()) {
      if (!p.socket) continue;
      const cx = cell(p.x), cz = cell(p.z), near = [];
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const a = grid.get(key(cx + dx, cz + dz)); if (!a) continue;
        for (const q of a) if (q !== p) near.push([(q.x - p.x) ** 2 + (q.z - p.z) ** 2, q]);
      }
      if (!near.length) continue;
      if (near.length > AOI_CAP) { near.sort((a, b) => a[0] - b[0]); near.length = AOI_CAP; }
      const rows = []; let meta;
      for (const [, q] of near) {
        rows.push([q.id, r2(q.x), r2(q.z), r2(q.r), q.moving, POSES.indexOf(q.pose)]);
        if (!p.known.has(q.id)) { p.known.add(q.id); (meta ??= {})[q.id] = [q.name, GENDERS.indexOf(q.gender), OUTFITS.indexOf(q.outfit)]; }
      }
      p.socket.volatile.emit('snap', meta ? { p: rows, m: meta } : { p: rows });
    }
  } catch (e) { log('error', 'tick', { err: String(e) }); }
}, TICK_MS);
setInterval(() => io.emit('count', online()), 1000);

server.listen(PORT, () => log('info', 'listening', { port: PORT }));
const stop = () => { log('info', 'shutdown'); io.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
process.on('uncaughtException', e => log('error', 'uncaught', { err: String(e) }));
process.on('unhandledRejection', e => log('error', 'unhandled', { err: String(e) }));
