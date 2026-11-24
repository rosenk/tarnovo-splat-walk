// Atmospheric particles: falling autumn leaves (day), floating dust in the sun,
// and moths/glowing motes around the lanterns at night.
import * as THREE from 'three';

export function createLeaves(count = 170) {
  const geo = new THREE.PlaneGeometry(0.075, 0.055);
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  const palette = [0xd9a032, 0xc4621f, 0x9b4a1c, 0xb8952f, 0xe0b040].map((c) => new THREE.Color(c));
  const items = [];
  for (let i = 0; i < count; i++) {
    mesh.setColorAt(i, palette[i % palette.length]);
    items.push({ p: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), phase: Math.random() * 10, fall: 0.35 + Math.random() * 0.4, alive: false });
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  function respawn(it, cam, groundY, fresh) {
    it.p.set(cam.x + (Math.random() - 0.5) * 16, cam.y + (fresh ? Math.random() * 6 - 1 : 3 + Math.random() * 4), cam.z + (Math.random() - 0.65) * 18);
    it.spin.set(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2);
    it.alive = true;
  }
  function update(dt, t, cam, groundY, brightness, wind) {
    mat.color.setScalar(brightness);
    for (let i = 0; i < count; i++) {
      const it = items[i];
      if (!it.alive || it.p.y < groundY(it.p.z) + 0.02 || it.p.distanceToSquared(cam) > 260) respawn(it, cam, groundY, !it.alive);
      it.p.y -= it.fall * dt;
      it.p.x += (Math.sin(t * 1.3 + it.phase) * 0.5 + wind) * dt;
      it.p.z += Math.cos(t * 0.9 + it.phase * 1.7) * 0.3 * dt;
      it.rot.x += it.spin.x * dt; it.rot.y += it.spin.y * dt; it.rot.z += it.spin.z * dt;
      q.setFromEuler(it.rot);
      m.compose(it.p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  return { mesh, update };
}

function makeMotes(count, color, size) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) seed[i] = Math.random();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 0 }, time: { value: 0 }, size: { value: size } },
    vertexShader: /* glsl */ `
      attribute float seed; varying float vS; uniform float time, size;
      void main() {
        vS = seed;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (0.6 + seed) * 300.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float opacity, time; varying float vS;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(c));
        float tw = 0.55 + 0.45 * sin(time * (1.5 + vS * 3.0) + vS * 40.0);
        gl_FragColor = vec4(color * a * opacity * tw, 1.0);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return { pts, pos, seed, mat };
}

export function createDust(count = 500) {
  const m = makeMotes(count, 0xfff0d0, 0.012);
  const vel = new Float32Array(count * 3).map(() => (Math.random() - 0.5) * 0.06);
  let init = false;
  function update(dt, t, cam, opacity) {
    m.mat.uniforms.time.value = t;
    m.mat.uniforms.opacity.value = opacity;
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      if (!init || Math.abs(m.pos[o] - cam.x) > 6 || Math.abs(m.pos[o + 1] - cam.y) > 3 || Math.abs(m.pos[o + 2] - cam.z) > 6) {
        m.pos[o] = cam.x + (Math.random() - 0.5) * 12;
        m.pos[o + 1] = cam.y + (Math.random() - 0.5) * 5;
        m.pos[o + 2] = cam.z + (Math.random() - 0.5) * 12;
      }
      m.pos[o] += (vel[o] + Math.sin(t * 0.3 + i) * 0.02) * dt;
      m.pos[o + 1] += (vel[o + 1] + 0.01) * dt;
      m.pos[o + 2] += vel[o + 2] * dt;
    }
    init = true;
    m.pts.geometry.attributes.position.needsUpdate = true;
  }
  return { mesh: m.pts, update };
}

export function createMoths(lamps, perLamp = 14) {
  const count = Math.max(1, lamps.length * perLamp);
  const m = makeMotes(count, 0xffc070, 0.03);
  const orbit = [];
  for (let i = 0; i < count; i++) {
    orbit.push({ lamp: lamps[Math.floor(i / perLamp)] ?? new THREE.Vector3(), r: 0.25 + Math.random() * 0.9, sp: 0.6 + Math.random() * 2.2, ph: Math.random() * 6.28, h: (Math.random() - 0.5) * 0.9 });
  }
  function update(dt, t, opacity) {
    m.mat.uniforms.time.value = t;
    m.mat.uniforms.opacity.value = opacity;
    for (let i = 0; i < count; i++) {
      const o = orbit[i];
      const a = t * o.sp + o.ph;
      m.pos[i * 3] = o.lamp.x + Math.cos(a) * o.r + Math.sin(a * 2.3) * 0.12;
      m.pos[i * 3 + 1] = o.lamp.y + o.h + Math.sin(a * 1.7) * 0.25;
      m.pos[i * 3 + 2] = o.lamp.z + Math.sin(a) * o.r;
    }
    m.pts.geometry.attributes.position.needsUpdate = true;
  }
  return { mesh: m.pts, update };
}
