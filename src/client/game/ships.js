// Aircraft construction, tracers and gun fire.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import * as THREE from 'three';
import { GAME_CONFIG, PLAYER_COLORS, PAINTS } from '../config.js';

export class ShipMethods {
  // =========================================================================
  // PLAYER SHIP
  // =========================================================================

  getPlayerColor(playerId) {
    let hash = 0;
    for (let i = 0; i < playerId.length; i++) {
      hash = ((hash << 5) - hash) + playerId.charCodeAt(i);
      hash |= 0;
    }
    return PLAYER_COLORS[Math.abs(hash) % PLAYER_COLORS.length];
  }

  createPlayerShip(color, plane = 'scout', cosmetics = null) {
    // Paint schemes replace the body colour; the accent glows on the fins
    const paint = cosmetics && PAINTS[cosmetics.paint];
    if (paint && paint.body !== null) { color = paint.body; }
    const accent = paint && paint.accent !== null ? paint.accent : color;

    const modelled = this.createModelledShip(color, accent, plane);
    if (modelled) return modelled;

    const planeGroup = new THREE.Group();
    // Class silhouettes: the bomber is broad and heavy, the interceptor slim
    if (plane === 'bomber') planeGroup.scale.set(1.3, 1.15, 1.2);
    else if (plane === 'interceptor') planeGroup.scale.set(0.85, 0.9, 1.05);
    planeGroup.userData.plane = plane;
    // Heading first, then pitch about the nose axis, then bank — the default
    // XYZ order pitched about the WORLD x axis, which rolled the plane
    // sideways whenever it wasn't flying due north
    planeGroup.rotation.order = 'YXZ';

    const mainMat = new THREE.MeshStandardMaterial({
      color, metalness: 0.8, roughness: 0.15, side: THREE.DoubleSide,
    });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xEEEEEE, metalness: 0.95, roughness: 0.05 });
    const glowMat = new THREE.MeshStandardMaterial({
      color: accent, emissive: accent, emissiveIntensity: 0.8, metalness: 0.5, roughness: 0.3,
    });

    const fuselageGeo = new THREE.CylinderGeometry(0.5, 0.85, 10, 12);
    const fuselage = new THREE.Mesh(fuselageGeo, mainMat);
    fuselage.rotation.x = Math.PI / 2;
    planeGroup.add(fuselage);

    const noseGeo = new THREE.ConeGeometry(0.5, 3.5, 12);
    const nose = new THREE.Mesh(noseGeo, chromeMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0, -6.7);
    planeGroup.add(nose);

    const canopyGeo = new THREE.SphereGeometry(0.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0x66AAFF, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.45,
    });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(0, 0.5, -2.5);
    planeGroup.add(canopy);

    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, -1.5);
    wingShape.lineTo(10, 2.5);
    wingShape.lineTo(9, 4.5);
    wingShape.lineTo(0, 2);
    wingShape.lineTo(-9, 4.5);
    wingShape.lineTo(-10, 2.5);
    wingShape.closePath();
    const wingGeo = new THREE.ShapeGeometry(wingShape);
    const wing = new THREE.Mesh(wingGeo, mainMat);
    wing.rotation.x = -Math.PI / 2;
    wing.position.set(0, -0.05, 0);
    planeGroup.add(wing);

    const stripeGeo = new THREE.BoxGeometry(0.15, 0.15, 8);
    const leftStripe = new THREE.Mesh(stripeGeo, glowMat);
    leftStripe.position.set(0.6, 0, 0);
    planeGroup.add(leftStripe);
    const rightStripe = new THREE.Mesh(stripeGeo, glowMat);
    rightStripe.position.set(-0.6, 0, 0);
    planeGroup.add(rightStripe);

    const finGeo = new THREE.BoxGeometry(0.15, 3.5, 2.5);
    const leftFin = new THREE.Mesh(finGeo, mainMat);
    leftFin.position.set(-1.2, 1.5, 4);
    leftFin.rotation.z = -0.3;
    planeGroup.add(leftFin);
    const rightFin = new THREE.Mesh(finGeo, mainMat);
    rightFin.position.set(1.2, 1.5, 4);
    rightFin.rotation.z = 0.3;
    planeGroup.add(rightFin);

    const tailGeo = new THREE.BoxGeometry(5, 0.12, 2);
    const tail = new THREE.Mesh(tailGeo, mainMat);
    tail.position.set(0, 0, 4.2);
    planeGroup.add(tail);

    const exhaustGeo = new THREE.CylinderGeometry(0.35, 0.45, 1.5, 8);
    const exhaustMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.95, roughness: 0.15 });
    const leftExhaust = new THREE.Mesh(exhaustGeo, exhaustMat);
    leftExhaust.rotation.x = Math.PI / 2;
    leftExhaust.position.set(-0.6, 0, 5.5);
    planeGroup.add(leftExhaust);
    const rightExhaust = new THREE.Mesh(exhaustGeo, exhaustMat);
    rightExhaust.rotation.x = Math.PI / 2;
    rightExhaust.position.set(0.6, 0, 5.5);
    planeGroup.add(rightExhaust);

    const abGeo = new THREE.SphereGeometry(0.3, 8, 8);
    const abMat = new THREE.MeshStandardMaterial({
      color: 0xFF6600, emissive: 0xFF4400, emissiveIntensity: 2.0, transparent: true, opacity: 0.85,
    });
    const leftAB = new THREE.Mesh(abGeo, abMat);
    leftAB.position.set(-0.6, 0, 6.3);
    planeGroup.add(leftAB);
    const rightAB = new THREE.Mesh(abGeo, abMat);
    rightAB.position.set(0.6, 0, 6.3);
    planeGroup.add(rightAB);

    const navGeo = new THREE.SphereGeometry(0.2, 6, 6);
    const navMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5 });
    const leftNav = new THREE.Mesh(navGeo, navMat);
    leftNav.position.set(-9.5, 0.1, 2.8);
    planeGroup.add(leftNav);
    const rightNav = new THREE.Mesh(navGeo, navMat);
    rightNav.position.set(9.5, 0.1, 2.8);
    planeGroup.add(rightNav);

    planeGroup.userData.leftAB = leftAB;
    planeGroup.userData.rightAB = rightAB;
    planeGroup.userData.navLights = [leftNav, rightNav];
    planeGroup.userData.glowMat = glowMat;
    planeGroup.userData.abMat = abMat;

    planeGroup.traverse(child => {
      if (child.isMesh) child.castShadow = true;
    });

    return planeGroup;
  }

  createProjectile() {
    if (!this.tracerGeo) {
      this.tracerGeo = new THREE.CylinderGeometry(0.16, 0.26, 5.5, 6);
      this.tracerGeo.rotateX(Math.PI / 2); // axis along +Z so lookAt() aims it
      this.tracerMat = new THREE.MeshBasicMaterial({ color: GAME_CONFIG.PROJECTILE_COLOR, toneMapped: false });
      this.tracerMat.userData.shared = true;
      this.tracerGlowMat = new THREE.SpriteMaterial({
        map: this.textures.glow(), color: 0xFFC46B, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0.9,
      });
      this.tracerGlowMat.userData.shared = true;
    }
    const group = new THREE.Group();
    const rod = new THREE.Mesh(this.tracerGeo, this.tracerMat);
    group.add(rod);
    const glow = new THREE.Sprite(this.tracerGlowMat);
    glow.scale.set(2.6, 2.6, 1);
    group.add(glow);
    return group;
  }

  /**
   * A plane from the Blender models: Body takes the team/paint colour,
   * Accent the trim, propellers spin, and nav lights ride the wingtips.
   */
  createModelledShip(color, accent, plane) {
    const key = ['interceptor', 'bomber', 'scout'].includes(plane) ? plane : 'scout';
    const model = this.cloneModel(key);
    if (!model) return null;
    const group = new THREE.Group();
    group.rotation.order = 'YXZ';
    group.userData.plane = plane;
    group.userData.props = [];
    const bodyColor = new THREE.Color(color);
    const accentColor = new THREE.Color(accent);
    model.traverse((c) => {
      // Only the propeller root (a multi-material prop exports as a group with 'Prop_x_1' children)
      if (c.name.startsWith('Prop') && !(c.parent && c.parent.name.startsWith('Prop'))) group.userData.props.push(c);
      if (!c.isMesh || !c.material) return;
      const n = c.material.name;
      if (n === 'Body') {
        c.material.color.copy(bodyColor);
        c.material.metalness = 0.35;
        c.material.roughness = 0.4;
      } else if (n === 'Accent') {
        c.material.color.copy(accentColor);
        c.material.emissive = accentColor.clone().multiplyScalar(0.25);
        c.material.metalness = 0.3;
        c.material.roughness = 0.45;
      }
    });
    group.add(model);

    // Wingtip nav lights (red left, green right) and a white tail light
    const span = key === 'bomber' ? 9.4 : key === 'scout' ? 7.2 : 6.4;
    const wingY = key === 'scout' ? 1.15 : -0.3;
    const wingZ = key === 'bomber' ? -0.6 : key === 'scout' ? -1.2 : -1.0;
    const mk = (hex, x, y, z) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6),
        new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 1.5 }));
      m.position.set(x, y, z);
      group.add(m);
      return m;
    };
    group.userData.navLights = [mk(0xff3030, -span, wingY, wingZ), mk(0x30ff60, span, wingY, wingZ), mk(0xffffff, 0, 1.4, key === 'bomber' ? 6.2 : 4.4)];
    return group;
  }

  /** Points a tracer along its velocity (call once after velocity is set) */
  orientProjectile(projectile) {
    if (!projectile.velocity) return;
    const target = this._orientVec || (this._orientVec = new THREE.Vector3());
    target.copy(projectile.position).add(projectile.velocity);
    projectile.lookAt(target);
  }

  fireProjectile(ship) {
    // Fire along the nose, including climb/dive pitch
    const cp = Math.cos(this.pitchAngle);
    const sp = Math.sin(this.pitchAngle);
    const dir = {
      x: -Math.sin(this.shipRotation) * cp,
      y: sp,
      z: -Math.cos(this.shipRotation) * cp,
    };
    this.applyAimAssist(ship, dir);

    const projectile = this.createProjectile();
    const spawnDist = 8;
    projectile.position.set(
      ship.position.x + dir.x * spawnDist,
      ship.position.y + dir.y * spawnDist,
      ship.position.z + dir.z * spawnDist
    );
    projectile.velocity = new THREE.Vector3(dir.x, dir.y, dir.z)
      .multiplyScalar(GAME_CONFIG.PROJECTILE_SPEED);
    this.orientProjectile(projectile);
    const projectileId = `${this.localPlayer.id}_${Date.now()}`;
    this.scene.add(projectile);
    this.projectiles.set(projectileId, projectile);
    this.playSound('shot');
    this.shake(0.05, 0.07); // recoil kick

    if (this.socket && this.isConnected) {
      this.socket.emit('fireProjectile', {
        gameId: this.gameState?.id,
        position: projectile.position,
        direction: dir,
        projectileId,
      });
    }
  }
}
