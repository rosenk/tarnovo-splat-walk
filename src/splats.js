// Small toolkit for building Gaussian-splat scenes procedurally.
// Every splat is a flat (or near-flat) Gaussian whose thin axis is local +Z,
// so the splat's normal is simply its quaternion applied to (0,0,1).
import * as THREE from 'three';
import { SplatMesh } from '@sparkjsdev/spark';

const STRIDE = 15; // x y z | sx sy sz | qx qy qz qw | r g b | a | ao
const Z = new THREE.Vector3(0, 0, 1);
const X = new THREE.Vector3(1, 0, 0);

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _d = new THREE.Vector3();
const _uh = new THREE.Vector3();
const _vh = new THREE.Vector3();

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SplatBuilder {
  constructor(seed = 1, cap = 1 << 16) {
    this.f = new Float32Array(cap * STRIDE);
    this.n = 0;
    this.rand = mulberry32(seed);
  }

  push(x, y, z, sx, sy, sz, q, r, g, b, a = 1, ao = 1) {
    if ((this.n + 1) * STRIDE > this.f.length) {
      const nf = new Float32Array(this.f.length * 2);
      nf.set(this.f);
      this.f = nf;
    }
    const f = this.f;
    const o = this.n * STRIDE;
    f[o] = x; f[o + 1] = y; f[o + 2] = z;
    f[o + 3] = sx; f[o + 4] = sy; f[o + 5] = sz;
    f[o + 6] = q.x; f[o + 7] = q.y; f[o + 8] = q.z; f[o + 9] = q.w;
    f[o + 10] = r; f[o + 11] = g; f[o + 12] = b;
    f[o + 13] = a; f[o + 14] = ao;
    this.n++;
  }

  /**
   * Sample the parallelogram o + a*u + b*v (u ⟂ v).
   * shade(p, la, lb) -> [r,g,b] | [r,g,b,ao] | null (hole).
   * `facing` flips the surface so its normal points toward that vector.
   */
  rect(o, u, v, spacing, shade, { facing = null, thick = 0.006, ao = 1, jitter = 0.55, size = 0.68 } = {}) {
    const lu = u.length();
    const lv = v.length();
    if (lu < 1e-4 || lv < 1e-4) return;
    _uh.copy(u).divideScalar(lu);
    _vh.copy(v).divideScalar(lv);
    _n.crossVectors(_uh, _vh).normalize();
    let ox = o.x, oy = o.y, oz = o.z;
    let flip = false;
    if (facing && _n.dot(facing) < 0) {
      // swap u direction so the normal flips; keep the same area
      ox += u.x; oy += u.y; oz += u.z;
      _uh.negate();
      _n.negate();
      flip = true;
    }
    _m.makeBasis(_uh, _vh, _n);
    const q = new THREE.Quaternion().setFromRotationMatrix(_m);
    const nu = Math.max(1, Math.ceil(lu / spacing));
    const nv = Math.max(1, Math.ceil(lv / spacing));
    const du = lu / nu, dv = lv / nv;
    const sx = du * size, sy = dv * size;
    const R = this.rand;
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const la = (i + 0.5 + (R() - 0.5) * jitter) * du;
        const lb = (j + 0.5 + (R() - 0.5) * jitter) * dv;
        _p.set(ox + _uh.x * la + _vh.x * lb, oy + _uh.y * la + _vh.y * lb, oz + _uh.z * la + _vh.z * lb);
        const c = shade(_p, flip ? lu - la : la, lb);
        if (!c) continue;
        this.push(_p.x, _p.y, _p.z, sx, sy, thick, q, c[0], c[1], c[2], 1, (c[3] ?? 1) * ao);
      }
    }
  }

  /** Ellipsoid surface. r: Vector3 radii, rot: Quaternion. colorFn(localDir, worldPos) */
  ellipsoid(c, r, rot, spacing, colorFn, { ao = 1, opacity = 1 } = {}) {
    const avg = (r.x + r.y + r.z) / 3;
    const N = Math.max(12, Math.ceil((4 * Math.PI * avg * avg) / (spacing * spacing)));
    const ga = Math.PI * (3 - Math.sqrt(5));
    const s = Math.sqrt((4 * Math.PI * avg * avg) / N) * 0.7;
    for (let i = 0; i < N; i++) {
      const y = 1 - (2 * (i + 0.5)) / N;
      const rad = Math.sqrt(1 - y * y);
      const th = ga * i;
      _d.set(Math.cos(th) * rad, y, Math.sin(th) * rad);
      _p.set(_d.x * r.x, _d.y * r.y, _d.z * r.z).applyQuaternion(rot).add(c);
      _n.set(_d.x / r.x, _d.y / r.y, _d.z / r.z).normalize().applyQuaternion(rot);
      const col = colorFn(_d, _p);
      if (!col) continue;
      _q.setFromUnitVectors(Z, _n);
      this.push(_p.x, _p.y, _p.z, s, s, 0.004, _q, col[0], col[1], col[2], opacity, (col[3] ?? 1) * ao);
    }
  }

  /** Flat disc facing `normal`. colorFn(radiusFraction) */
  disc(c, normal, radius, spacing, colorFn) {
    _q.setFromUnitVectors(Z, normal);
    const N = Math.max(8, Math.ceil((Math.PI * radius * radius) / (spacing * spacing)));
    const s = Math.sqrt((Math.PI * radius * radius) / N) * 0.7;
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const rr = Math.sqrt((i + 0.5) / N);
      const th = ga * i;
      _p.set(Math.cos(th) * rr * radius, Math.sin(th) * rr * radius, 0).applyQuaternion(_q).add(c);
      const col = colorFn(rr);
      if (!col) continue;
      this.push(_p.x, _p.y, _p.z, s, s, 0.004, _q, col[0], col[1], col[2], 1, col[3] ?? 1);
    }
  }

  /** Thin rod from p0 to p1. */
  beam(p0, p1, width, col, step = null) {
    _d.subVectors(p1, p0);
    const len = _d.length();
    if (len < 1e-4) return;
    _d.divideScalar(len);
    _q.setFromUnitVectors(X, _d);
    const st = step ?? Math.max(0.02, width * 0.7);
    const n = Math.max(1, Math.ceil(len / st));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.push(p0.x + _d.x * len * t, p0.y + _d.y * len * t, p0.z + _d.z * len * t,
        (len / n) * 0.75, width * 0.5, width * 0.5, _q, col[0], col[1], col[2], 1, col[3] ?? 1);
    }
  }

  /** Volumetric cloud of leaf-like splats (foliage, flowers). */
  blob(c, r, count, size, colorFn, { squash = 1, ao = 1 } = {}) {
    const R = this.rand;
    for (let i = 0; i < count; i++) {
      let x, y, z;
      do { x = R() * 2 - 1; y = R() * 2 - 1; z = R() * 2 - 1; } while (x * x + y * y + z * z > 1);
      const k = Math.cbrt(0.35 + 0.65 * R());
      _p.set(c.x + x * r * k, c.y + y * r * k * squash, c.z + z * r * k);
      _n.set(x, y + 0.35, z).normalize();
      _d.set(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(0.8).add(_n).normalize();
      _q.setFromUnitVectors(Z, _d);
      const col = colorFn(R, k);
      if (!col) continue;
      const s = size * (0.6 + R() * 0.7);
      this.push(_p.x, _p.y, _p.z, s, s * (0.55 + R() * 0.4), 0.004, _q, col[0], col[1], col[2], 1, (col[3] ?? 1) * ao * (0.7 + 0.3 * k));
    }
  }

  /** Oriented box (no bottom). ax/az unit horizontal axes; h = half extents. shade(p, faceName, la, lb) */
  box(c, ax, az, hx, hy, hz, spacing, shade, opts = {}) {
    const ay = new THREE.Vector3(0, 1, 0);
    const P = (x, y, z) => new THREE.Vector3().copy(c)
      .addScaledVector(ax, x).addScaledVector(ay, y).addScaledVector(az, z);
    const U = (v, s) => v.clone().multiplyScalar(s);
    const faces = [
      ['top', P(-hx, hy, -hz), U(ax, 2 * hx), U(az, 2 * hz), ay],
      ['+x', P(hx, -hy, -hz), U(az, 2 * hz), U(ay, 2 * hy), ax],
      ['-x', P(-hx, -hy, -hz), U(az, 2 * hz), U(ay, 2 * hy), ax.clone().negate()],
      ['+z', P(-hx, -hy, hz), U(ax, 2 * hx), U(ay, 2 * hy), az],
      ['-z', P(-hx, -hy, -hz), U(ax, 2 * hx), U(ay, 2 * hy), az.clone().negate()],
    ];
    for (const [name, o, u, v, facing] of faces) {
      if (opts.skip && opts.skip.includes(name)) continue;
      this.rect(o, u, v, spacing, (p, la, lb) => shade(p, name, la, lb), { facing, ...opts });
    }
  }

  /** Apply a lighting function to every splat: light(p, n, rgb[3] in/out, ao). */
  bake(light) {
    const f = this.f;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const rgb = [0, 0, 0];
    for (let i = 0; i < this.n; i++) {
      const o = i * STRIDE;
      p.set(f[o], f[o + 1], f[o + 2]);
      q.set(f[o + 6], f[o + 7], f[o + 8], f[o + 9]);
      n.copy(Z).applyQuaternion(q);
      rgb[0] = f[o + 10]; rgb[1] = f[o + 11]; rgb[2] = f[o + 12];
      light(p, n, rgb, f[o + 14]);
      f[o + 10] = rgb[0]; f[o + 11] = rgb[1]; f[o + 12] = rgb[2];
    }
  }

  toMesh(opts = {}) {
    const f = this.f;
    const n = this.n;
    const c = new THREE.Vector3();
    const s = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    return new SplatMesh({
      maxSplats: n,
      constructSplats: (splats) => {
        for (let i = 0; i < n; i++) {
          const o = i * STRIDE;
          c.set(f[o], f[o + 1], f[o + 2]);
          s.set(f[o + 3], f[o + 4], f[o + 5]);
          q.set(f[o + 6], f[o + 7], f[o + 8], f[o + 9]);
          col.r = Math.min(1, Math.max(0, f[o + 10]));
          col.g = Math.min(1, Math.max(0, f[o + 11]));
          col.b = Math.min(1, Math.max(0, f[o + 12]));
          splats.pushSplat(c, s, q, f[o + 13], col);
        }
      },
      ...opts,
    });
  }
}

// ---------- noise helpers ----------
export function hash2(i, j) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function fbm(x, y, oct = 4) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; }
  return v / (1 - Math.pow(0.5, oct));
}

/** Jittered-grid Voronoi; returns shared object {d1, d2, id}. */
const VR = { d1: 0, d2: 0, id: 0 };
export function voronoi(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j;
      const px = cx + 0.12 + 0.76 * hash2(cx, cy);
      const py = cy + 0.12 + 0.76 * hash2(cy + 17, cx - 9);
      const dx = px - x, dy = py - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) { d2 = d1; d1 = d; id = hash2(cx * 7 + 3, cy * 13 + 1); } else if (d < d2) d2 = d;
    }
  }
  VR.d1 = d1; VR.d2 = d2; VR.id = id;
  return VR;
}

export const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
