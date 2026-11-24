// GPU-side relighting of splats with Spark's dyno shader graph.
// Baked colours are the "afternoon" look; this modifier shifts them to golden
// hour and night, adds warm pools from the street lanterns, haze with distance,
// and (for Tsarevets) the coloured "Sound and Light" show.
import * as THREE from 'three';
import { dyno } from '@sparkjsdev/spark';

const { Dyno, dynoBlock, Gsplat, DynoFloat, DynoVec3 } = dyno;

export function createLightingUniforms() {
  return {
    night: new DynoFloat({ value: 0 }),
    golden: new DynoFloat({ value: 0 }),
    time: new DynoFloat({ value: 0 }),
    show: new DynoFloat({ value: 1 }),
    cam: new DynoVec3({ value: new THREE.Vector3() }),
  };
}

const f = (x) => (Number.isInteger(x) ? `${x}.0` : `${x}`);

/**
 * mode: 'main' (baked albedo + lantern pools), 'glow' (emissive at night),
 *       'fort' (light show), 'generic' (any loaded splat file: warm bright
 *       pixels are treated as light sources at night).
 */
export function lightingModifier(mode, uniforms, lamps = []) {
  const id = mode;
  const lampGlsl = lamps.length
    ? `const int NL_${id} = ${lamps.length};\nconst vec3 LAMPS_${id}[${lamps.length}] = vec3[${lamps.length}](${lamps
        .map((p) => `vec3(${f(+p.x.toFixed(3))}, ${f(+p.y.toFixed(3))}, ${f(+p.z.toFixed(3))})`)
        .join(', ')});`
    : '';

  const body = (o) => {
    const lines = [];
    lines.push(`vec3 c = ${o}.rgba.rgb;`);
    lines.push(`vec3 p = ${o}.center;`);
    // day -> golden hour grade
    lines.push(`vec3 day = c * mix(vec3(1.0), vec3(1.16, 0.9, 0.7), golden);`);
    lines.push(`day = mix(day, day * vec3(0.9, 0.85, 1.0), golden * 0.3);`);
    if (mode === 'main') {
      lines.push(`vec3 L = vec3(0.0);`);
      if (lamps.length) {
        lines.push(`for (int i = 0; i < NL_${id}; i++) {`);
        lines.push(`  vec3 d = p - LAMPS_${id}[i];`);
        lines.push(`  float fl = 0.92 + 0.08 * sin(t * 9.0 + float(i) * 2.7) * sin(t * 3.1 + float(i));`);
        lines.push(`  L += vec3(1.0, 0.6, 0.28) * fl * 3.4 / (1.0 + dot(d, d) * 0.5);`);
        lines.push(`}`);
      }
      lines.push(`vec3 moon = c * vec3(0.14, 0.17, 0.28);`);
      lines.push(`vec3 nightC = moon + c * L;`);
      lines.push(`vec3 col = mix(day, nightC, night);`);
    } else if (mode === 'glow') {
      lines.push(`float lum = dot(c, vec3(0.3, 0.5, 0.2));`);
      lines.push(`vec3 dayGlass = mix(vec3(lum), c, 0.15) * 0.22 + vec3(0.07, 0.09, 0.12);`);
      lines.push(`float fl = 0.94 + 0.06 * sin(t * 7.0 + p.x * 3.0 + p.z);`);
      lines.push(`vec3 col = mix(dayGlass * mix(vec3(1.0), vec3(1.2, 0.95, 0.75), golden), c * 1.25 * fl, smoothstep(0.0, 0.6, night));`);
    } else if (mode === 'fort') {
      lines.push(`float ph = t * 0.11 + p.z * 0.012 + p.y * 0.03;`);
      lines.push(`vec3 showC = 0.5 + 0.5 * cos(6.28318 * (ph + vec3(0.0, 0.33, 0.67)));`);
      lines.push(`showC = mix(showC, vec3(1.0, 0.8, 0.5), 0.35);`);
      lines.push(`float sweep = 0.55 + 0.45 * sin(t * 0.9 + p.x * 0.05 - p.z * 0.03);`);
      lines.push(`vec3 nightC = c * vec3(0.06, 0.07, 0.11) + c * mix(vec3(1.0, 0.78, 0.5) * 0.5, showC * 1.7 * sweep, show);`);
      lines.push(`vec3 col = mix(day, nightC, night);`);
    } else {
      lines.push(`float mx = max(c.r, max(c.g, c.b));`);
      lines.push(`float mn = min(c.r, min(c.g, c.b));`);
      lines.push(`float em = smoothstep(0.62, 0.92, mx) * smoothstep(0.12, 0.4, mx - mn) * step(c.b + 0.05, c.r);`);
      lines.push(`em = max(em, smoothstep(0.9, 0.98, mx));`);
      lines.push(`vec3 nightC = c * vec3(0.12, 0.15, 0.25) + c * em * 1.4;`);
      lines.push(`vec3 col = mix(day, nightC, night);`);
    }
    // aerial perspective
    lines.push(`float dist = length(p - cam);`);
    lines.push(`vec3 hazeC = mix(mix(vec3(0.70, 0.78, 0.88), vec3(0.98, 0.72, 0.52), golden), vec3(0.03, 0.045, 0.09), night);`);
    lines.push(`float haze = (1.0 - exp(-dist * 0.0038)) * 0.8;`);
    if (mode === 'fort' || mode === 'glow') lines.push(`haze *= mix(1.0, 0.35, night);`);
    lines.push(`col = mix(col, hazeC, haze);`);
    lines.push(`${o}.rgba.rgb = col;`);
    return lines;
  };

  return dynoBlock({ gsplat: Gsplat }, { gsplat: Gsplat }, ({ gsplat }) => {
    const d = new Dyno({
      inTypes: { gsplat: Gsplat, night: 'float', golden: 'float', t: 'float', show: 'float', cam: 'vec3' },
      outTypes: { gsplat: Gsplat },
      inputs: { gsplat, night: uniforms.night, golden: uniforms.golden, t: uniforms.time, show: uniforms.show, cam: uniforms.cam },
      globals: () => (lampGlsl ? [lampGlsl] : []),
      statements: ({ inputs, outputs }) => {
        const o = outputs.gsplat;
        return [
          `${o} = ${inputs.gsplat};`,
          `if (isGsplatActive(${o}.flags)) {`,
          `  float night = ${inputs.night};`,
          `  float golden = ${inputs.golden};`,
          `  float t = ${inputs.t};`,
          `  float show = ${inputs.show};`,
          `  vec3 cam = ${inputs.cam};`,
          ...body(o).map((l) => '  ' + l),
          `}`,
        ];
      },
    });
    return { gsplat: d.outputs.gsplat };
  });
}
