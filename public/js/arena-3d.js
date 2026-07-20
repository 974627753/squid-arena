// ===== ARÈNE 3D — "1,2,3 SOLEIL" MULTIJOUEUR =====
// Rend les joueurs, le sol, la ligne d'arrivée et le poteau lumineux en 3D
// via Three.js. Les coordonnées serveur (x, y en pixels 2D) sont converties
// en coordonnées monde (x, z) ; toute la logique de partie reste côté serveur,
// ce module ne fait que l'affichage.

(function () {
  const ARENA_WIDTH = 900;
  const START_Y = 440;
  const FINISH_Y = 60;
  const BOUND_MAX_Y = 490;
  const SCALE = 15; // pixels serveur -> unités monde 3D

  const COLOR_ME = 0x3fb6ff;
  const COLOR_PLAYER = 0x29ffa3;
  const COLOR_ELIMINATED = 0x3a4150;
  const COLOR_FINISHED = 0xffd23b;

  class Arena3D {
    constructor(container) {
      this.container = container;
      this.playerEntries = new Map(); // userId -> render state
      this.clock = new THREE.Clock();

      this._buildScene();
      this._buildTagLayer();

      this._onResize = this._onResize.bind(this);
      window.addEventListener('resize', this._onResize);

      this._tick = this._tick.bind(this);
      this._rafId = requestAnimationFrame(this._tick);
    }

    // ===== CONVERSION COORDONNÉES SERVEUR (px) -> MONDE 3D =====
    worldX(serverX) { return (serverX - ARENA_WIDTH / 2) / SCALE; }
    worldZ(serverY) { return (serverY - START_Y) / SCALE; }

    // ===== CONSTRUCTION DE LA SCÈNE =====
    _buildScene() {
      const w = Math.max(this.container.clientWidth, 1);
      const h = Math.max(this.container.clientHeight, 1);

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0a0d12);
      this.scene.fog = new THREE.Fog(0x0a0d12, 26, 78);

      const finishZ = this.worldZ(FINISH_Y);
      const backZ = this.worldZ(BOUND_MAX_Y);
      const centerZ = (finishZ + backZ) / 2;

      this.camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 200);
      this.camera.position.set(0, 24, backZ + 16);
      this.camera.lookAt(0, 0, centerZ);

      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.renderer.setSize(w, h);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.container.appendChild(this.renderer.domElement);

      // ----- Lumières -----
      this.scene.add(new THREE.AmbientLight(0x8891a3, 0.6));

      const key = new THREE.DirectionalLight(0xfff2df, 1.15);
      key.position.set(18, 30, backZ + 10);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -40; key.shadow.camera.right = 40;
      key.shadow.camera.top = 30; key.shadow.camera.bottom = -40;
      key.shadow.camera.near = 1; key.shadow.camera.far = 100;
      this.scene.add(key);

      const rim = new THREE.DirectionalLight(0x29ffa3, 0.25);
      rim.position.set(-20, 12, finishZ - 10);
      this.scene.add(rim);

      // ----- Sol -----
      const groundW = ARENA_WIDTH / SCALE + 8;
      const groundD = (backZ - finishZ) + 8;
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(groundW, groundD),
        new THREE.MeshStandardMaterial({ color: 0x12161d, roughness: 0.95, metalness: 0.05 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(0, 0, centerZ);
      ground.receiveShadow = true;
      this.scene.add(ground);

      const grid = new THREE.GridHelper(Math.max(groundW, groundD), 22, 0x262c37, 0x161a21);
      grid.position.set(0, 0.01, centerZ);
      this.scene.add(grid);

      // ----- Ligne d'arrivée -----
      const finishLine = new THREE.Mesh(
        new THREE.BoxGeometry(groundW - 2, 0.12, 0.5),
        new THREE.MeshStandardMaterial({ color: 0xffd23b, emissive: 0xffd23b, emissiveIntensity: 0.55 })
      );
      finishLine.position.set(0, 0.07, finishZ);
      this.scene.add(finishLine);

      [-groundW / 2 + 1.4, groundW / 2 - 1.4].forEach((x) => {
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.35, 0.4, 5.5, 12),
          new THREE.MeshStandardMaterial({ color: 0x181d26, metalness: 0.4, roughness: 0.5 })
        );
        pillar.position.set(x, 2.75, finishZ);
        pillar.castShadow = true;
        this.scene.add(pillar);

        const beacon = new THREE.PointLight(0xffd23b, 1.1, 12);
        beacon.position.set(x, 5.8, finishZ);
        this.scene.add(beacon);
      });

      // ----- Rectangle de départ -----
      const rectX = ARENA_WIDTH / 2 - 100, rectW = 200, rectH = 50;
      const rx0 = this.worldX(rectX), rx1 = this.worldX(rectX + rectW);
      const rz0 = this.worldZ(START_Y), rz1 = this.worldZ(START_Y + rectH);
      const pts = [
        new THREE.Vector3(rx0, 0.05, rz0), new THREE.Vector3(rx1, 0.05, rz0),
        new THREE.Vector3(rx1, 0.05, rz1), new THREE.Vector3(rx0, 0.05, rz1),
        new THREE.Vector3(rx0, 0.05, rz0)
      ];
      const startLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x29ffa3 })
      );
      this.scene.add(startLine);

      // ----- Poteau lumineux (sentinelle générique feu vert / feu rouge) -----
      this.tower = this._buildTower();
      this.tower.position.set(0, 0, finishZ - 3.5);
      this.tower.rotation.y = Math.PI;
      this.scene.add(this.tower);
    }

    _buildTower() {
      const group = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x181d26, metalness: 0.55, roughness: 0.4 });

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 8.5, 12), bodyMat);
      pole.position.y = 4.25;
      pole.castShadow = true;
      group.add(pole);

      const head = new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 16), new THREE.MeshStandardMaterial({ color: 0x0f1319, metalness: 0.6, roughness: 0.3 }));
      head.position.y = 8.8;
      group.add(head);

      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 16, 16),
        new THREE.MeshStandardMaterial({ color: COLOR_PLAYER, emissive: COLOR_PLAYER, emissiveIntensity: 1.3 })
      );
      eye.position.set(0, 8.8, 0.9);
      group.add(eye);
      this.towerEye = eye;

      this.towerLight = new THREE.PointLight(COLOR_PLAYER, 1.3, 14);
      this.towerLight.position.set(0, 8.8, 1.4);
      group.add(this.towerLight);

      return group;
    }

    _buildTagLayer() {
      this.tagLayer = document.createElement('div');
      this.tagLayer.className = 'mp-tag-layer';
      this.container.appendChild(this.tagLayer);
    }

    // ===== PERSONNAGE (silhouette simple, faite de primitives) =====
    _buildCharacter(color) {
      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.08 });

      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.75, 10), mat);
      torso.position.y = 1.02;
      torso.castShadow = true;
      group.add(torso);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.26, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0xf1c9a0, roughness: 0.7 })
      );
      head.position.y = 1.62;
      head.castShadow = true;
      group.add(head);

      const limbGeo = (r, len) => new THREE.CylinderGeometry(r, r, len, 8);

      const armL = new THREE.Mesh(limbGeo(0.08, 0.55), mat);
      armL.position.set(-0.4, 1.05, 0); armL.castShadow = true;
      const armR = new THREE.Mesh(limbGeo(0.08, 0.55), mat);
      armR.position.set(0.4, 1.05, 0); armR.castShadow = true;
      group.add(armL, armR);

      const legL = new THREE.Mesh(limbGeo(0.1, 0.6), mat);
      legL.position.set(-0.14, 0.32, 0); legL.castShadow = true;
      const legR = new THREE.Mesh(limbGeo(0.1, 0.6), mat);
      legR.position.set(0.14, 0.32, 0); legR.castShadow = true;
      group.add(legL, legR);

      // pivots pour l'animation de marche (les membres tournent autour de l'épaule/hanche)
      [armL, armR].forEach((m) => { m.geometry.translate(0, -0.275, 0); m.position.y += 0.275; });
      [legL, legR].forEach((m) => { m.geometry.translate(0, -0.3, 0); m.position.y += 0.3; });

      group.userData = { bodyMat: mat, armL, armR, legL, legR };
      return group;
    }

    // ===== MISE À JOUR DEPUIS L'ÉTAT SERVEUR =====
    update(state, meUserId) {
      const green = state.light === 'green';
      const color = green ? COLOR_PLAYER : 0xff3b5c;
      if (this.towerEye) {
        this.towerEye.material.color.setHex(color);
        this.towerEye.material.emissive.setHex(color);
        this.towerLight.color.setHex(color);
      }

      const seen = new Set();

      state.players.forEach((p) => {
        seen.add(p.userId);
        const isMe = p.userId === meUserId;
        let entry = this.playerEntries.get(p.userId);

        if (!entry) {
          const mesh = this._buildCharacter(isMe ? COLOR_ME : COLOR_PLAYER);
          this.scene.add(mesh);

          const tag = document.createElement('div');
          tag.className = 'mp-player-tag-3d' + (isMe ? ' is-me' : '');
          tag.textContent = p.username + (isMe ? ' (toi)' : '');
          this.tagLayer.appendChild(tag);

          const wx = this.worldX(p.x), wz = this.worldZ(p.y);
          mesh.position.set(wx, 0, wz);
          entry = {
            mesh, tag, isMe,
            x: wx, z: wz, targetX: wx, targetZ: wz, prevX: wx, prevZ: wz,
            heading: Math.PI, walkPhase: Math.random() * 10
          };
          this.playerEntries.set(p.userId, entry);
        }

        entry.prevX = entry.targetX;
        entry.prevZ = entry.targetZ;
        entry.targetX = this.worldX(p.x);
        entry.targetZ = this.worldZ(p.y);
        entry.eliminated = !!p.eliminated;
        entry.finished = !!p.finished;
      });

      // Nettoyage des joueurs qui ne sont plus dans l'état (fin de partie, etc.)
      Array.from(this.playerEntries.keys()).forEach((id) => {
        if (seen.has(id)) return;
        const e = this.playerEntries.get(id);
        this.scene.remove(e.mesh);
        e.tag.remove();
        this.playerEntries.delete(id);
      });

      // Couleurs selon l'état (éliminé / arrivé / en jeu)
      this.playerEntries.forEach((entry) => {
        let c = entry.isMe ? COLOR_ME : COLOR_PLAYER;
        if (entry.eliminated) c = COLOR_ELIMINATED;
        else if (entry.finished) c = COLOR_FINISHED;

        entry.mesh.userData.bodyMat.color.setHex(c);
        entry.mesh.userData.bodyMat.emissive.setHex(entry.eliminated ? 0x000000 : c);
        entry.mesh.userData.bodyMat.emissiveIntensity = entry.eliminated ? 0 : 0.15;

        entry.tag.classList.toggle('is-eliminated', entry.eliminated);
        entry.tag.classList.toggle('is-finished', entry.finished);
      });
    }

    // ===== BOUCLE DE RENDU (interpolation fluide + petite animation de marche) =====
    _tick() {
      this._rafId = requestAnimationFrame(this._tick);
      const dt = Math.min(this.clock.getDelta(), 0.1);
      const w = this.container.clientWidth, h = this.container.clientHeight;

      this.playerEntries.forEach((entry) => {
        entry.x += (entry.targetX - entry.x) * Math.min(1, dt * 8);
        entry.z += (entry.targetZ - entry.z) * Math.min(1, dt * 8);

        const moveDX = entry.targetX - entry.prevX;
        const moveDZ = entry.targetZ - entry.prevZ;
        const moving = Math.hypot(moveDX, moveDZ) > 0.002 && !entry.eliminated && !entry.finished;

        if (moving) {
          const angle = Math.atan2(moveDX, moveDZ);
          entry.heading += this._angleDiff(entry.heading, angle) * Math.min(1, dt * 10);
          entry.walkPhase += dt * 9;
          const swing = Math.sin(entry.walkPhase) * 0.55;
          entry.mesh.userData.legL.rotation.x = swing;
          entry.mesh.userData.legR.rotation.x = -swing;
          entry.mesh.userData.armL.rotation.x = -swing * 0.7;
          entry.mesh.userData.armR.rotation.x = swing * 0.7;
          entry.mesh.position.y = Math.abs(Math.sin(entry.walkPhase * 2)) * 0.05;
        } else {
          entry.mesh.userData.legL.rotation.x *= 0.8;
          entry.mesh.userData.legR.rotation.x *= 0.8;
          entry.mesh.userData.armL.rotation.x *= 0.8;
          entry.mesh.userData.armR.rotation.x *= 0.8;
          entry.mesh.position.y *= 0.8;
        }

        entry.mesh.position.x = entry.x;
        entry.mesh.position.z = entry.z;
        entry.mesh.rotation.y = entry.heading;

        // Projection écran pour l'étiquette de nom (DOM au-dessus du canvas)
        const worldPos = new THREE.Vector3(entry.x, 2.0, entry.z).project(this.camera);
        const visible = worldPos.z < 1;
        entry.tag.style.display = visible ? 'block' : 'none';
        if (visible) {
          entry.tag.style.left = ((worldPos.x * 0.5 + 0.5) * w) + 'px';
          entry.tag.style.top = ((-worldPos.y * 0.5 + 0.5) * h) + 'px';
        }
      });

      if (this.towerLight) {
        this.towerLight.intensity = 1.2 + Math.sin(performance.now() / 260) * 0.2;
      }

      this.renderer.render(this.scene, this.camera);
    }

    _angleDiff(a, b) {
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return d;
    }

    _onResize() {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      if (!w || !h) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }

    dispose() {
      cancelAnimationFrame(this._rafId);
      window.removeEventListener('resize', this._onResize);
      this.playerEntries.forEach((e) => { this.scene.remove(e.mesh); e.tag.remove(); });
      this.playerEntries.clear();
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      if (this.tagLayer.parentNode) this.tagLayer.parentNode.removeChild(this.tagLayer);
    }
  }

  window.Arena3D = Arena3D;
})();
