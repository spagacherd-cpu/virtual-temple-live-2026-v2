// usage: node tools/loadtest.mjs <url> <bots> [seconds]
import { io } from 'socket.io-client';
const [url = 'http://localhost:3000', N = '100', secs = '60'] = process.argv.slice(2);
let connected = 0, snaps = 0, lat = [];
for (let i = 0; i < +N; i++) setTimeout(() => {
  const s = io(url, { transports: ['websocket'], reconnection: false });
  let x = (Math.random() - 0.5) * 20, z = 8 + Math.random() * 10, a = Math.random() * 6.28;
  s.on('connect', () => { connected++; s.emit('join', { token: 'bot-' + i + '-' + Date.now(), name: 'bot' + i, gender: i % 2 ? 'male' : 'female', outfit: 'white' }); });
  s.on('welcome', w => { x = w.x; z = w.z; });
  s.on('snap', () => snaps++);
  s.on('disconnect', () => connected--);
  setInterval(() => { a += (Math.random() - 0.5) * 0.6; x += Math.cos(a) * 0.32; z += Math.sin(a) * 0.32; s.emit('move', { x, z, r: a, m: 1 }); }, 100);
  setInterval(() => { const t = Date.now(); s.emit('pingt', t, () => lat.push(Date.now() - t)); }, 2000);
}, (i * 1000) / 50); // ramp ~50 bots/s
const t0 = Date.now();
const rep = setInterval(() => {
  lat.sort((a, b) => a - b);
  console.log(`t=${Math.round((Date.now() - t0) / 1000)}s connected=${connected} snaps/s=${Math.round(snaps / 5)} p50=${lat[lat.length >> 1] ?? '-'}ms p95=${lat[Math.floor(lat.length * 0.95)] ?? '-'}ms`);
  snaps = 0; lat = [];
}, 5000);
setTimeout(() => { clearInterval(rep); process.exit(0); }, (+secs + +N / 50) * 1000);
