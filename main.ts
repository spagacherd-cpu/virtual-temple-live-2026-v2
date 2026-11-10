import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildTemple, BOUNDS, BUDDHA_SPOT } from './temple';
import { Avatar, Gender, Outfit } from './avatar';
import { Net } from './net';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $('app');
const lowPower = /Android|iPhone|iPad/i.test(navigator.userAgent) || navigator.hardwareConcurrency <= 4;

const renderer = new THREE.WebGLRenderer({ antialias: !lowPower, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.5 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 9 / 16, 0.1, 400);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(540, 960), lowPower ? 0.45 : 0.7, 0.6, 0.85));
composer.addPass(new OutputPass());
const world = buildTemple(scene, lowPower);

function resize() { // fixed 9:16 stage, fitted to the screen (target 1080x1920)
  const h = innerHeight, w = Math.min(innerWidth, Math.round((h * 9) / 16));
  app.style.width = w + 'px'; app.style.height = h + 'px';
  renderer.setSize(w, h); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---- state
let me: Avatar | null = null;
let net: Net | null = null;
let infoText = '';
let camYaw = 0, camPitch = 0.35, camDist = 6.5;
let target: THREE.Vector3 | null = null;
const keys = new Set<string>();
const joy = { x: 0, y: 0 };

// ---- start screen
const sel = { gender: 'male' as Gender, outfit: 'thai' as Outfit };
for (const [id, key] of [['gender', 'gender'], ['outfit', 'outfit']] as const) {
  $(id).addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.opt') as HTMLElement | null;
    if (!b) return;
    $(id).querySelectorAll('.opt').forEach(o => o.classList.remove('on')); b.classList.add('on');
    (sel as Record<string, string>)[key] = b.dataset.v!;
  });
}
$('enter').addEventListener('click', () => {
  const name = ($<HTMLInputElement>('name').value.replace(/[<>]/g, '').trim() || 'ผู้ศรัทธา').slice(0, 16);
  me = new Avatar(name, sel.gender, sel.outfit);
  me.group.position.set(0, 0, 12); me.group.rotation.y = Math.PI;
  scene.add(me.group);
  net = new Net(scene, { name, gender: sel.gender, outfit: sel.outfit });
  net.onPlace = p => { me!.group.position.set(p.x, 0, p.z); me!.group.rotation.y = p.r; target = null; };
  me.onBowDone = () => net?.sendPose('sit');
  $('start').style.display = 'none'; $('hud').style.display = 'block';
  $('info').textContent = name;
});

// ---- actions
$('goBtn').onclick = () => { if (me?.canMove) target = BUDDHA_SPOT.clone().setZ(-1.5); };
$('sitBtn').onclick = () => { if (me && me.pose === 'idle') { me.setPose('sit'); net?.sendPose('sit'); } };
$('bowBtn').onclick = () => { if (me && me.pose !== 'bow') { me.setPose('bow'); net?.sendPose('bow'); } };
$('standBtn').onclick = () => { if (me) { me.setPose('idle'); net?.sendPose('idle'); } };

// ---- input: keyboard, joystick, camera drag/zoom
addEventListener('keydown', e => keys.add(e.key.toLowerCase()));
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
let drag: { id: number; x: number; y: number } | null = null;
renderer.domElement.addEventListener('pointerdown', e => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  camYaw -= (e.clientX - drag.x) * 0.006;
  camPitch = THREE.MathUtils.clamp(camPitch + (e.clientY - drag.y) * 0.004, 0.08, 1.2);
  drag.x = e.clientX; drag.y = e.clientY;
});
addEventListener('pointerup', () => { drag = null; });
renderer.domElement.addEventListener('wheel', e => { camDist = THREE.MathUtils.clamp(camDist + e.deltaY * 0.005, 3, 12); });

const joyEl = $('joy'), stick = $('stick');
let joyId = -1;
const joyMove = (e: PointerEvent) => {
  const r = joyEl.getBoundingClientRect();
  let dx = (e.clientX - (r.left + r.width / 2)) / 50, dy = (e.clientY - (r.top + r.height / 2)) / 50;
  const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
  joy.x = dx; joy.y = -dy; stick.style.transform = `translate(${dx * 35}px,${dy * 35}px)`;
};
joyEl.addEventListener('pointerdown', e => { joyId = e.pointerId; joyEl.setPointerCapture(e.pointerId); target = null; joyMove(e); e.stopPropagation(); });
joyEl.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyMove(e); });
const joyEnd = (e: PointerEvent) => { if (e.pointerId !== joyId) return; joyId = -1; joy.x = joy.y = 0; stick.style.transform = ''; };
joyEl.addEventListener('pointerup', joyEnd); joyEl.addEventListener('pointercancel', joyEnd);

// ---- loop
const SPEED = 3.2, clock = new THREE.Clock(), dir = new THREE.Vector3();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  if (me) {
    let ix = joy.x + (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    let iy = joy.y + (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    if (me.canMove && (ix || iy)) target = null;
    let moving = false;
    if (me.canMove) {
      if (target) { // auto-walk toward the Buddha
        dir.subVectors(target, me.group.position).setY(0);
        if (dir.length() < 0.15) { target = null; me.group.rotation.y = Math.PI; } else { dir.normalize(); ix = 0; iy = 0; moving = true; }
      } else if (ix || iy) {
        const l = Math.hypot(ix, iy), f = iy / Math.max(l, 1), r = ix / Math.max(l, 1);
        dir.set(-Math.sin(camYaw) * f + Math.cos(camYaw) * r, 0, -Math.cos(camYaw) * f - Math.sin(camYaw) * r); moving = true;
      }
      if (moving) {
        const p = me.group.position;
        p.x = THREE.MathUtils.clamp(p.x + dir.x * SPEED * dt, -BOUNDS.halfX, BOUNDS.halfX);
        p.z = THREE.MathUtils.clamp(p.z + dir.z * SPEED * dt, target ? -9 : BOUNDS.minZ, BOUNDS.maxZ);
        let da = Math.atan2(dir.x, dir.z) - me.group.rotation.y;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        me.group.rotation.y += da * (1 - Math.exp(-dt * 12));
      }
    }
    me.update(dt, moving);
    if (net) {
      net.sendState(me, moving, performance.now());
      const st = net.status === 'online' ? `ออนไลน์ ${net.online} คน` : net.status === 'full' ? 'วิหารเต็ม' : 'กำลังเชื่อมต่อใหม่…';
      const t = `${me.name} · ${st}`;
      if (t !== infoText) { infoText = t; $('info').textContent = t; }
    }
    const p = me.group.position, ch = me.pose === 'idle' ? 1.4 : 1.0;
    const want = new THREE.Vector3(
      p.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist,
      p.y + ch + Math.sin(camPitch) * camDist,
      p.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist);
    camera.position.lerp(want, 1 - Math.exp(-dt * 8));
    camera.lookAt(p.x, p.y + ch, p.z);
  } else { // title-screen orbit
    camera.position.set(Math.sin(t * 0.1) * 16, 6, 14); camera.lookAt(0, 4, -14);
  }
  net?.update(dt);
  world.update(dt, t);
  composer.render();
  requestAnimationFrame(loop);
}
loop();
