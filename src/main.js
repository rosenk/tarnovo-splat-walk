import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { buildTarnovo, centerX, groundY, HALF, Z_START, Z_END, GAP, SUN, TSAREVETS } from './tarnovo.js';
import { createLightingUniforms, lightingModifier } from './lighting.js';
import { createSky } from './sky.js';
import { createLeaves, createDust, createMoths } from './particles.js';
import { createPost } from './post.js';

const $ = (id) => document.getElementById(id);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const params = new URLSearchParams(location.search);
const quality = params.get('q') ?? 'auto';
renderer.setPixelRatio(quality === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NoToneMapping;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 5000);
camera.rotation.order = 'YXZ';

// LoD budget for loaded splat files: Spark's desktop default (2.5M) is too much
// for an integrated GPU, so draw at most ~1.2M at a time unless ?budget= or ?q=high.
const budget = Number(params.get('budget')) || (quality === 'high' ? undefined : 1_200_000);
const spark = new SparkRenderer({ renderer, apertureAngle: 0, focalDistance: 6, lodSplatCount: budget });
scene.add(spark);

const sky = createSky();
scene.add(sky.mesh);

const post = createPost(renderer, scene, camera);
post.setSize(window.innerWidth, window.innerHeight);

const U = createLightingUniforms();

// ------------------------------------------------------------------ state
const state = {
  tod: 0.05,          // 0 = afternoon, ~0.5 = golden hour, 1 = night
  cycle: false,
  autopilot: false,
  dof: true,
  aperture: 0.008,
  focal: 6,
  show: true,
  mode: 'tarnovo',    // or 'file'
  flip: true,
  hud: true,
  started: false,
};

let world = null;            // procedural Tarnovo
let fileMesh = null;         // user-loaded splat file
let fileMeta = null;         // optional sidecar: { coordinateSystem, vfov, start, tour }
const tarnovoGroup = new THREE.Group();
scene.add(tarnovoGroup);
let leaves, dust, moths;

// ------------------------------------------------------------------ controls
const controls = new PointerLockControls(camera, renderer.domElement);
const keys = new Set();
const vel = new THREE.Vector3();
let bobPhase = 0;
const autopilot = { s: 0, look: new THREE.Vector3(), fade: 0 };

function spawn() {
  const z = Z_START - 1.6;
  camera.position.set(centerX(z), groundY(z) + 1.62, z);
  camera.rotation.set(0.02, 0, 0);
}

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  keys.add(e.code);
  switch (e.code) {
    case 'KeyN': toggleCycle(); break;
    case 'KeyP': toggleAutopilot(); break;
    case 'KeyF': state.dof = !state.dof; syncButtons(); break;
    case 'KeyL': state.show = !state.show; syncButtons(); break;
    case 'KeyH': state.hud = !state.hud; document.body.classList.toggle('nohud', !state.hud); break;
    case 'KeyO': $('file').click(); break;
    case 'KeyU': if (fileMesh) { state.flip = !state.flip; applyFlip(); } break;
    case 'BracketLeft': state.tod = Math.max(0, state.tod - 0.02); break;
    case 'BracketRight': state.tod = Math.min(1, state.tod + 0.02); break;
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('wheel', (e) => {
  state.aperture = THREE.MathUtils.clamp(state.aperture * (e.deltaY > 0 ? 0.88 : 1.13), 0.002, 0.06);
  flash(`Бленда: ${(state.aperture * 1000).toFixed(0)} mrad`);
}, { passive: true });

renderer.domElement.addEventListener('click', () => {
  if (state.started && !state.autopilot) controls.lock();
});
controls.addEventListener('lock', () => document.body.classList.add('locked'));
controls.addEventListener('unlock', () => document.body.classList.remove('locked'));

function walk(dt) {
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = (run ? 3.8 : 1.7) * (state.mode === 'file' ? 0.8 : 1);
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const up = (keys.has('KeyE') || keys.has('Space') ? 1 : 0) - (keys.has('KeyQ') || keys.has('KeyC') ? 1 : 0);
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  if (state.mode !== 'file') fwd.y = 0;
  fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
  const want = new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(right, r);
  if (want.lengthSq() > 1) want.normalize();
  want.multiplyScalar(speed);
  if (state.mode === 'file') want.y += up * speed;
  vel.lerp(want, 1 - Math.exp(-dt * 8));
  const p = camera.position;
  p.addScaledVector(vel, dt);

  if (state.mode === 'tarnovo') {
    p.z = THREE.MathUtils.clamp(p.z, Z_END + 0.55, Z_START - 0.55);
    const c = centerX(p.z);
    p.x = THREE.MathUtils.clamp(p.x, c - HALF + 0.32, c + HALF - 0.32);
    for (const col of world.colliders) {
      const dx = p.x - col.x, dz = p.z - col.z;
      const d = Math.hypot(dx, dz);
      if (d < col.r && d > 1e-4) { p.x = col.x + (dx / d) * col.r; p.z = col.z + (dz / d) * col.r; }
    }
    const moving = Math.hypot(vel.x, vel.z);
    bobPhase += moving * dt * 5.2;
    const bob = Math.sin(bobPhase) * 0.035 * Math.min(1, moving);
    const targetY = groundY(p.z) + 1.62 + bob;
    p.y += (targetY - p.y) * (1 - Math.exp(-dt * 12));
  }
}

function drive(dt, t) {
  // cinematic stroll up the lane, pausing to look out at Tsarevets
  const inGap = (z) => smooth(GAP.zA + 3, GAP.zA - 1, z) * smooth(GAP.zB - 1.5, GAP.zB + 2.5, z);
  const zNow = Z_START - 1.6 - autopilot.s;
  const slow = 1 - 0.65 * inGap(zNow);
  autopilot.s += dt * 0.95 * slow;
  let z = Z_START - 1.6 - autopilot.s;
  if (z < Z_END + 2.2) { autopilot.s = 0; z = Z_START - 1.6; autopilot.look.set(0, 0, 0); }
  const x = centerX(z) + 0.55 * Math.sin(z * 0.19) + 0.6 * inGap(z);
  bobPhase += dt * 0.95 * slow * 5.2;
  const y = groundY(z) + 1.62 + Math.sin(bobPhase) * 0.025;
  camera.position.set(x, y, z);
  const ahead = new THREE.Vector3(centerX(z - 5) + Math.sin(t * 0.21) * 1.6, groundY(z - 5) + 1.9 + Math.sin(t * 0.37) * 0.5, z - 5);
  const view = new THREE.Vector3(TSAREVETS.x - TSAREVETS.rx * 0.4, 12, TSAREVETS.z + 10).sub(camera.position).normalize().multiplyScalar(5).add(camera.position);
  const target = ahead.lerp(view, inGap(z));
  if (autopilot.look.lengthSq() === 0) autopilot.look.copy(target);
  autopilot.look.lerp(target, 1 - Math.exp(-dt * 1.4));
  camera.lookAt(autopilot.look);
}

// Autopilot for a loaded Atlas scene: glide between the cameras Atlas generated
// (sidecar "tour"), pausing on the keys that have a hold time.
const tour = { i: 0, u: 0, hold: 0 };
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
function tourDrive(dt) {
  const P = fileMeta.tour;
  const at = (k) => P[k % P.length];
  _pa.fromArray(at(tour.i).position); _pb.fromArray(at(tour.i + 1).position);
  _qa.fromArray(at(tour.i).quaternion); _qb.fromArray(at(tour.i + 1).quaternion);
  if (tour.hold > 0) tour.hold -= dt;
  else {
    const dur = Math.max(1.6, _pa.distanceTo(_pb) / (fileMeta.speed ?? 0.75) + _qa.angleTo(_qb) / 0.4);
    tour.u += dt / dur;
    if (tour.u >= 1) {
      tour.u = 0;
      tour.i = (tour.i + 1) % P.length;
      tour.hold = at(tour.i).hold ?? 0.6;
      return tourDrive(0);
    }
  }
  const s = smooth(0, 1, tour.u);
  camera.position.lerpVectors(_pa, _pb, s);
  camera.quaternion.slerpQuaternions(_qa, _qb, s);
}

function applyFileCamera() {
  camera.fov = fileMeta?.vfov ? Math.min(60, fileMeta.vfov * 1.25) : 62;
  camera.updateProjectionMatrix();
  if (fileMeta?.start) {
    camera.position.fromArray(fileMeta.start.position);
    camera.quaternion.fromArray(fileMeta.start.quaternion);
  } else {
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
  }
}

// ------------------------------------------------------------------ autofocus
const ray = new THREE.Raycaster();
let frame = 0;
function autofocus(dt) {
  if (frame++ % 4 === 0) {
    ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    let d = 300;
    if (state.mode === 'tarnovo' && world) {
      const hits = ray.intersectObjects(world.focusProxies, false);
      if (hits.length) d = hits[0].distance;
    } else if (fileMesh) {
      // LoD meshes raycast against a coarse subset Spark refreshes every 0.5 s;
      // a miss (sky, or no subset yet) keeps the current focus instead of
      // racking to infinity and blurring everything nearby.
      const hits = ray.intersectObject(fileMesh, false);
      d = hits.length ? hits[0].distance : (autofocus.target ?? 8);
    }
    if (Number.isFinite(d)) autofocus.target = THREE.MathUtils.clamp(d, 0.4, 400);
  }
  const tgt = autofocus.target ?? 6;
  if (!Number.isFinite(state.focal) || state.focal <= 0) state.focal = tgt;
  // focus in log space so racking between near and far feels natural
  const lf = Math.log(state.focal) + (Math.log(tgt) - Math.log(state.focal)) * (1 - Math.exp(-dt * 3));
  state.focal = Math.exp(lf);
  spark.focalDistance = state.focal;
  spark.apertureAngle = state.dof ? state.aperture : 0;
}

// ------------------------------------------------------------------ time of day
const sunH = new THREE.Vector2(SUN.x, SUN.z).normalize();
function applyTime(t) {
  const tod = state.tod;
  const golden = smooth(0.16, 0.45, tod) * (1 - smooth(0.58, 0.78, tod));
  const night = smooth(0.55, 0.82, tod);
  const e = THREE.MathUtils.lerp(0.75, -0.32, tod);
  sky.uniforms.sunDir.value.set(sunH.x * Math.cos(e), Math.sin(e), sunH.y * Math.cos(e));
  sky.uniforms.night.value = night;
  sky.uniforms.golden.value = golden;
  sky.uniforms.time.value = t;
  U.night.value = night;
  U.golden.value = golden;
  U.time.value = t;
  U.show.value = state.show ? 1 : 0;
  U.cam.value.copy(camera.position);
  post.grade.uniforms.night.value = night;
  post.grade.uniforms.golden.value = golden;
  post.grade.uniforms.time.value = t;
  post.bloom.strength = THREE.MathUtils.lerp(0.12, 0.85, night) + golden * 0.15;
  post.bloom.threshold = THREE.MathUtils.lerp(0.92, 0.5, night);
  post.bloom.radius = THREE.MathUtils.lerp(0.4, 0.75, night);
  // clock label: 15:00 -> 22:00
  const minutes = 15 * 60 + tod * 7 * 60;
  $('clock').textContent = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(Math.floor(minutes % 60)).padStart(2, '0')}`;
  $('tod').value = Math.round(tod * 1000);
  return { golden, night };
}

// ------------------------------------------------------------------ world
function addWorld() {
  const t0 = performance.now();
  world = buildTarnovo((s) => console.log('[tarnovo]', s));
  const { main, glow, fort } = world.meshes;
  main.worldModifier = lightingModifier('main', U, world.lamps);
  glow.worldModifier = lightingModifier('glow', U);
  fort.worldModifier = lightingModifier('fort', U);
  for (const m of [main, glow, fort]) { m.updateGenerator(); tarnovoGroup.add(m); }
  for (const p of world.focusProxies) p.updateMatrixWorld(true);
  leaves = createLeaves();
  dust = createDust();
  moths = createMoths(world.lamps);
  tarnovoGroup.add(leaves.mesh, dust.mesh, moths.mesh);
  const total = world.counts.main + world.counts.glow + world.counts.fort;
  $('stats').textContent = `${(total / 1e6).toFixed(2)} M splats · генерирани за ${((performance.now() - t0) / 1000).toFixed(1)} s`;
  console.log('[tarnovo] splats', world.counts, 'lamps', world.lamps.length);
}

function applyFlip() {
  if (!fileMesh) return;
  fileMesh.quaternion.set(state.flip ? 1 : 0, 0, 0, state.flip ? 0 : 1);
  flash(state.flip ? 'Ориентация: OpenCV (Atlas/Marble)' : 'Ориентация: OpenGL');
}

async function loadSidecar(url) {
  try {
    const res = await fetch(url.replace(/\.(spz|ply|splat|ksplat|sog)$/i, '.json'));
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) return await res.json();
  } catch { /* no sidecar */ }
  return null;
}

async function loadSplat({ file, url }) {
  flash('Зареждане на сплатове…', 60000);
  try {
    const opts = file ? { fileBytes: await file.arrayBuffer(), fileName: file.name } : { url };
    const meta = url ? await loadSidecar(url) : null;
    const mesh = new SplatMesh({ ...opts, lod: true, raycastable: true, worldModifier: lightingModifier('generic', U) });
    await mesh.initialized;
    if (fileMesh) { scene.remove(fileMesh); fileMesh.dispose(); }
    fileMesh = mesh;
    fileMeta = meta;
    scene.add(mesh);
    // Atlas splats live in the same RUB (three.js) frame as their cameras;
    // older Marble exports are OpenCV (y down) and need the flip.
    state.flip = meta ? meta.coordinateSystem !== 'rub' : state.flip;
    applyFlip();
    tarnovoGroup.visible = false;
    state.mode = 'file';
    state.autopilot = false;
    applyFileCamera();
    refresh.done = false;
    flash(`Заредено: ${file ? file.name : url} — WASD, Q/E нагоре/надолу${meta?.tour ? ', P автопилот' : ''}`, 5000);
    syncButtons();
  } catch (err) {
    console.error(err);
    flash(`Грешка при зареждане: ${err.message ?? err}`, 6000);
  }
}

function backToTarnovo() {
  if (fileMesh) { scene.remove(fileMesh); fileMesh.dispose(); fileMesh = null; }
  fileMeta = null;
  if (!world) addWorld();
  tarnovoGroup.visible = true;
  state.mode = 'tarnovo';
  state.autopilot = false;
  camera.fov = 62;
  camera.updateProjectionMatrix();
  refresh.done = false;
  spawn();
  syncButtons();
}

// ------------------------------------------------------------------ UI
let flashTimer = 0;
function flash(msg, ms = 1800) {
  const el = $('flash');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('on'), ms);
}
function toggleCycle() { state.cycle = !state.cycle; syncButtons(); }
const canAutopilot = () => state.mode === 'tarnovo' || !!fileMeta?.tour;
function toggleAutopilot() {
  if (!canAutopilot()) return;
  state.autopilot = !state.autopilot;
  if (state.autopilot) {
    controls.unlock();
    if (state.mode === 'tarnovo') {
      autopilot.s = Math.max(0, Z_START - 1.6 - camera.position.z);
      autopilot.look.set(0, 0, 0);
    } else {
      Object.assign(tour, { i: 0, u: 0, hold: fileMeta.tour[0].hold ?? 0 });
    }
  }
  syncButtons();
}
function syncButtons() {
  $('b-cycle').classList.toggle('on', state.cycle);
  $('b-auto').classList.toggle('on', state.autopilot);
  $('b-dof').classList.toggle('on', state.dof);
  $('b-show').classList.toggle('on', state.show);
  $('b-back').hidden = state.mode !== 'file';
  $('b-auto').disabled = !canAutopilot();
}
$('b-cycle').onclick = toggleCycle;
$('b-auto').onclick = toggleAutopilot;
$('b-dof').onclick = () => { state.dof = !state.dof; syncButtons(); };
$('b-show').onclick = () => { state.show = !state.show; syncButtons(); };
$('b-load').onclick = () => $('file').click();
$('b-back').onclick = backToTarnovo;
$('file').onchange = (e) => { const f = e.target.files?.[0]; if (f) loadSplat({ file: f }); e.target.value = ''; };
$('tod').oninput = (e) => { state.tod = e.target.value / 1000; };
addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drag'); });
addEventListener('dragleave', () => document.body.classList.remove('drag'));
addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('drag');
  const f = e.dataTransfer?.files?.[0];
  if (f) { start(false); loadSplat({ file: f }); }
});

function start(cinematic) {
  if (state.started) return;
  state.started = true;
  $('intro').classList.add('gone');
  document.body.classList.add('started');
  if (cinematic) { state.autopilot = true; state.cycle = true; autopilot.s = 0; }
  else controls.lock();
  syncButtons();
}
$('go-walk').onclick = () => start(false);
$('go-cine').onclick = () => start(true);

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
const refresh = { tod: -1, cam: new THREE.Vector3(), done: false };
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (state.cycle) {
    state.cycleDir = state.cycleDir ?? 1;
    state.tod += state.cycleDir * dt / 45;
    if (state.tod > 1) { state.tod = 1; state.cycleDir = -1; }
    if (state.tod < 0) { state.tod = 0; state.cycleDir = 1; }
  }
  if (state.autopilot && state.mode === 'tarnovo') drive(dt, t);
  else if (state.autopilot && fileMeta?.tour) tourDrive(dt);
  else if (controls.isLocked || state.mode === 'file') walk(dt);

  const { golden, night } = applyTime(t);
  autofocus(dt);
  sky.mesh.position.copy(camera.position);

  if (world && state.mode === 'tarnovo') {
    leaves.update(dt, t, camera.position, groundY, THREE.MathUtils.lerp(1, 0.12, night) * (1 + golden * 0.1), 0.15);
    dust.update(dt, t, camera.position, (1 - night) * 0.45 + golden * 0.4);
    moths.update(dt, t, night * 0.9);
    // Re-running the lighting modifier regenerates every splat of a mesh, so the
    // big street mesh is only refreshed when the time of day or the viewpoint
    // (for haze) changed noticeably; the small emissive meshes animate per frame.
    const { main, glow, fort } = world.meshes;
    const changed = Math.abs(state.tod - refresh.tod) > 0.003 || camera.position.distanceTo(refresh.cam) > 2 || !refresh.done;
    if (changed) {
      main.updateVersion();
      refresh.tod = state.tod; refresh.cam.copy(camera.position); refresh.done = true;
    }
    if (changed || night > 0.01) glow.updateVersion();
    if (changed || (night > 0.01 && state.show)) fort.updateVersion();
  }
  if (fileMesh) {
    // same rule as the street: re-run the relighting only when it would show
    const changed = Math.abs(state.tod - refresh.tod) > 0.003 || camera.position.distanceTo(refresh.cam) > 2 || !refresh.done;
    if (changed) {
      fileMesh.updateVersion();
      refresh.tod = state.tod; refresh.cam.copy(camera.position); refresh.done = true;
    }
  }
  post.composer.render(dt);
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ boot
spawn();
syncButtons();
$('loading').textContent = 'Изграждане на улицата от Gaussian splats…';
setTimeout(() => {
  // with ?splat= skip building the procedural street; it is built on demand
  if (!params.get('splat')) addWorld();
  $('loading').textContent = '';
  $('intro').classList.add('ready');
  if (params.get('splat')) {
    start(false);
    loadSplat({ url: params.get('splat') }).then(() => { if (params.has('cine') && fileMeta?.tour) toggleAutopilot(); });
  } else if (params.has('cine')) start(true);
  if (params.has('t')) state.tod = Number(params.get('t'));
  requestAnimationFrame(tick);
}, 60);

// handy for debugging from the console
window.__tarnovo = { state, camera, spark, scene, U, ray, get fileMesh() { return fileMesh; }, get focusTarget() { return autofocus.target; } };
