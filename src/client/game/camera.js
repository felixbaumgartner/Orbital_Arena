// Camera modes: the chase camera (default) and a first-person cockpit with
// a live instrument panel, canopy frame, engine cowling and propeller blur.
// Z (or B on a controller) looks behind you in either mode; the right
// stick looks around.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import * as THREE from 'three';
import { GAME_CONFIG } from '../config.js';

/** Own plane renders on this layer so the cockpit camera can skip it */
export const OWN_PLANE_LAYER = 1;

/** Pilot's eye position in plane space, per class */
const EYE = {
  scout: new THREE.Vector3(0, 1.45, -1.0),
  interceptor: new THREE.Vector3(0, 1.3, -1.3),
  bomber: new THREE.Vector3(0, 1.2, -2.7),
  primitive: new THREE.Vector3(0, 1.1, -2.2),
};

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();

export class CameraMethods {
  // =========================================================================
  // CAMERA MODES & COCKPIT
  // =========================================================================

  initCameraModes() {
    this.cameraMode = 'chase';
    this.look = { yaw: 0, pitch: 0, back: false };
    this.cockpit = null;
    // The camera must be in the scene for the cockpit (its child) to render
    this.scene.add(this.camera);
    this.camera.layers.enable(OWN_PLANE_LAYER);
    if (this.sunLight) this.sunLight.shadow.camera.layers.enable(OWN_PLANE_LAYER);
  }

  /** Puts the local plane on its own layer (call after creating it) */
  markOwnPlane(ship) {
    if (ship) ship.traverse((o) => o.layers.set(OWN_PLANE_LAYER));
  }

  /** Every frame starts in chase terms; the cockpit branch flips it back */
  resetCameraLayers() {
    this.camera.layers.enable(OWN_PLANE_LAYER);
    if (this.cockpit) this.cockpit.visible = false;
  }

  toggleCameraMode() {
    this.setCameraMode(this.cameraMode === 'chase' ? 'cockpit' : 'chase');
  }

  setCameraMode(mode) {
    this.cameraMode = mode;
    const cockpit = mode === 'cockpit';
    if (cockpit && !this.cockpit) this.buildCockpit();
    if (this.cockpit) this.cockpit.visible = cockpit;
    if (cockpit) this.camera.layers.disable(OWN_PLANE_LAYER);
    else this.camera.layers.enable(OWN_PLANE_LAYER);
    document.body.classList.toggle('cockpit', cockpit);
    this.instruments.toast(cockpit ? '🛩️' : '🎥', cockpit ? 'Cockpit view' : 'Chase view', `${this.isTouch ? '' : 'V'} to switch · ${this.isTouch ? '' : 'Z to look back'}`);
  }

  /** Procedural cockpit, parented to the camera (the camera is in the scene) */
  buildCockpit() {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x22272b, roughness: 0.7, metalness: 0.4 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x3a4248, roughness: 0.5, metalness: 0.6 });
    this.cockpitPaint = new THREE.MeshStandardMaterial({ color: 0x2f6fd6, roughness: 0.45, metalness: 0.35 });

    // Instrument panel with a live gauge face
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 160;
    this.gaugeCanvas = canvas;
    this.gaugeTex = new THREE.CanvasTexture(canvas);
    this.gaugeTex.colorSpace = THREE.SRGBColorSpace;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.62, 0.12), dark);
    panel.position.set(0, -0.78, -1.15);
    panel.rotation.x = -0.35;
    g.add(panel);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.53),
      new THREE.MeshBasicMaterial({ map: this.gaugeTex, toneMapped: false }));
    face.position.set(0, -0.76, -1.088);
    face.rotation.x = -0.35;
    g.add(face);
    // Glare shield over the panel
    const shield = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.07, 0.42), dark);
    shield.position.set(0, -0.44, -1.22);
    g.add(shield);

    // Canopy bow (arch in front) and side rails
    const bow = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.035, 6, 24, Math.PI), frame);
    bow.position.set(0, -0.42, -1.45);
    g.add(bow);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 2.6), frame);
      rail.position.set(s * 1.05, -0.42, -0.4);
      g.add(rail);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 6), frame);
      strut.position.set(s * 0.72, 0.18, -1.45);
      strut.rotation.z = s * 0.62;
      g.add(strut);
    }

    // Engine cowling and the spinning propeller ahead
    const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.8, 2.4, 20, 1, true), this.cockpitPaint);
    cowl.rotation.x = Math.PI / 2;
    cowl.position.set(0, -1.2, -3.6);
    g.add(cowl);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.7, 40), new THREE.MeshBasicMaterial({
      map: this.makePropBlurTexture(), transparent: true, depthWrite: false, opacity: 0.8,
    }));
    disc.position.set(0, -1.15, -4.85);
    g.add(disc);
    this.propDisc = disc;

    g.traverse((o) => { o.castShadow = false; o.receiveShadow = false; o.renderOrder = 10; });
    this.camera.add(g);
    this.cockpit = g;
  }

  makePropBlurTexture() {
    const s = 256, c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    const grd = ctx.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(40,40,40,0.0)');
    grd.addColorStop(0.15, 'rgba(30,30,30,0.5)');
    grd.addColorStop(0.9, 'rgba(25,25,25,0.38)');
    grd.addColorStop(1, 'rgba(25,25,25,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, s, s);
    // Two faint blade streaks
    ctx.strokeStyle = 'rgba(15,15,15,0.55)';
    ctx.lineWidth = 18;
    ctx.beginPath(); ctx.moveTo(s / 2, s * 0.06); ctx.lineTo(s / 2, s * 0.94); ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }

  /** Redraws the gauges a few times a second */
  updateGauges(speed, alt, headingDeg, vs) {
    if (!this.gaugeCanvas) return;
    this.gaugeTimer = (this.gaugeTimer || 0) - (this.realDelta || 0.016);
    if (this.gaugeTimer > 0) return;
    this.gaugeTimer = 0.1;
    const c = this.gaugeCanvas, g = c.getContext('2d');
    g.fillStyle = '#121619';
    g.fillRect(0, 0, c.width, c.height);
    const dial = (cx, label, value, max, text, color) => {
      const r = 62, cy = 80;
      g.fillStyle = '#05080a'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#6d7a82'; g.lineWidth = 3; g.stroke();
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
        g.strokeStyle = '#cfd8dc'; g.lineWidth = i % 5 ? 1.5 : 3;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
        g.lineTo(cx + Math.cos(a) * (r - (i % 5 ? 11 : 16)), cy + Math.sin(a) * (r - (i % 5 ? 11 : 16))); g.stroke();
      }
      const a = Math.PI * 0.75 + Math.max(0, Math.min(1, value / max)) * Math.PI * 1.5;
      g.strokeStyle = color; g.lineWidth = 4;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14)); g.stroke();
      g.fillStyle = '#cfd8dc'; g.font = 'bold 15px sans-serif'; g.textAlign = 'center';
      g.fillText(label, cx, cy + 26);
      g.fillStyle = color; g.font = 'bold 17px sans-serif';
      g.fillText(text, cx, cy + 46);
    };
    dial(80, 'SPEED', speed, GAME_CONFIG.DIVE_MAX_SPEED, `${Math.round(speed * 4)}`, '#ffd23f');
    dial(256, 'ALT', alt, GAME_CONFIG.MAX_ALTITUDE, `${Math.round(alt * 3)} m`, '#7fd7ff');
    // Compass card
    const cx = 432, cy = 80, r = 62;
    g.fillStyle = '#05080a'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#6d7a82'; g.lineWidth = 3; g.stroke();
    g.save(); g.translate(cx, cy); g.rotate(-headingDeg * Math.PI / 180);
    g.fillStyle = '#cfd8dc'; g.font = 'bold 16px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, d]) => {
      const a = (d - 90) * Math.PI / 180;
      g.fillStyle = t === 'N' ? '#ff6b6b' : '#cfd8dc';
      g.fillText(t, Math.cos(a) * (r - 18), Math.sin(a) * (r - 18));
    });
    g.restore();
    g.strokeStyle = '#ffd23f'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy - r + 4); g.lineTo(cx, cy - 18); g.stroke();
    g.fillStyle = vs > 1 ? '#9be7a1' : vs < -1 ? '#ff8a80' : '#cfd8dc';
    g.font = 'bold 14px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText(`${vs > 0 ? '▲' : vs < 0 ? '▼' : '•'} ${Math.abs(Math.round(vs))}`, cx, cy + 30);
    this.gaugeTex.needsUpdate = true;
  }

  /**
   * Places the camera for the current mode after the plane has moved.
   * Returns true when it handled the camera (cockpit or look-back).
   */
  updateCameraMode(ship, speed, delta) {
    // Free look eases back to centre when released
    const L = this.look;
    if (this.padLook) {
      L.yaw += (this.padLook.x * 1.9 - L.yaw) * Math.min(1, delta * 8);
      L.pitch += (this.padLook.y * 0.9 - L.pitch) * Math.min(1, delta * 8);
    } else {
      L.yaw *= Math.exp(-6 * delta);
      L.pitch *= Math.exp(-6 * delta);
    }
    const back = L.back;
    if (this.cameraMode === 'cockpit') {
      // This frame is drawn from the seat: hide our own plane, show the cockpit
      this.camera.layers.disable(OWN_PLANE_LAYER);
      if (this.cockpit) this.cockpit.visible = true;
      const plane = ship.userData.plane && EYE[ship.userData.plane] && ship.userData.props ? ship.userData.plane : 'primitive';
      _v.copy(EYE[plane]).applyEuler(ship.rotation).add(ship.position);
      this.camera.position.copy(_v);
      _q.setFromEuler(ship.rotation);
      _e.set(-L.pitch, (back ? Math.PI : 0) - L.yaw, 0, 'YXZ');
      this.camera.quaternion.copy(_q).multiply(new THREE.Quaternion().setFromEuler(_e));
      // Engine vibration and impacts shake the cockpit
      const buzz = 0.003 + Math.min(1, speed / 130) * 0.004;
      this.camera.position.x += (Math.random() - 0.5) * buzz;
      this.camera.position.y += (Math.random() - 0.5) * buzz;
      if (this.shakeTime > 0) {
        const s = this.shakeMag * (this.shakeTime / this.shakeDur) * 0.25;
        this.camera.position.x += (Math.random() - 0.5) * s;
        this.camera.position.y += (Math.random() - 0.5) * s;
      }
      if (this.propDisc) this.propDisc.rotation.z += delta * 40;
      if (this.cockpitPaint && ship.userData.bodyColor) this.cockpitPaint.color.copy(ship.userData.bodyColor);
      this.updateGauges(speed, ship.position.y, ((-this.shipRotation * 180 / Math.PI) % 360 + 360) % 360, this.verticalSpeed || 0);
      return true;
    }
    if (back || Math.abs(L.yaw) > 0.02 || Math.abs(L.pitch) > 0.02) {
      // Chase camera swung around the plane (look back / free look)
      const yaw = this.shipRotation + (back ? Math.PI : 0) - L.yaw;
      const dist = 16;
      this.camera.position.set(
        ship.position.x + Math.sin(yaw) * dist,
        ship.position.y + 7 + L.pitch * 10,
        ship.position.z + Math.cos(yaw) * dist,
      );
      this.camera.lookAt(ship.position);
      return true;
    }
    return false;
  }
}
