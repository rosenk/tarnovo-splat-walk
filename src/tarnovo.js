// Procedural "old Veliko Tarnovo" street built entirely from Gaussian splats:
// a winding cobbled lane climbing between Revival-era houses (stone ground floor,
// overhanging plastered upper floors on wooden brackets, clay-tile roofs),
// wall lanterns, a stone fountain, and an opening in the right-hand row with a
// view down the slope to the Yantra and across to Tsarevets hill.
import * as THREE from 'three';
import { SplatBuilder, hash2, vnoise, fbm, voronoi, smooth, mulberry32 } from './splats.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// ---------------- street layout ----------------
export const HALF = 2.3;              // half street width
export const Z_START = 10.4;          // facade closing the street behind the start
export const Z_END = -41.2;           // facade closing the street at the top
export const GAP = { zA: -12.4, zB: -20.4 }; // opening in the right-hand row
export const centerX = (z) => 1.3 * Math.sin(z * 0.075);
export const groundY = (z) => -z * 0.065;

// Terrain beyond the parapet: falls steeply to the river, then Tsarevets rises.
const RIVER_X = 62;
const RIVER_Y = -42;
export const TSAREVETS = { x: 165, z: -25, rx: 72, rz: 118, top: 15 };

function slopeY(x, z) {
  const edge = centerX(z) + HALF;
  const d = Math.max(0, x - edge - 0.4);
  const street = groundY(z) - 0.3;
  // concave fall toward the river with a bit of noise
  const t = Math.min(1, d / (RIVER_X - edge));
  return street + (RIVER_Y - street) * Math.pow(t, 0.8) - 0.6 * fbm(x * 0.08, z * 0.08, 3) * (t > 0 ? 1 : 0);
}

function tsarevetsR(x, z) {
  return Math.hypot((x - TSAREVETS.x) / TSAREVETS.rx, (z - TSAREVETS.z) / TSAREVETS.rz);
}
function tsarevetsY(x, z) {
  const r = tsarevetsR(x, z);
  if (r < 1) return TSAREVETS.top - 6 * r * r + 1.2 * fbm(x * 0.05, z * 0.05, 2);
  return Math.max(RIVER_Y - 1, TSAREVETS.top - 6 - (r - 1) * 190 + 6 * fbm(x * 0.04, z * 0.04, 3));
}

// ---------------- sun shadows (baked) ----------------
export const SUN = V(-0.62, 0.56, 0.36).normalize();
const SUNC = [1.07, 0.97, 0.84];
const SKYC = [0.84, 0.91, 1.05];

class Shadows {
  constructor() { this.boxes = []; this.bins = new Map(); this.stamp = 0; }
  add(min, max) {
    const b = { min, max, s: 0 };
    this.boxes.push(b);
    for (let k = Math.floor(min.z / 2); k <= Math.floor(max.z / 2); k++) {
      if (!this.bins.has(k)) this.bins.set(k, []);
      this.bins.get(k).push(b);
    }
  }
  /** 1 if point sees the sun, 0 if occluded. */
  lit(px, py, pz) {
    const s = ++this.stamp;
    const k0 = Math.floor((pz - 1) / 2);
    const k1 = Math.floor((pz + 18) / 2);
    const dx = SUN.x, dy = SUN.y, dz = SUN.z;
    for (let k = k0; k <= k1; k++) {
      const bin = this.bins.get(k);
      if (!bin) continue;
      for (const b of bin) {
        if (b.s === s) continue;
        b.s = s;
        let t0 = 0.01, t1 = 60;
        let ta = (b.min.x - px) / dx, tb = (b.max.x - px) / dx;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) continue;
        ta = (b.min.y - py) / dy; tb = (b.max.y - py) / dy;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) continue;
        ta = (b.min.z - pz) / dz; tb = (b.max.z - pz) / dz;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 <= t1) return 0;
      }
    }
    return 1;
  }
}

// ---------------- palettes ----------------
const PLASTERS = [
  [0.94, 0.92, 0.87], [0.95, 0.93, 0.88], [0.91, 0.79, 0.57], [0.93, 0.86, 0.70],
  [0.74, 0.83, 0.88], [0.92, 0.80, 0.74], [0.96, 0.94, 0.90], [0.86, 0.72, 0.52],
];
const SHUTTERS = [[0.20, 0.32, 0.24], [0.38, 0.23, 0.13], [0.30, 0.20, 0.13], [0.22, 0.30, 0.38]];
const WOOD_DARK = [0.27, 0.16, 0.10];
const WOOD = [0.40, 0.26, 0.15];
const IRON = [0.07, 0.07, 0.075];

function mul(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

function stoneColor(x, y, scaleX, scaleY, rowOffset = true) {
  const gy = y / scaleY;
  const gx = x / scaleX + (rowOffset ? (Math.floor(gy) & 1) * 0.5 : 0);
  const v = voronoi(gx, gy);
  if (v.d2 - v.d1 < 0.09) return [0.60, 0.57, 0.51, 0.8];
  const id = v.id;
  const base = id < 0.33 ? [0.68, 0.61, 0.50] : id < 0.66 ? [0.60, 0.56, 0.50] : [0.72, 0.64, 0.51];
  const k = 0.78 + 0.32 * hash2(Math.floor(id * 1e6), 7) - 0.12 * v.d1;
  const n = 0.92 + 0.16 * vnoise(x * 9, y * 9);
  return [base[0] * k * n, base[1] * k * n, base[2] * k * n, 1];
}

// =====================================================================
export function buildTarnovo(onStatus = () => {}) {
  const main = new SplatBuilder(7, 1 << 20);   // lit by baked sun + night shader
  const glow = new SplatBuilder(11, 1 << 14);  // windows & lanterns (emissive at night)
  const fort = new SplatBuilder(13, 1 << 17);  // Tsarevets (light show at night)
  const R = mulberry32(2026);
  const shadows = new Shadows();
  const lamps = [];
  const colliders = [];   // circles {x, z, r}
  const focusProxies = []; // simple meshes for autofocus raycasts

  // ------------------------------------------------ cobbled street
  onStatus('Калдъръм…');
  {
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), UP);
    const sp = 0.05;
    for (let z = Z_END - 0.3; z <= Z_START + 0.2; z += sp) {
      const c = centerX(z);
      const gy = groundY(z);
      for (let xr = -HALF - 0.05; xr <= HALF + 0.05; xr += sp) {
        const jx = xr + (main.rand() - 0.5) * sp * 0.6;
        const jz = z + (main.rand() - 0.5) * sp * 0.6;
        let col, h = 0;
        if (Math.abs(jx) < 0.26) {
          // central gutter of flat slabs
          const v = voronoi(jx / 0.42 + 3, jz / 0.32);
          if (v.d2 - v.d1 < 0.06) { col = [0.33, 0.31, 0.28]; h = -0.012; }
          else { const k = 0.82 + 0.25 * v.id; col = [0.66 * k, 0.63 * k, 0.58 * k]; h = -0.02; }
        } else {
          const gz = jz / 0.13;
          const v = voronoi(jx / 0.16 + (Math.floor(gz) & 1) * 0.5, gz);
          if (v.d2 - v.d1 < 0.1) { col = [0.30, 0.28, 0.25]; h = -0.01; }
          else {
            const id = v.id;
            const base = id < 0.3 ? [0.58, 0.55, 0.50] : id < 0.6 ? [0.50, 0.48, 0.46] : id < 0.85 ? [0.60, 0.53, 0.44] : [0.45, 0.43, 0.42];
            const dome = 1.05 - 0.55 * v.d1;
            const n = 0.9 + 0.2 * vnoise(jx * 6, jz * 6);
            col = mul(base, dome * n);
            h = 0.015 * (1 - v.d1);
          }
        }
        // grime toward the walls, worn polish in the middle of the lane
        const edgeD = HALF - Math.abs(jx);
        const ao = 0.62 + 0.38 * smooth(0, 1.1, edgeD);
        main.push(c + jx, gy + h, jz, sp * 0.72, sp * 0.72, 0.004, q, col[0], col[1], col[2], 1, ao);
      }
    }
    // fallen autumn leaves along the walls
    const lq = new THREE.Quaternion();
    for (let i = 0; i < 2600; i++) {
      const z = Z_END + R() * (Z_START - Z_END);
      const side = R() < 0.5 ? -1 : 1;
      const xr = side * (HALF - Math.pow(R(), 1.8) * 1.6);
      lq.setFromEuler(new THREE.Euler(-Math.PI / 2 + (R() - 0.5) * 0.4, 0, R() * 6.28));
      const t = R();
      const col = t < 0.4 ? [0.85, 0.62, 0.18] : t < 0.7 ? [0.72, 0.36, 0.12] : t < 0.9 ? [0.55, 0.28, 0.12] : [0.62, 0.55, 0.2];
      main.push(centerX(z) + xr, groundY(z) + 0.02, z, 0.035, 0.022, 0.003, lq, col[0], col[1], col[2], 1, 0.9);
    }
  }

  // ------------------------------------------------ houses
  onStatus('Възрожденски къщи…');

  /**
   * One Revival house whose street facade runs from A to B (ground plan),
   * with `inw` the horizontal unit vector pointing into the street.
   */
  function house(A, B, inw, opt = {}) {
    const u = V(B.x - A.x, 0, B.z - A.z);
    const L = u.length();
    const ud = u.clone().divideScalar(L);
    const gA = groundY(A.z), gB = groundY(B.z);
    const base = Math.min(gA, gB) - 0.6;
    const gTop = Math.max(gA, gB);
    const yG = gTop + 2.45 + R() * 0.35;
    const floors = opt.floors ?? (R() < 0.45 ? 2 : 1);
    const oh1 = opt.oh1 ?? 0.38 + R() * 0.3;
    const oh2 = floors === 2 ? 0.12 + R() * 0.18 : 0;
    const fh = 2.55 + R() * 0.25;
    const yT = yG + fh * floors;
    const plaster = PLASTERS[Math.floor(R() * PLASTERS.length)];
    const stoneGround = R() < 0.75;
    const shutter = R() < 0.65 ? SHUTTERS[Math.floor(R() * SHUTTERS.length)] : null;
    const frameCol = R() < 0.5 ? [0.88, 0.86, 0.8] : WOOD;
    const ivy = R() < 0.16;
    const seed = Math.floor(R() * 1e6);
    const along = (p) => (p.x - A.x) * ud.x + (p.z - A.z) * ud.z;
    const at = (a, y, out = 0) => V(A.x + ud.x * a + inw.x * out, y, A.z + ud.z * a + inw.z * out);

    // occluders for baked sun shadows
    const back = inw.clone().multiplyScalar(-9);
    const addBox = (out0, y0, y1) => {
      const pts = [at(0, y0, out0), at(L, y0, out0), at(0, y0, out0).add(back), at(L, y0, out0).add(back)];
      const min = V(Infinity, y0, Infinity), max = V(-Infinity, y1, -Infinity);
      for (const p of pts) { min.x = Math.min(min.x, p.x); min.z = Math.min(min.z, p.z); max.x = Math.max(max.x, p.x); max.z = Math.max(max.z, p.z); }
      // shrink slightly so a facade never shadows itself
      const s = 0.04;
      shadows.add(V(min.x + s, min.y, min.z + s), V(max.x - s, max.y, max.z - s));
    };
    addBox(-0.05, base, yG);
    addBox(oh1 - 0.05, yG, yT + 1.4);
    addBox(oh1 + oh2 + 0.75, yT + 0.1, yT + 0.45);

    // ---- ground floor
    const doorA = 0.5 + R() * Math.max(0.1, L - 2.2);
    const smallWins = [];
    for (let a = 0.7; a < L - 0.8; a += 1.6 + R()) if (Math.abs(a - (doorA + 0.55)) > 1.3) smallWins.push(a);
    const shop = !opt.noShop && R() < 0.22;
    const groundShade = (p) => {
      const a = along(p);
      const yl = p.y - groundY(p.z);
      if (p.y > yG - 0.17) return [...mul(WOOD_DARK, 0.9 + 0.2 * vnoise(a * 3, seed)), 0.85];
      // door
      if (a > doorA && a < doorA + 1.1 && yl < 2.08) {
        const da = a - doorA;
        if (da < 0.06 || da > 1.04 || yl > 2.02) return [...WOOD_DARK, 0.7];
        const plank = Math.floor(da / 0.135);
        const seam = (da / 0.135) % 1 < 0.1;
        const k = (0.8 + 0.35 * hash2(plank, seed)) * (seam ? 0.55 : 1);
        if (Math.abs(da - 0.55) < 0.025) return [0.2, 0.12, 0.07, 0.7];
        if (Math.abs(da - 0.9) < 0.03 && Math.abs(yl - 1.05) < 0.03) return [0.55, 0.45, 0.25, 1]; // handle
        return [0.42 * k, 0.25 * k, 0.14 * k, 0.75];
      }
      if (shop && a > 0.5 && a < Math.min(L - 0.5, 0.5 + 2.6) && Math.abs(a - doorA - 0.55) > 1.2 && yl > 0.55 && yl < 2.0) {
        // shop window of a craft workshop (Samovodska charshia mood)
        const wa = a - 0.5;
        if (wa < 0.06 || yl < 0.61 || yl > 1.94 || (wa % 0.66) < 0.05) return [...WOOD, 0.8];
        return null; // glass drawn separately
      }
      for (const wa of smallWins) {
        if (Math.abs(a - wa) < 0.32 && yl > 1.05 && yl < 1.8) {
          if (Math.abs(a - wa) > 0.27 || yl < 1.1 || yl > 1.75) return [...WOOD, 0.85];
          if ((((a - wa + 0.3) / 0.11) % 1) < 0.22) return [...IRON, 1];
          return [0.10, 0.11, 0.12, 0.8];
        }
      }
      const ao = 0.68 + 0.32 * smooth(0, 1.3, yl);
      if (!stoneGround) {
        const d = 0.85 + 0.15 * fbm(a * 1.3 + seed, p.y * 2.2, 3) - 0.18 * (1 - smooth(0, 0.9, yl));
        return [...mul(plaster, d * 0.97), ao];
      }
      const c = stoneColor(a + seed * 0.001, p.y, 0.32, 0.21);
      return [c[0], c[1], c[2], c[3] * ao];
    };
    main.rect(at(0, base), u, V(0, yG - base, 0), 0.052, groundShade, { facing: inw });
    if (shop) {
      const w = Math.min(L - 1.0, 2.6);
      const lit = R() < 0.7;
      const target = lit ? glow : main;
      target.rect(at(0.5, groundY((A.z + B.z) / 2) + 0.6, -0.06), ud.clone().multiplyScalar(w), V(0, 1.4, 0), 0.05,
        (p, la, lb) => lit ? [0.98, 0.72, 0.42 - 0.15 * (lb / 1.4)] : [0.12, 0.14, 0.17], { facing: inw });
    }

    // ---- overhang underside, joists and brackets
    main.rect(at(0, yG), u, inw.clone().multiplyScalar(oh1), 0.065, (p) => {
      const a = along(p);
      if ((a % 0.45) < 0.09) return [...WOOD_DARK, 0.55];
      return [...mul(WOOD, 0.9 + 0.2 * hash2(Math.floor(a / 0.15), seed)), 0.6];
    }, { facing: V(0, -1, 0) });
    for (let a = 0.35; a < L - 0.2; a += 1.35) {
      main.beam(at(a, yG - 0.85, 0.02), at(a, yG - 0.02, oh1 - 0.04), 0.09, [...WOOD_DARK, 0.8], 0.03);
    }

    // ---- upper floors
    const winW = 0.74, winH = 1.12;
    const upper = (out, y0, y1, isTop) => {
      const nW = Math.max(1, Math.floor((L - 0.5) / 1.5));
      const step = L / nW;
      const wins = [];
      for (let i = 0; i < nW; i++) wins.push((i + 0.5) * step + (R() - 0.5) * 0.15);
      const sill = y0 + 0.78;
      const top = isTop ? y1 + 0.45 : y1;
      const shade = (p) => {
        const a = along(p);
        if (a < 0.11 || a > L - 0.11) return [...WOOD_DARK, 0.9];
        if (p.y < y0 + 0.16 || p.y > top - 0.12) return [...mul(WOOD_DARK, 1.05), 0.85];
        for (const c of wins) {
          const dx = Math.abs(a - c);
          if (dx < winW / 2 + 0.07 && p.y > sill - 0.07 && p.y < sill + winH + 0.07) {
            if (dx > winW / 2 || p.y < sill || p.y > sill + winH) return [...frameCol, 0.85];
            if (dx < 0.025 || Math.abs(p.y - (sill + winH * 0.62)) < 0.025) return [...frameCol, 0.85];
            return null; // glass is set back
          }
          if (shutter && dx > winW / 2 + 0.07 && dx < winW / 2 + 0.46 && p.y > sill && p.y < sill + winH) {
            const slat = ((p.y - sill) / 0.07) % 1 < 0.28;
            const edge = dx > winW / 2 + 0.42 || dx < winW / 2 + 0.1;
            return [...mul(shutter, edge ? 0.7 : slat ? 0.72 : 1), 0.95];
          }
        }
        let d = 0.88 + 0.12 * fbm(a * 1.1 + seed, p.y * 1.7, 3);
        d -= 0.1 * smooth(0.55, 0.9, fbm(a * 0.6 + 40, p.y * 2.5 + seed * 0.01, 3)) * smooth(y0 + 1.6, y0, p.y);
        if (ivy) {
          const iv = fbm(a * 1.6 + seed, p.y * 1.6, 4) + 0.35 * smooth(y1, y0, p.y);
          if (iv > 0.9) {
            const h = hash2(Math.floor(a * 30), Math.floor(p.y * 30));
            const red = [0.62 + 0.25 * h, 0.12 + 0.12 * h, 0.08];
            const grn = [0.28, 0.42 + 0.1 * h, 0.16];
            return [...mix3(red, grn, smooth(0.5, 0.9, vnoise(a * 2, p.y * 2))), 0.85];
          }
        }
        return [...mul(plaster, d), 1];
      };
      main.rect(at(0, y0, out), u, V(0, top - y0, 0), 0.054, shade, { facing: inw });

      // window glass, flower boxes
      for (const c of wins) {
        const lit = R() < 0.55;
        const g0 = at(c - winW / 2, sill, out - 0.05);
        const tint = 0.85 + 0.25 * R();
        const glassShade = lit
          ? (p, la, lb) => {
              const curtain = (Math.abs(la - winW / 2) > winW * 0.28) ? 0.75 : 1;
              return [1.0 * tint * curtain, 0.74 * tint * curtain, 0.44 * tint * curtain];
            }
          : (p, la, lb) => [0.11 + 0.08 * (lb / winH), 0.13 + 0.09 * (lb / winH), 0.16 + 0.1 * (lb / winH), 0.9];
        (lit ? glow : main).rect(g0, ud.clone().multiplyScalar(winW), V(0, winH, 0), 0.045, glassShade, { facing: inw });
        if (R() < 0.45) {
          const fb = at(c - 0.42, sill - 0.2, out + 0.2);
          main.rect(fb, ud.clone().multiplyScalar(0.84), V(0, 0.17, 0), 0.04,
            () => [0.62, 0.32, 0.2, 0.85], { facing: inw });
          main.rect(at(c - 0.42, sill - 0.03, out + 0.02), ud.clone().multiplyScalar(0.84), inw.clone().multiplyScalar(0.18), 0.05,
            () => [0.25, 0.17, 0.1, 0.6], { facing: UP });
          // geraniums: red/pink heads over trailing leaves
          const flower = R() < 0.6 ? [0.86, 0.12, 0.16] : R() < 0.5 ? [0.95, 0.38, 0.55] : [0.92, 0.9, 0.88];
          for (let k = 0; k < 6; k++) {
            const fc = at(c - 0.34 + k * 0.135, sill + 0.06 + R() * 0.06, out + 0.12);
            main.blob(fc, 0.12, 40, 0.035, (r, kk) => (kk > 0.65 && r() < 0.6 ? flower : [0.2, 0.38 + 0.12 * r(), 0.15]));
            if (R() < 0.6) main.blob(at(c - 0.34 + k * 0.135, sill - 0.25, out + 0.2), 0.1, 18, 0.03, (r) => [0.2, 0.36 + 0.1 * r(), 0.14], { squash: 2.2 });
          }
        }
      }
    };
    upper(oh1, yG, yG + fh, floors === 1);
    if (floors === 2) {
      main.rect(at(0, yG + fh, oh1), u, inw.clone().multiplyScalar(oh2), 0.05, () => [...WOOD_DARK, 0.6], { facing: V(0, -1, 0) });
      upper(oh1 + oh2, yG + fh, yT, true);
    }
    const outTop = oh1 + oh2;

    // ---- eaves and roof (tiles rise away from the street)
    const eave = outTop + 0.8;
    const slope = 0.45;
    main.rect(at(0, yT + 0.06, eave), u, inw.clone().multiplyScalar(-0.8).add(V(0, 0.8 * slope, 0)), 0.065, (p) => {
      const a = along(p);
      if ((a % 0.5) < 0.08) return [...WOOD_DARK, 0.55];
      return [...mul(WOOD, 0.95 + 0.15 * hash2(Math.floor(a / 0.12), seed + 1)), 0.62];
    }, { facing: V(0, -1, 0) });
    main.rect(at(0, yT + 0.06, eave), u, V(0, 0.16, 0), 0.04, (p) => {
      const a = along(p);
      const ch = 0.5 + 0.5 * Math.cos((a / 0.22) * Math.PI * 2);
      return [0.38 + 0.16 * ch, 0.18 + 0.07 * ch, 0.12 + 0.04 * ch, 0.8];
    }, { facing: inw });
    const D = 5.2;
    const roofV = inw.clone().multiplyScalar(-D).add(V(0, D * slope, 0));
    main.rect(at(0, yT + 0.22, eave), u, roofV, 0.095, (p, la, lb) => {
      const a = along(p);
      const across = a / 0.24;
      const row = lb / 0.32;
      const tile = Math.floor(across) * 131 + Math.floor(row) * 17 + seed;
      const ch = 0.5 + 0.5 * Math.cos(across * Math.PI * 2);
      const h = hash2(tile, 3);
      let c = h < 0.15 ? [0.42, 0.27, 0.20] : h < 0.3 ? [0.70, 0.38, 0.24] : [0.60, 0.31, 0.21];
      const moss = smooth(0.62, 0.85, fbm(a * 0.5 + seed, lb * 0.8, 3));
      c = mix3(c, [0.38, 0.38, 0.24], moss * 0.6);
      const k = (0.68 + 0.42 * ch) * (row % 1 < 0.12 ? 0.7 : 1);
      return [...mul(c, k), 1];
    }, { facing: UP });
    // gables / side walls (visible where a neighbour is lower or missing)
    for (const end of [0, L]) {
      const dir = end === 0 ? ud.clone().negate() : ud.clone();
      const o = at(end, base, -1.6);
      main.rect(o, inw.clone().multiplyScalar(1.6 + outTop), V(0, yT + 0.45 - base, 0), 0.085, (p) => {
        const out = (p.x - A.x) * inw.x + (p.z - A.z) * inw.z;
        if (out > 0.02 && p.y < yG) return null;
        if (out > oh1 + 0.02 && p.y < yG + fh) return null;
        if (p.y < yG) return stoneGround ? stoneColor(out + seed, p.y, 0.32, 0.21) : mul(plaster, 0.9);
        return [...mul(plaster, 0.86 + 0.1 * fbm(out + seed, p.y * 1.5, 2)), 0.95];
      }, { facing: dir });
      const g0 = at(end, yT + 0.45, outTop + 0.02);
      main.rect(g0, inw.clone().multiplyScalar(-(D - 0.8)), V(0, (D - 0.8) * slope + 0.4, 0), 0.1, (p, la, lb) => {
        if (lb > 0.2 + la * slope) return null;
        return [...mul(plaster, 0.84), 0.9];
      }, { facing: dir });
    }

    // ---- wall lantern
    if (opt.lamp) {
      const a = opt.lampAt ?? L * 0.5 + 0.7;
      const y = yG + 0.62;
      const w0 = at(a, y, oh1);
      const w1 = at(a, y, oh1 + 0.55);
      main.beam(w0, w1, 0.035, IRON);
      main.beam(at(a, y - 0.35, oh1), at(a, y, oh1 + 0.32), 0.025, IRON);
      const c = w1.clone().add(V(0, -0.3, 0));
      main.beam(w1, c.clone().add(V(0, 0.2, 0)), 0.02, IRON);
      const rq = new THREE.Quaternion();
      main.ellipsoid(c.clone().add(V(0, 0.17, 0)), V(0.16, 0.06, 0.16), rq, 0.025, () => [0.09, 0.09, 0.1, 0.9]);
      glow.ellipsoid(c, V(0.105, 0.15, 0.105), rq, 0.018, (d) => [1.0, 0.82, 0.5]);
      main.ellipsoid(c.clone().add(V(0, -0.16, 0)), V(0.07, 0.035, 0.07), rq, 0.02, () => [0.09, 0.09, 0.1, 0.9]);
      for (let k = 0; k < 4; k++) {
        const ang = k * Math.PI / 2 + Math.PI / 4;
        const off = V(Math.cos(ang) * 0.11, 0, Math.sin(ang) * 0.11);
        main.beam(c.clone().add(off).add(V(0, -0.15, 0)), c.clone().add(off).add(V(0, 0.15, 0)), 0.018, IRON);
      }
      lamps.push(c);
    }

    // autofocus proxy: the facade plane
    const proxy = new THREE.Mesh(new THREE.PlaneGeometry(L, yT + 1 - base));
    proxy.position.copy(at(L / 2, (yT + 1 + base) / 2, oh1 * 0.5));
    proxy.lookAt(proxy.position.clone().add(inw));
    focusProxies.push(proxy);
    return { yG, yT, oh1, at, ud, L, base };
  }

  // walk both sides of the lane and place houses
  const placed = { left: [], right: [] };
  for (const s of [-1, 1]) {
    let z = Z_START;
    let lampToggle = s > 0;
    while (z > Z_END) {
      let len = 4.6 + R() * 3.6;
      let zB = Math.max(Z_END, z - len);
      if (s > 0 && z > GAP.zA && zB < GAP.zA) zB = GAP.zA;
      if (s > 0 && z <= GAP.zA && z > GAP.zB) { z = GAP.zB; continue; }
      if (z - zB < 1.5) { z = zB; continue; }
      const A = V(centerX(z) + s * HALF, 0, z);
      const B = V(centerX(zB) + s * HALF, 0, zB);
      const u = B.clone().sub(A).normalize();
      let inw = V(u.z, 0, -u.x);
      if (inw.x * s > 0) inw.negate();
      lampToggle = !lampToggle;
      const h = house(A, B, inw, { lamp: lampToggle });
      (s < 0 ? placed.left : placed.right).push({ z0: z, z1: zB, h, A, inw });
      z = zB;
    }
  }
  // houses closing both ends of the lane
  {
    const zE = Z_END;
    const cE = centerX(zE);
    house(V(cE - HALF - 1.5, 0, zE), V(cE + HALF + 1.5, 0, zE), V(0, 0, 1), { floors: 2, lamp: true, lampAt: 1.6, noShop: true });
    const zS = Z_START;
    const cS = centerX(zS);
    house(V(cS + HALF + 1.5, 0, zS), V(cS - HALF - 1.5, 0, zS), V(0, 0, -1), { floors: 1, lamp: true, noShop: true });
  }

  // ------------------------------------------------ fountain (чешма) on the left
  onStatus('Чешма, скутер, пейка…');
  {
    const z = -29.5;
    const host = placed.left.find((p) => p.z0 >= z && p.z1 <= z) ?? placed.left[0];
    const inw = host.inw;
    const ud = host.h.ud;
    const a = (V(centerX(z) - HALF, 0, z).sub(host.A)).dot(ud);
    const gy = groundY(z);
    const c = host.h.at(a, gy + 1.0, 0.18);
    main.box(c, ud, inw, 0.75, 1.05, 0.18, 0.03, (p, face, la, lb) => {
      const yl = p.y - gy;
      if (face === '+z' && yl > 1.15 && yl < 1.65 && Math.abs((p.x - c.x) * ud.x + (p.z - c.z) * ud.z) < 0.4) return [0.78, 0.76, 0.7, 0.9]; // plaque
      if (face === '+z' && yl > 0.55 && yl < 1.05 && Math.abs((p.x - c.x) * ud.x + (p.z - c.z) * ud.z) < 0.45) return [0.48, 0.46, 0.43, 0.7]; // niche
      const k = stoneColor(la * 1.3 + 5, p.y, 0.4, 0.28, true);
      return [k[0] * 1.05, k[1] * 1.03, k[2], k[3]];
    }, { skip: ['-z'] });
    // arched top
    main.ellipsoid(c.clone().add(V(0, 1.05, 0)), V(0.75, 0.32, 0.18), new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ud, UP, inw)), 0.03,
      (d) => d.y > 0 ? stoneColor(d.x * 2, d.y, 0.2, 0.2) : null);
    // trough
    const tc = host.h.at(a, gy + 0.22, 0.62);
    main.box(tc, ud, inw, 0.6, 0.22, 0.26, 0.03, () => [0.68, 0.66, 0.6, 0.85]);
    main.rect(host.h.at(a - 0.55, gy + 0.42, 0.4), ud.clone().multiplyScalar(1.1), inw.clone().multiplyScalar(0.44), 0.03,
      () => [0.22, 0.32, 0.35, 0.8], { facing: UP });
    // brass pipe and water
    const pipe0 = host.h.at(a, gy + 0.85, 0.36);
    const pipe1 = host.h.at(a, gy + 0.83, 0.6);
    main.beam(pipe0, pipe1, 0.04, [0.62, 0.5, 0.25]);
    main.beam(pipe1, host.h.at(a, gy + 0.43, 0.62), 0.018, [0.75, 0.85, 0.9]);
    colliders.push({ x: tc.x, z: tc.z, r: 0.7 });
  }

  // ------------------------------------------------ red scooter (nod to the original post)
  {
    const z = -6.2;
    const host = placed.right.find((p) => p.z0 >= z && p.z1 <= z) ?? placed.right[0];
    const ud = host.h.ud;
    const inw = host.inw;
    const fwd = ud.clone().negate();
    const side = inw.clone();
    const a = (V(centerX(z) + HALF, 0, z).sub(host.A)).dot(ud);
    const c0 = host.h.at(a, groundY(z), 0.55);
    const rot = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(fwd, UP, fwd.clone().cross(UP)));
    const T = (x, y, zz) => c0.clone().addScaledVector(fwd, x).add(V(0, y, 0)).addScaledVector(fwd.clone().cross(UP), zz);
    const RED = [0.78, 0.11, 0.09];
    const red = (d) => [RED[0] * (0.85 + 0.25 * d.y), RED[1], RED[2], 1];
    for (const wx of [0.62, -0.48]) {
      for (const zz of [-0.055, 0.055]) {
        main.disc(T(wx, 0.2, zz), fwd.clone().cross(UP).multiplyScalar(Math.sign(zz)), 0.2, 0.018,
          (rr) => rr > 0.62 ? [0.07, 0.07, 0.07, 0.8] : rr > 0.5 ? [0.6, 0.6, 0.6, 0.9] : [0.35, 0.35, 0.37, 0.8]);
      }
    }
    main.ellipsoid(T(-0.35, 0.53, 0), V(0.48, 0.27, 0.25), rot, 0.025, red);
    main.ellipsoid(T(-0.28, 0.82, 0), V(0.4, 0.07, 0.16), rot, 0.022, () => [0.22, 0.13, 0.09]);
    main.box(T(0.08, 0.3, 0), fwd, fwd.clone().cross(UP), 0.3, 0.04, 0.17, 0.025, () => [0.25, 0.25, 0.27, 0.8]);
    main.ellipsoid(T(0.42, 0.62, 0), V(0.09, 0.36, 0.22), rot, 0.022, red);
    main.ellipsoid(T(0.6, 0.36, 0), V(0.21, 0.1, 0.11), rot, 0.022, red);
    main.beam(T(0.45, 0.72, 0), T(0.52, 1.03, 0), 0.06, RED);
    main.ellipsoid(T(0.52, 1.07, 0), V(0.1, 0.08, 0.15), rot, 0.02, red);
    main.ellipsoid(T(0.62, 1.07, 0), V(0.035, 0.06, 0.06), rot, 0.012, () => [0.95, 0.93, 0.8]);
    main.beam(T(0.52, 1.1, -0.34), T(0.52, 1.1, 0.34), 0.03, [0.7, 0.7, 0.72]);
    main.beam(T(0.5, 1.1, 0.3), T(0.45, 1.32, 0.33), 0.012, [0.6, 0.6, 0.62]);
    main.ellipsoid(T(0.45, 1.35, 0.33), V(0.05, 0.035, 0.012), rot, 0.01, () => [0.75, 0.8, 0.85]);
    colliders.push({ x: T(0, 0, 0).x, z: T(0, 0, 0).z, r: 0.75 });
  }

  // ------------------------------------------------ bench with a cat-free cushion of leaves
  {
    const z = 3.2;
    const c = V(centerX(z) - HALF + 0.42, groundY(z) + 0.45, z);
    const ax = V(0, 0, 1), az = V(1, 0, 0);
    main.box(c, ax, az, 0.75, 0.035, 0.2, 0.025, (p, f, la) => [...mul(WOOD, 0.9 + 0.2 * hash2(Math.floor(la / 0.1), 9)), 0.85]);
    main.box(c.clone().add(V(-0.18, 0.3, 0)), ax, az, 0.75, 0.25, 0.025, 0.025, (p, f, la, lb) => ((lb / 0.1) % 1 < 0.3 ? null : [...WOOD, 0.85]));
    for (const dz of [-0.6, 0.6]) main.box(c.clone().add(V(0, -0.23, dz)), ax, az, 0.04, 0.22, 0.17, 0.025, () => [...IRON, 0.8]);
    colliders.push({ x: c.x, z: c.z, r: 0.6 });
  }

  // ------------------------------------------------ viewpoint: parapet over the gorge
  onStatus('Изглед към Царевец…');
  {
    const z0 = GAP.zA, z1 = GAP.zB;
    for (let z = z0; z > z1; z -= 0.5) {
      const zb = Math.max(z1, z - 0.5);
      const A = V(centerX(z) + HALF, groundY(z) - 0.4, z);
      const B = V(centerX(zb) + HALF, groundY(zb) - 0.4, zb);
      const u = B.clone().sub(A); u.y = 0;
      const h = 1.35;
      main.rect(A, u, V(0, h, 0), 0.04, (p) => stoneColor(p.z * 1.0 + 9, p.y, 0.36, 0.22), { facing: V(-1, 0, 0) });
      main.rect(A.clone().add(V(0, h, 0)), u, V(0.38, 0, 0), 0.04, (p) => [...mul([0.7, 0.67, 0.6], 0.9 + 0.15 * vnoise(p.z * 3, 1)), 1], { facing: UP });
      main.rect(A.clone().add(V(0.38, 0, 0)), u, V(0, h, 0), 0.06, (p) => stoneColor(p.z + 3, p.y, 0.36, 0.22), { facing: V(1, 0, 0) });
    }
    // a gnarled tree on the slope just past the parapet
    const t0 = V(centerX(-22) + HALF + 3.2, slopeY(centerX(-22) + HALF + 3.2, -22.5), -22.5);
    main.beam(t0, t0.clone().add(V(-0.4, 4.2, 0.3)), 0.32, [0.3, 0.24, 0.2, 0.8], 0.06);
    main.beam(t0.clone().add(V(-0.3, 3.0, 0.2)), t0.clone().add(V(1.6, 5.0, -1.2)), 0.16, [0.3, 0.24, 0.2, 0.8], 0.06);
    for (let k = 0; k < 9; k++) {
      const cc = t0.clone().add(V(-0.4 + (R() - 0.3) * 3.5, 4.4 + R() * 2.2, (R() - 0.5) * 3.5));
      main.blob(cc, 1.1 + R() * 0.6, 700, 0.07, (r, kk) => {
        const h = r();
        return h < 0.45 ? [0.86, 0.6, 0.15] : h < 0.75 ? [0.78, 0.38, 0.12] : h < 0.9 ? [0.6, 0.5, 0.2] : [0.45, 0.22, 0.1];
      });
    }
  }

  // ------------------------------------------------ slope, houses below, river
  {
    const q = new THREE.Quaternion();
    const n = V();
    for (let x = 3; x < RIVER_X + 10; x += 0.45) {
      for (let z = -75; z < 40; z += 0.45) {
        const jx = x + (R() - 0.5) * 0.3, jz = z + (R() - 0.5) * 0.3;
        if (jx < centerX(jz) + HALF + 0.5) continue;
        const y = slopeY(jx, jz);
        const e = 0.5;
        n.set(slopeY(jx - e, jz) - slopeY(jx + e, jz), 2 * e, slopeY(jx, jz - e) - slopeY(jx, jz + e)).normalize();
        q.setFromUnitVectors(V(0, 0, 1), n);
        const steep = 1 - n.y;
        const g = fbm(jx * 0.15, jz * 0.15, 4);
        let col;
        if (jx > RIVER_X - 6) col = [0.22, 0.32, 0.33];
        else if (steep > 0.45 && g > 0.45) col = mul([0.62, 0.58, 0.5], 0.85 + 0.3 * g);
        else {
          const h = hash2(Math.floor(jx * 5), Math.floor(jz * 5));
          col = mix3([0.42, 0.42, 0.2], [0.75, 0.48, 0.16], smooth(0.35, 0.75, g));
          col = mul(col, 0.8 + 0.3 * h);
        }
        main.push(jx, y, jz, 0.42, 0.42, 0.01, q, col[0], col[1], col[2], 1, -0.95);
      }
    }
    // trees on the slope
    for (let i = 0; i < 70; i++) {
      const x = 15 + R() * (RIVER_X - 20);
      const z = -70 + R() * 105;
      const y = slopeY(x, z);
      const h = R();
      const col = h < 0.3 ? [0.82, 0.55, 0.14] : h < 0.55 ? [0.7, 0.32, 0.12] : h < 0.8 ? [0.38, 0.42, 0.18] : [0.24, 0.32, 0.18];
      main.blob(V(x, y + 2 + R() * 1.5, z), 2.0 + R() * 1.4, 260, 0.38, (r) => mul(col, 0.75 + 0.4 * r()), { ao: -1 });
    }
    // houses stepping down the slope (the classic Tarnovo cliff-side look)
    for (let i = 0; i < 26; i++) {
      const x = 9 + R() * 34;
      const z = -62 + R() * 90;
      if (x < 16 && z > GAP.zB - 6 && z < GAP.zA + 6) continue;
      const y = slopeY(x, z);
      const w = 4 + R() * 3, d = 4 + R() * 3, h = 4.5 + R() * 3.5;
      const ax = V(0, 0, 1), az = V(1, 0, 0);
      const plaster = PLASTERS[Math.floor(R() * PLASTERS.length)];
      const c = V(x, y + h / 2 - 1.5, z);
      const nwin = [];
      main.box(c, ax, az, w / 2, h / 2, d / 2, 0.2, (p, face, la, lb) => {
        if (face === 'top') return null;
        const wx = (la % 1.6) / 1.6, wy = ((p.y - (y - 1.5)) % 2.5) / 2.5;
        if (p.y > y + 0.2 && wx > 0.35 && wx < 0.65 && wy > 0.3 && wy < 0.7) {
          if (hash2(Math.floor(la / 1.6) + i * 31, Math.floor((p.y - y) / 2.5) + face.length) < 0.5) { nwin.push(p.clone()); return null; }
          return [0.12, 0.13, 0.16, 1];
        }
        return [...mul(plaster, 0.92 + 0.08 * vnoise(la, p.y)), -1];
      }, { skip: ['+x'], ao: 1 });
      for (const p of nwin) glow.push(p.x, p.y, p.z, 0.16, 0.2, 0.01, new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), V(-1, 0, 0)), 1.0, 0.75, 0.42);
      // hipped roof
      const ry = c.y + h / 2;
      const roofCol = (p) => {
        const hh = hash2(Math.floor(p.x * 4), Math.floor(p.z * 4));
        return [0.6 + 0.12 * hh, 0.3 + 0.05 * hh, 0.2, -1];
      };
      const rq = V(0, 1.6, 0);
      const corners = [V(x - d / 2 - 0.5, ry, z - w / 2 - 0.5), V(x + d / 2 + 0.5, ry, z - w / 2 - 0.5), V(x + d / 2 + 0.5, ry, z + w / 2 + 0.5), V(x - d / 2 - 0.5, ry, z + w / 2 + 0.5)];
      const apex = V(x, ry, z).add(rq);
      for (let k = 0; k < 4; k++) {
        const a = corners[k], b = corners[(k + 1) % 4];
        const steps = 14;
        for (let s = 0; s < steps; s++) {
          const t = (s + 0.5) / steps;
          const pA = a.clone().lerp(apex, t), pB = b.clone().lerp(apex, t);
          main.beam(pA, pB, 0.4, roofCol(pA), 0.3);
        }
      }
    }
    // river Yantra
    const wq = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), UP);
    for (let z = -160; z < 120; z += 0.8) {
      const cxr = RIVER_X + 5 + 6 * Math.sin(z * 0.02);
      for (let x = cxr - 8; x < cxr + 8; x += 0.8) {
        const sh = 0.85 + 0.25 * vnoise(x * 0.3, z * 0.1);
        main.push(x, RIVER_Y + 0.2, z, 0.7, 0.7, 0.01, wq, 0.32 * sh, 0.42 * sh, 0.42 * sh, 1, -1);
      }
    }
  }

  // ------------------------------------------------ Tsarevets: hill, walls, towers, Patriarchal church
  onStatus('Царевец…');
  {
    const { x: tx, z: tz, rx, rz } = TSAREVETS;
    const q = new THREE.Quaternion();
    const n = V();
    for (let x = RIVER_X + 6; x < tx + rx + 25; x += 0.9) {
      for (let z = tz - rz - 30; z < tz + rz + 30; z += 0.9) {
        const jx = x + (R() - 0.5) * 0.6, jz = z + (R() - 0.5) * 0.6;
        const y = tsarevetsY(jx, jz);
        if (y < RIVER_Y) continue;
        const e = 0.8;
        n.set(tsarevetsY(jx - e, jz) - tsarevetsY(jx + e, jz), 2 * e, tsarevetsY(jx, jz - e) - tsarevetsY(jx, jz + e)).normalize();
        q.setFromUnitVectors(V(0, 0, 1), n);
        const r = tsarevetsR(jx, jz);
        const g = fbm(jx * 0.08, jz * 0.08, 4);
        let col;
        const g2 = fbm(jz * 0.04 + 7, y * 0.12, 3);
        if (r > 1.0 && n.y < 0.55) {
          // limestone cliffs streaked with scrub
          col = mix3([0.62, 0.55, 0.45], [0.74, 0.68, 0.58], g);
          col = mul(col, 0.78 + 0.3 * vnoise(jx * 0.2, y * 0.35));
          if (g2 > 0.55) col = mix3(col, [0.5, 0.42, 0.18], smooth(0.55, 0.75, g2));
        }
        else if (r < 0.95) col = mix3([0.36, 0.42, 0.2], [0.66, 0.5, 0.22], smooth(0.3, 0.75, g));               // plateau grass
        else col = mix3([0.4, 0.42, 0.2], [0.8, 0.5, 0.15], smooth(0.35, 0.7, g));             // autumn scrub
        main.push(jx, y, jz, 0.85, 0.85, 0.02, q, col[0], col[1], col[2], 1, -1);
      }
    }
    // fortress wall along the rim + towers
    const wallR = 0.985;
    const per = 2 * Math.PI * Math.sqrt((rx * rx + rz * rz) / 2);
    const steps = Math.ceil(per / 0.4);
    const towerEvery = Math.floor(steps / 14);
    for (let i = 0; i < steps; i++) {
      const th = (i / steps) * Math.PI * 2;
      const x = tx + Math.cos(th) * rx * wallR, z = tz + Math.sin(th) * rz * wallR;
      const y0 = tsarevetsY(x, z) - 1.5;
      const tangent = V(-Math.sin(th) * rx, 0, Math.cos(th) * rz).normalize();
      const outward = V(tangent.z, 0, -tangent.x);
      if (outward.x * Math.cos(th) + outward.z * Math.sin(th) < 0) outward.negate();
      const wq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(tangent, UP, outward));
      const crenel = Math.floor(i / 2) % 2 === 0;
      const top = y0 + 7.5 + (crenel ? 0.9 : 0);
      for (let y = y0; y < top; y += 0.38) {
        const k = stoneColor(i * 0.4, y, 0.6, 0.38);
        fort.push(x, y, z, 0.3, 0.3, 0.05, wq, k[0], k[1], k[2], 1, -1);
      }
      if (i % towerEvery === 0) {
        const tc = V(x, y0, z).addScaledVector(outward, 1.2);
        const th2 = 12 + (i === 0 ? 4 : 0);
        for (let y = y0; y < y0 + th2; y += 0.4) {
          for (let a = 0; a < Math.PI * 2; a += 0.12) {
            const p = V(tc.x + Math.cos(a) * 3, y, tc.z + Math.sin(a) * 3);
            const nq = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), V(Math.cos(a), 0, Math.sin(a)));
            const kk = stoneColor(a * 3, y, 0.6, 0.4);
            fort.push(p.x, p.y, p.z, 0.3, 0.3, 0.05, nq, kk[0], kk[1], kk[2], 1, -1);
          }
        }
      }
    }
    // Patriarchal church of the Holy Ascension on the summit
    const cx = tx - 6, cz = tz, cy = tsarevetsY(cx, cz) - 0.5;
    const banded = (p) => {
      const b = ((p.y - cy) % 1.1) / 1.1;
      if (b < 0.28) return [0.62, 0.32, 0.22, -1];
      return [0.88, 0.8, 0.66, -1];
    };
    const ax = V(1, 0, 0), az = V(0, 0, 1);
    fort.box(V(cx, cy + 5, cz), ax, az, 6, 5, 13, 0.22, (p, face) => {
      if (face === 'top') return null;
      const yl = p.y - cy;
      const lz = ((p.z - cz + 13) % 3.2) / 3.2;
      if (yl > 5.5 && yl < 8.3 && lz > 0.38 && lz < 0.62 && (face === '-x' || face === '+x')) return [0.1, 0.09, 0.09, -1];
      return banded(p);
    });
    // nave roof
    for (const sgn of [-1, 1]) {
      fort.rect(V(cx + sgn * 6.4, cy + 10, cz - 13.4), V(0, 0, 26.8), V(-sgn * 6.4, 3.2, 0), 0.25, () => [0.6, 0.3, 0.2, -1], { facing: V(sgn, 1, 0) });
    }
    // drum and dome
    const dq = new THREE.Quaternion();
    for (let y = cy + 12; y < cy + 16; y += 0.25) {
      for (let a = 0; a < Math.PI * 2; a += 0.07) {
        const p = V(cx + Math.cos(a) * 3, y, cz + Math.sin(a) * 3);
        const nq = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), V(Math.cos(a), 0, Math.sin(a)));
        const win = ((a * 8 / Math.PI) % 1) < 0.3 && y > cy + 13 && y < cy + 15;
        const c = win ? [0.1, 0.09, 0.09] : banded(V(0, y, 0));
        fort.push(p.x, p.y, p.z, 0.2, 0.2, 0.03, nq, c[0], c[1], c[2], 1, -1);
      }
    }
    fort.ellipsoid(V(cx, cy + 16, cz), V(3.3, 2.6, 3.3), dq, 0.22, (d) => d.y > 0 ? [0.42, 0.45, 0.42, -1] : null);
    fort.beam(V(cx, cy + 18.5, cz), V(cx, cy + 20.2, cz), 0.12, [0.85, 0.7, 0.3, -1]);
    fort.beam(V(cx - 0.5, cy + 19.6, cz), V(cx + 0.5, cy + 19.6, cz), 0.1, [0.85, 0.7, 0.3, -1]);
    // bell tower at the west end (facing the old town)
    const bx = cx - 9, bz = cz + 9;
    fort.box(V(bx, cy + 10.5, bz), ax, az, 2.6, 10.5, 2.6, 0.22, (p, face) => {
      if (face === 'top') return null;
      const yl = p.y - cy;
      const la = face === '-x' || face === '+x' ? p.z - bz : p.x - bx;
      if (yl > 16.5 && yl < 19.5 && Math.abs(la) < 1.1) return null; // belfry openings
      return banded(p);
    });
    for (let s = 0; s < 18; s++) {
      const t = s / 18;
      const hw = 2.9 * (1 - t);
      const y = cy + 21 + t * 4;
      for (const [a, b] of [[V(bx - hw, y, bz - hw), V(bx + hw, y, bz - hw)], [V(bx + hw, y, bz - hw), V(bx + hw, y, bz + hw)], [V(bx + hw, y, bz + hw), V(bx - hw, y, bz + hw)], [V(bx - hw, y, bz + hw), V(bx - hw, y, bz - hw)]]) {
        fort.beam(a, b, 0.26, [0.6, 0.3, 0.2, -1], 0.2);
      }
    }
    fort.blob(V(bx, cy + 18, bz), 0.6, 60, 0.15, () => [0.55, 0.45, 0.25, -1]); // bell
  }

  // ------------------------------------------------ bake the sun
  onStatus('Изпичане на светлината…');
  const bake = (p, nrm, rgb, ao) => {
    const far = ao < 0;
    ao = Math.abs(ao);
    const ndl = Math.max(0, nrm.dot(SUN));
    const sh = ndl > 0 ? (far ? 1 : shadows.lit(p.x + nrm.x * 0.03, p.y + nrm.y * 0.03, p.z + nrm.z * 0.03)) : 0;
    const amb = 0.6 * ao * (0.84 + 0.16 * nrm.y);
    const sun = 0.8 * ndl * sh * (0.6 + 0.4 * ao);
    rgb[0] *= amb * SKYC[0] + sun * SUNC[0];
    rgb[1] *= amb * SKYC[1] + sun * SUNC[1];
    rgb[2] *= amb * SKYC[2] + sun * SUNC[2];
  };
  main.bake(bake);
  fort.bake(bake);

  // autofocus proxies for the far view
  const farProxy = new THREE.Mesh(new THREE.PlaneGeometry(400, 200));
  farProxy.position.set(TSAREVETS.x - TSAREVETS.rx, 0, TSAREVETS.z);
  farProxy.lookAt(0, 0, TSAREVETS.z);
  focusProxies.push(farProxy);
  const groundProxy = new THREE.Mesh(new THREE.PlaneGeometry(10, 60));
  groundProxy.rotation.x = -Math.PI / 2 + Math.atan(0.065);
  groundProxy.position.set(0, groundY(-15), -15);
  focusProxies.push(groundProxy);

  return {
    meshes: {
      main: main.toMesh(),
      glow: glow.toMesh(),
      fort: fort.toMesh(),
    },
    counts: { main: main.n, glow: glow.n, fort: fort.n },
    lamps,
    colliders,
    focusProxies,
  };
}
