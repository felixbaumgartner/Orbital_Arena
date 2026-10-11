// One full-screen pass for the camera's personality:
//  - sun rays: bright sky near the sun smeared toward the viewer, so clouds,
//    planes and buildings in front of the sun cast visible shafts
//  - speed blur: a radial streak at the screen edges when diving or boosting
//  - damage: a slight colour split when the plane is close to going down
// Runs in HDR before bloom, so the rays and streaks glow naturally.

import * as THREE from 'three';

export const CinematicShader = {
  name: 'CinematicShader',
  defines: { RAY_SAMPLES: 36, BLUR_SAMPLES: 10 },
  uniforms: {
    tDiffuse: { value: null },
    sunUv: { value: new THREE.Vector2(0.5, 0.5) },
    sunStrength: { value: 0 },
    sunColor: { value: new THREE.Color(1, 0.9, 0.7) },
    speedBlur: { value: 0 },
    aberration: { value: 0 },
    aspect: { value: 1.6 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 sunUv;
    uniform float sunStrength;
    uniform vec3 sunColor;
    uniform float speedBlur;
    uniform float aberration;
    uniform float aspect;
    varying vec2 vUv;

    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    void main() {
      vec2 fromCenter = vUv - 0.5;
      vec4 base;
      if (aberration > 0.0) {
        vec2 off = fromCenter * aberration;
        base = vec4(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b, 1.0);
      } else {
        base = texture2D(tDiffuse, vUv);
      }
      vec3 col = base.rgb;

      // Speed blur: march toward the centre, stronger at the edges
      if (speedBlur > 0.0) {
        float edge = smoothstep(0.12, 0.62, length(fromCenter * vec2(aspect, 1.0)) / aspect * 1.6);
        if (edge > 0.0) {
          vec2 stepv = fromCenter * speedBlur * 0.03 / float(BLUR_SAMPLES);
          vec3 acc = col;
          vec2 uv = vUv;
          for (int i = 0; i < BLUR_SAMPLES; i++) {
            uv -= stepv;
            acc += texture2D(tDiffuse, uv).rgb;
          }
          col = mix(col, acc / float(BLUR_SAMPLES + 1), edge);
        }
      }

      // Sun rays: accumulate bright pixels along the line to the sun
      if (sunStrength > 0.0) {
        vec2 delta = (vUv - sunUv) * (0.9 / float(RAY_SAMPLES));
        vec2 uv = vUv;
        float decay = 1.0;
        vec3 rays = vec3(0.0);
        for (int i = 0; i < RAY_SAMPLES; i++) {
          uv -= delta;
          vec3 s = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
          float b = max(0.0, luma(s) - 0.9);
          rays += s * b * decay;
          decay *= 0.955;
        }
        float dist = length((vUv - sunUv) * vec2(aspect, 1.0));
        col += rays * sunColor * sunStrength * (0.13 / float(RAY_SAMPLES) * 36.0) * smoothstep(1.4, 0.0, dist);
      }

      gl_FragColor = vec4(col, base.a);
    }
  `,
};
