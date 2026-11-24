// Sky dome: day/golden/night gradient, sun, moon, stars, soft clouds and a
// faint silhouette of the Balkan ridges on the horizon.
import * as THREE from 'three';

export function createSky() {
  const uniforms = {
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    moonDir: { value: new THREE.Vector3(0.35, 0.42, -0.84).normalize() },
    night: { value: 0 },
    golden: { value: 0 },
    time: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 sunDir, moonDir;
      uniform float night, golden, time;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float hash1(float n) { return fract(sin(n) * 43758.5453); }
      float noise(vec2 x) {
        vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        float a = hash1(i.x + i.y * 57.0), b = hash1(i.x + 1.0 + i.y * 57.0);
        float c = hash1(i.x + (i.y + 1.0) * 57.0), d = hash1(i.x + 1.0 + (i.y + 1.0) * 57.0);
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; } return v; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 dayTop = vec3(0.30, 0.52, 0.86), dayHor = vec3(0.76, 0.85, 0.94);
        vec3 gTop = vec3(0.30, 0.34, 0.58), gHor = vec3(1.0, 0.62, 0.36);
        vec3 nTop = vec3(0.012, 0.018, 0.045), nHor = vec3(0.05, 0.065, 0.12);
        float t = pow(clamp(h, 0.0, 1.0), 0.45);
        vec3 top = mix(mix(dayTop, gTop, golden), nTop, night);
        vec3 hor = mix(mix(dayHor, gHor, golden), nHor, night);
        vec3 col = mix(hor, top, t);
        // sun glow + disc
        float sd = max(dot(d, sunDir), 0.0);
        vec3 sunC = mix(vec3(1.0, 0.95, 0.85), vec3(1.0, 0.55, 0.25), golden);
        col += sunC * (pow(sd, 8.0) * 0.35 + pow(sd, 64.0) * 0.6) * (1.0 - night);
        col += sunC * smoothstep(0.9993, 0.9997, sd) * 4.0 * (1.0 - night) * step(-0.02, sunDir.y);
        // clouds
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 1.4 + vec2(time * 0.004, 0.0);
          float cl = smoothstep(0.52, 0.8, fbm(uv));
          vec3 cloudC = mix(mix(vec3(1.0), vec3(1.0, 0.72, 0.55), golden), vec3(0.08, 0.09, 0.14), night);
          col = mix(col, cloudC, cl * 0.75 * smoothstep(0.0, 0.15, h));
        }
        // stars & moon
        if (night > 0.01 && h > 0.0) {
          vec3 sp = floor(d * 380.0);
          float s = hash(sp);
          float tw = 0.6 + 0.4 * sin(time * 2.0 + s * 50.0);
          col += vec3(0.9, 0.92, 1.0) * step(0.9965, s) * tw * night * smoothstep(0.02, 0.25, h);
          float md = dot(d, moonDir);
          col += vec3(0.95, 0.93, 0.85) * smoothstep(0.99955, 0.9997, md) * night * 1.5;
          col += vec3(0.4, 0.45, 0.6) * pow(max(md, 0.0), 40.0) * night * 0.25;
        }
        // distant ridges
        float az = atan(d.z, d.x);
        float ridge = 0.018 + 0.03 * fbm(vec2(az * 2.2, 3.0)) + 0.012 * fbm(vec2(az * 9.0, 7.0));
        if (h < ridge) {
          vec3 rc = mix(mix(vec3(0.52, 0.6, 0.7), vec3(0.62, 0.42, 0.42), golden), vec3(0.02, 0.025, 0.05), night);
          col = mix(col, rc, 0.85);
        }
        if (h < 0.0) col = mix(col, hor * 0.6, smoothstep(0.0, -0.1, h));
        gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1800, 48, 24), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}
