// Post-processing: HDR render target with MSAA, ambient occlusion (ultra),
// the cinematic pass (sun rays, speed blur, damage aberration), bloom for
// lights, sun and fire, and an output pass for tone mapping / colour space.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CinematicShader } from './render/cinematic';

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: renderer.capabilities.isWebGL2 ? 4 : 0,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));

    // Ambient occlusion: soft contact shadows where buildings, trees and
    // fields meet. Off unless the quality preset asks for it.
    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.enabled = false;
    this.gtao.blendIntensity = 0.75;
    this.gtao.updateGtaoMaterial({ radius: 4, distanceExponent: 1.6, thickness: 4, distanceFallOff: 1, scale: 1, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    // Transparent things (smoke, clouds, glass, rain), sprites and the sky
    // must not write into the AO G-buffer, or they'd cast dark halos
    const gtao = this.gtao;
    gtao.overrideVisibility = function overrideVisibility() {
      const cache = this._visibilityCache;
      cache.clear();
      this.scene.traverse((o) => {
        cache.set(o, o.visible);
        const m = o.material;
        const transparent = m && (Array.isArray(m) ? m.some((x) => x.transparent) : m.transparent);
        if (o.isPoints || o.isLine || o.isSprite || transparent || o.userData.noAO || o.frustumCulled === false) o.visible = false;
      });
    };
    this.composer.addPass(this.gtao);

    this.cinematic = new ShaderPass(CinematicShader);
    this.composer.addPass(this.cinematic);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.6, 0.86);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.bloomEnabled = true;
    this.features = { rays: true, speedBlur: true, ao: false };
  }

  setBloom(enabled) {
    this.bloomEnabled = enabled;
    this.bloom.enabled = enabled;
  }

  /** Which cinematic features the quality preset can afford */
  setQuality(q) {
    this.features = {
      rays: q === 'high' || q === 'ultra',
      speedBlur: q !== 'low',
      ao: q === 'ultra',
    };
    this.gtao.enabled = this.features.ao;
    this.cinematic.material.defines.RAY_SAMPLES = q === 'ultra' ? 48 : 36;
    this.cinematic.material.needsUpdate = true;
  }

  /**
   * Per-frame camera effects. sunUv: sun position on screen (0..1) or
   * null when behind the camera; sunStrength 0..1; speed 0..1; damage 0..1.
   */
  setCinematic({ sunUv, sunStrength = 0, sunColor, speed = 0, damage = 0 }) {
    const u = this.cinematic.material.uniforms;
    const rays = this.features.rays && sunUv && sunStrength > 0.01;
    u.sunStrength.value = rays ? sunStrength : 0;
    if (rays) u.sunUv.value.set(sunUv.x, sunUv.y);
    if (sunColor) u.sunColor.value.copy(sunColor);
    u.speedBlur.value = this.features.speedBlur ? speed : 0;
    u.aberration.value = damage > 0 ? damage * 0.012 : 0;
    const size = this.renderer.getDrawingBufferSize(this._size || (this._size = new THREE.Vector2()));
    u.aspect.value = size.x / Math.max(1, size.y);
    // Skip the pass entirely when it has nothing to do
    this.cinematic.enabled = u.sunStrength.value > 0 || u.speedBlur.value > 0 || u.aberration.value > 0;
  }

  resize(width, height, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render() {
    this.composer.render();
  }
}
