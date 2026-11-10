// Camera modes: the chase camera (default) and a first-person cockpit with
// a live instrument panel, canopy frame, engine cowling and propeller blur.
// Z (or B on a controller) looks behind you in either mode; the right
// stick looks around.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import * as THREE from 'three';
import { GAME_CONFIG } from '../config.js';
import { damp, dampAngle, wrapAngle, clamp, smoothstep, noise1 } from './smooth.js';

/** Own plane renders on this layer so the cockpit camera can skip it */
export const OWN_PLANE_LAYER = 1;

/** Pilot's eye position in plane space, per class */
const EYE = {
  scout: new THREE.Vector3(0, 1.45, -1.0),
  interceptor: new THREE.Vector3(0, 1.3, -1.3),
  bomber: new THREE.Vector3(0, 1.2, -2.7),
  primitive: new THREE.Vector3(0, 1.1, -2.2),
};

/** Chase view: distance, height angle above the tail, and how far it trails */
const CHASE = { dist: 16, boostDist: 18.5, elev: 0.25, lookAhead: 220, yawLag: 13, pitchLag: 9, maxYawLag: 0.3, maxPitchLag: 0.2 };
/** Seconds to blend when the view changes hands (anything else: 0.45) */
const BLEND = {
  'chase>cockpit': 0.35, 'cockpit>chase': 0.35,
  'death>replay': 0.5, 'chase>replay': 0.5, 'cockpit>replay': 0.5,
  'replay>chase': 0.6, 'replay>cockpit': 0.6, 'death>chase': 0.6, 'death>cockpit': 0.6,
};

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _target = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();

export class CameraMethods {
  // =========================================================================
  // CAMERA MODES & COCKPIT
  // =========================================================================

  initCameraModes() {
    this.cameraMode = 'chase';
    this.look = { yaw: 0, pitch: 0, back: false };
    this.cam = {
      rig: null, prevRig: null, cut: false, t: 0,
      yaw: null, pitch: 0, dist: CHASE.dist, roll: 0, fov: 75, orbit: 0,
      shake: 0, shakeRate: 0, kick: 0, drift: new THREE.Vector3(),
      blend: 1, blendDur: 0, fromPos: new THREE.Vector3(), fromQuat: new THREE.Quaternion(), fromAnchored: false,
      lastPos: new THREE.Vector3(), lastQuat: new THREE.Quaternion(), lastAnchor: new THREE.Vector3(), lastAnchored: false,
    };
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

  toggleCameraMode() {
    this.setCameraMode(this.cameraMode === 'chase' ? 'cockpit' : 'chase');
  }

  setCameraMode(mode) {
    this.cameraMode = mode;
    const cockpit = mode === 'cockpit';
    if (cockpit && !this.cockpit) this.buildCockpit();
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

  /** Forget the chase camera's lag (after a spawn or teleport) */
  resetChaseCamera() {
    if (!this.cam) return;
    this.cam.yaw = null;
    this.cam.cut = true;
  }

  /** A short push back from the guns: felt, but the aim point never moves */
  camKick(amount) {
    if (this.cam) this.cam.kick = Math.max(this.cam.kick, amount);
  }

  /**
   * Places the camera after the plane has moved: the chase view or the
   * cockpit, with look-back and free look folded into both.
   */
  placeCamera(ship, speed, delta) {
    const C = this.cam, L = this.look;
    C.t += delta;
    // Free look eases toward the stick and back to centre when released
    if (this.padLook) {
      L.yaw = damp(L.yaw, this.padLook.x * 1.9, 8, delta);
      L.pitch = damp(L.pitch, this.padLook.y * 0.9, 8, delta);
    } else {
      L.yaw = damp(L.yaw, 0, 6, delta);
      L.pitch = damp(L.pitch, 0, 6, delta);
    }
    // Look-back swings round instead of cutting
    C.orbit = damp(C.orbit, (L.back ? Math.PI : 0) - L.yaw, 14, delta);
    C.shake = Math.max(0, C.shake - C.shakeRate * delta);
    C.kick = damp(C.kick, 0, 16, delta);
    // Speed sensation: the view widens as you go faster
    C.fov = damp(C.fov, 74 + smoothstep(45, 105, speed) * 12, 3, delta);

    if (this.cameraMode === 'cockpit' && !this.takeoffPhase) this.cockpitCamera(ship, speed, delta);
    else this.chaseCamera(ship, speed, delta);

    // Photo mode: cinematic orbit around the plane
    if (this.photoMode) this.updatePhotoCamera(ship, delta);
  }

  /**
   * Chase view. The camera trails the plane with a little lag in heading
   * and pitch, but always looks down the gun line, so the centre of the
   * screen is exactly where the guns point.
   */
  chaseCamera(ship, speed, delta) {
    const C = this.cam, L = this.look, cam = this.camera;
    const yawT = this.shipRotation, pitchT = this.pitchAngle;
    if (C.yaw === null) { C.yaw = yawT; C.pitch = pitchT; C.roll = 0; C.dist = CHASE.dist; }
    C.yaw = yawT + clamp(wrapAngle(dampAngle(C.yaw, yawT, CHASE.yawLag, delta) - yawT), -CHASE.maxYawLag, CHASE.maxYawLag);
    C.pitch = pitchT + clamp(damp(C.pitch, pitchT, CHASE.pitchLag, delta) - pitchT, -CHASE.maxPitchLag, CHASE.maxPitchLag);
    const boosting = this.controlsEnabled && this.controls.boost && this.localPlayer.energy > 0;
    C.dist = damp(C.dist, boosting ? CHASE.boostDist : CHASE.dist, 3, delta);

    // 0 = flying view, 1 = swung round the plane (look back / free look)
    const w = smoothstep(0.1, 0.6, Math.abs(C.orbit));
    const yaw = C.yaw + C.orbit;
    const elev = (CHASE.elev - C.pitch) * (1 - w) + (0.41 + L.pitch * 0.6) * w;
    const d = C.dist + C.kick;
    const ce = Math.cos(elev);
    _pos.set(
      ship.position.x + Math.sin(yaw) * ce * d,
      Math.max(2.5, ship.position.y + Math.sin(elev) * d),
      ship.position.z + Math.cos(yaw) * ce * d,
    );
    // Same nose direction the guns fire along
    const cp = Math.cos(pitchT), sp = Math.sin(pitchT);
    _target.set(
      ship.position.x - Math.sin(yawT) * cp * CHASE.lookAhead,
      ship.position.y + sp * CHASE.lookAhead,
      ship.position.z - Math.cos(yawT) * cp * CHASE.lookAhead,
    );
    if (w > 0) _target.lerp(ship.position, w);
    cam.position.copy(_pos);
    cam.lookAt(_target);

    // Lean into the bank (level through a barrel roll so the view doesn't flip)
    const bank = this.rollTimer > 0 ? 0 : clamp(wrapAngle(ship.rotation.z), -0.7, 0.7) * 0.35 * (1 - w);
    C.roll = damp(C.roll, bank, 6, delta);
    cam.rotateZ(C.roll + noise1(C.t * 33, 5) * C.shake * 0.02);
    // Impacts rattle the camera sideways and up/down; the view direction holds
    if (C.shake > 0.001) {
      cam.translateX(noise1(C.t * 41, 1) * C.shake);
      cam.translateY(noise1(C.t * 37, 2) * C.shake);
    }
  }

  /** First-person view from the pilot's seat */
  cockpitCamera(ship, speed, delta) {
    const C = this.cam, L = this.look, cam = this.camera;
    const plane = ship.userData.plane && EYE[ship.userData.plane] && ship.userData.props ? ship.userData.plane : 'primitive';
    _v.copy(EYE[plane]).applyEuler(ship.rotation).add(ship.position);
    cam.position.copy(_v);
    _q.setFromEuler(ship.rotation);
    _e.set(-L.pitch, C.orbit, 0, 'YXZ');
    cam.quaternion.copy(_q).multiply(_q2.setFromEuler(_e));
    // Engine vibration and impacts shake the cockpit
    const buzz = 0.002 + Math.min(1, speed / 130) * 0.003 + C.shake * 0.12;
    cam.translateX(noise1(C.t * 90, 3) * buzz);
    cam.translateY(noise1(C.t * 77, 4) * buzz);
    if (this.propDisc) this.propDisc.rotation.z += delta * 40;
    if (this.cockpitPaint && ship.userData.bodyColor) this.cockpitPaint.color.copy(ship.userData.bodyColor);
    this.updateGauges(speed, ship.position.y, ((-this.shipRotation * 180 / Math.PI) % 360 + 360) % 360, this.verticalSpeed || 0);
  }

  /**
   * Runs once a frame after every camera (flight, replay, photo, intro) has
   * had its say. When the view changes hands it blends from the last frame
   * drawn instead of cutting, then publishes the final matrices so the HUD
   * markers project against the camera that is actually rendered.
   */
  finishCamera(dt) {
    const C = this.cam, cam = this.camera;
    const me = this.localPlayer ? this.players.get(this.localPlayer.id) : null;
    const rig = this.replay ? 'replay' : (!me || this.ending) ? 'intro' : this.dead ? 'death'
      : this.photoMode ? 'photo' : (this.cameraMode === 'cockpit' && !this.takeoffPhase) ? 'cockpit' : 'chase';
    const anchored = !!me && (rig === 'chase' || rig === 'cockpit' || rig === 'photo');

    if (rig !== C.rig) {
      let dur = 0;
      if (C.rig !== null && !C.cut && C.rig !== 'intro' && rig !== 'intro' && rig !== 'death') {
        dur = BLEND[`${C.rig}>${rig}`] ?? (rig === 'photo' || C.rig === 'photo' ? 0.6 : 0.45);
        // A jump across the map is a cut, not a swoop
        if (C.lastPos.distanceTo(cam.position) > 140) dur = 0;
      }
      if (rig === 'death' && this.localPlayer) {
        // Shot down: the camera coasts on for a moment instead of freezing
        const v = this.shipVelocity(this.localPlayer.id);
        C.drift.set(v.x, v.y, v.z).multiplyScalar(0.3);
      }
      C.prevRig = C.rig; C.rig = rig; C.blendDur = dur; C.blend = dur > 0 ? 0 : 1;
      C.fromAnchored = anchored && C.lastAnchored;
      C.fromPos.copy(C.lastPos);
      if (C.fromAnchored) C.fromPos.sub(C.lastAnchor);
      C.fromQuat.copy(C.lastQuat);
    }
    C.cut = false;

    if (rig === 'death') {
      cam.position.addScaledVector(C.drift, dt);
      if (cam.position.y < 3) cam.position.y = 3;
      C.drift.multiplyScalar(Math.exp(-1.6 * dt));
    }

    if (C.blend < 1) {
      C.blend = Math.min(1, C.blend + dt / C.blendDur);
      const s = smoothstep(0, 1, C.blend);
      _pos.copy(C.fromPos);
      if (C.fromAnchored && me) _pos.add(me.position);
      _target.copy(cam.position);
      cam.position.lerpVectors(_pos, _target, s);
      _q2.copy(cam.quaternion);
      cam.quaternion.slerpQuaternions(C.fromQuat, _q2, s);
    }

    // The cockpit shell belongs to whichever view is on screen right now
    const inCockpit = (C.blend < 0.5 ? C.prevRig : rig) === 'cockpit';
    if (inCockpit) cam.layers.disable(OWN_PLANE_LAYER); else cam.layers.enable(OWN_PLANE_LAYER);
    if (this.cockpit) this.cockpit.visible = inCockpit;

    if (Math.abs(cam.fov - C.fov) > 0.02) { cam.fov = C.fov; cam.updateProjectionMatrix(); }
    C.lastPos.copy(cam.position);
    C.lastQuat.copy(cam.quaternion);
    C.lastAnchored = anchored;
    if (me) C.lastAnchor.copy(me.position);
    cam.updateMatrixWorld(true);
  }
}
