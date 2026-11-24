// Post-processing: bloom for the lanterns, then a cinematic grade
// (split toning, soft shoulder, chromatic fringe, vignette, film grain).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    night: { value: 0 },
    golden: { value: 0 },
    resolution: { value: new THREE.Vector2(1, 1) },
    grain: { value: 0.035 },
    vignette: { value: 0.55 },
    fade: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time, night, golden, grain, vignette, fade;
    uniform vec2 resolution;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * r2 * 0.012;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;
      // soft highlight shoulder (linear space)
      c = c / (1.0 + c * 0.18) * 1.18;
      // split toning: cool shadows, warm highlights; teal-blue night
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = mix(vec3(0.96, 1.0, 1.05), vec3(0.85, 0.95, 1.2), night);
      vec3 hiTint = mix(vec3(1.03, 1.0, 0.95), vec3(1.08, 0.97, 0.86), golden);
      c *= mix(shadowTint, hiTint, smoothstep(0.02, 0.5, l));
      // gentle saturation boost
      c = mix(vec3(l), c, 1.08);
      // vignette
      c *= mix(1.0, smoothstep(0.75, 0.12, r2 * 1.6), vignette);
      // grain (stronger in the dark, like film)
      float g = hash(vUv * resolution + fract(time) * 100.0) - 0.5;
      c += g * grain * (0.35 + 0.65 * (1.0 - smoothstep(0.0, 0.4, l))) * 0.3;
      c *= 1.0 - fade;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export function createPost(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.35, 0.6, 0.9);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  return {
    composer,
    bloom,
    grade,
    setSize(w, h) {
      composer.setSize(w, h);
      grade.uniforms.resolution.value.set(w, h);
    },
  };
}
