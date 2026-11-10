import { io, Socket } from 'socket.io-client';
import * as THREE from 'three';
import { Avatar, Gender, Outfit, Pose } from './avatar';

const POSES: Pose[] = ['idle', 'sit', 'bow'];
const GEN: Gender[] = ['male', 'female'];
const OUT: Outfit[] = ['thai', 'white', 'cream'];
type Row = [string, number, number, number, number, number];
interface Remote { av: Avatar; tx: number; tz: number; tr: number; moving: boolean; pose: Pose; seen: number }
export interface Placement { x: number; z: number; r: number }

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'u' + Math.random().toString(36).slice(2) + Date.now().toString(36));

export class Net {
  readonly socket: Socket;
  online = 0;
  status: 'connecting' | 'online' | 'reconnecting' | 'full' = 'connecting';
  onPlace?: (p: Placement) => void;
  private remotes = new Map<string, Remote>();
  private meta = new Map<string, [string, number, number]>();
  private lastSend = 0;
  private lastKey = '';

  constructor(private scene: THREE.Scene, profile: { name: string; gender: Gender; outfit: Outfit }) {
    let token = sessionStorage.getItem('vt-token');
    if (!token) { token = uid(); sessionStorage.setItem('vt-token', token); }
    this.socket = io({ reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 4000 });
    this.socket.on('connect', () => { this.status = 'online'; this.lastKey = ''; this.socket.emit('join', { token, ...profile }); });
    this.socket.on('disconnect', () => { this.status = 'reconnecting'; });
    this.socket.on('connect_error', () => { this.status = 'reconnecting'; });
    this.socket.on('full', () => { this.status = 'full'; });
    this.socket.on('count', (n: number) => { this.online = n; });
    this.socket.on('welcome', (w: Placement) => this.onPlace?.(w));
    this.socket.on('correct', (c: Placement) => this.onPlace?.(c));
    this.socket.on('snap', (s: { p: Row[]; m?: Record<string, [string, number, number]> }) => this.apply(s));
  }

  private apply(s: { p: Row[]; m?: Record<string, [string, number, number]> }) {
    if (s.m) for (const id in s.m) this.meta.set(id, s.m[id]);
    const now = performance.now();
    for (const [id, x, z, r, m, pi] of s.p) {
      let rem = this.remotes.get(id);
      if (!rem) {
        const mt = this.meta.get(id); if (!mt) continue;
        const av = new Avatar(mt[0], GEN[mt[1]] ?? 'male', OUT[mt[2]] ?? 'white');
        av.group.position.set(x, 0, z); av.group.rotation.y = r; this.scene.add(av.group);
        rem = { av, tx: x, tz: z, tr: r, moving: false, pose: 'idle', seen: now }; this.remotes.set(id, rem);
      }
      rem.tx = x; rem.tz = z; rem.tr = r; rem.moving = m === 1; rem.seen = now;
      const np = POSES[pi] ?? 'idle';
      if (np !== rem.pose) {
        rem.pose = np;
        if (!(np === 'sit' && rem.av.pose === 'bow')) rem.av.setPose(np); // don't cut a bow short
      }
    }
  }

  update(dt: number) {
    const now = performance.now(), k = 1 - Math.exp(-dt * 12);
    for (const [id, r] of this.remotes) {
      if (now - r.seen > 1500) { this.scene.remove(r.av.group); this.dispose(r.av.group); this.remotes.delete(id); continue; }
      const g = r.av.group;
      const moved = Math.hypot(r.tx - g.position.x, r.tz - g.position.z);
      g.position.x += (r.tx - g.position.x) * k; g.position.z += (r.tz - g.position.z) * k;
      let da = r.tr - g.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da)); g.rotation.y += da * k;
      r.av.update(dt, r.pose === 'idle' && (r.moving || moved > 0.05));
    }
  }

  sendState(me: Avatar, moving: boolean, now: number) {
    if (now - this.lastSend < 100 || this.status !== 'online') return;
    const p = me.group.position, key = `${p.x.toFixed(2)},${p.z.toFixed(2)},${me.group.rotation.y.toFixed(2)},${moving}`;
    if (key === this.lastKey) return;
    this.lastKey = key; this.lastSend = now;
    this.socket.emit('move', { x: p.x, z: p.z, r: me.group.rotation.y, m: moving ? 1 : 0 });
  }

  sendPose(p: Pose) { this.socket.emit('pose', p); }
  get remoteCount() { return this.remotes.size; }

  private dispose(o: THREE.Object3D) {
    o.traverse(c => {
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.SpriteMaterial | undefined;
      if (mat) { (mat as THREE.SpriteMaterial).map?.dispose(); mat.dispose(); }
    });
  }
}
