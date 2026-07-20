// ===== ARÈNE 3D — "TIR À LA CORDE" MULTIJOUEUR =====
// Deux équipes se font face de chaque côté d'une corde ; seule la position
// du marqueur central bouge (envoyée par le serveur), les personnages restent
// à leur poste et miment l'effort de traction. Toute la physique reste
// côté serveur, ce module ne fait que l'affichage.

(function () {
  const ARENA_WIDTH = 900;
  const CENTER_SERVER = ARENA_WIDTH / 2;
  const LEFT_EDGE = 90;
  const RIGHT_EDGE = ARENA_WIDTH - 90;
  const SCALE = 15; // pixels serveur -> unités monde 3D (cohérent avec arena-3d.js)

  const COLOR_LEFT = 0x3fb6ff;   // équipe gauche : bleu
  const COLOR_RIGHT = 0xff8a3d;  // équipe droite : orange
  const COLOR_ME_GLOW = 0xffffff;

  class TugOfWar3D {
    constructor(container) {
      this.container = container;
      this.clock = new THREE.Clock();
      this.markerX = 0; // en unités monde
      this.targetMarkerX = 0;
      this.velocitySample = 0; // pour l'intensité visuelle (secousses, tension)
      this.lastMarkerServerX = CENTER_SERVER;

      this._buildScene();
      this._buildTagLayer();

      this._onResize = this._onResize.bind(this);
      window.addEventListener('resize', this._onResize);
      if (window.ResizeObserver) {
        this._resizeObserver = new ResizeObserver(this._onResize);
        this._resizeObserver.observe(this.container);
      }

      this._tick = this._tick.bind(this);
      this._rafId = requestAnimationFrame(this._tick);
    }

    worldX(serverX) { return (serverX - CENTER_SERVER) / SCALE; }

    // ===== CONSTRUCTION DE LA SCÈNE =====
    _buildScene() {
      const w = Math.max(this.container.clientWidth, 1);
      const h = Math.max(this.container.clientHeight, 1);

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0a0d12);
      this.scene.fog = new THREE.Fog(0x0a0d12, 30, 90);

      this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
      this.basePos = new THREE.Vector3(0, 15, 30);
      this.camera.position.copy(this.basePos);
      this.camera.lookAt(0, 1.4, 0);

      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.renderer.setSize(w, h);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.container.appendChild(this.renderer.domElement);

      // ----- Lumières -----
      this.scene.add(new THREE.AmbientLight(0x8891a3, 0.65));
      const key = new THREE.DirectionalLight(0xfff2df, 1.1);
      key.position.set(10, 22, 18);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -30; key.shadow.camera.right = 30;
      key.shadow.camera.top = 25; key.shadow.camera.bottom = -25;
      this.scene.add(key);

      // ----- Sol -----
      const groundW = (RIGHT_EDGE - LEFT_EDGE) / SCALE + 24;
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(groundW, 18),
        new THREE.MeshStandardMaterial({ color: 0x12161d, roughness: 0.95, metalness: 0.05 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      this.scene.add(ground);

      const grid = new THREE.GridHelper(groundW, 20, 0x262c37, 0x161a21);
      grid.position.y = 0.01;
      this.scene.add(grid);

      // ----- Zones de victoire (repères colorés au sol) -----
      const zoneLeft = this._buildZoneMarker(COLOR_LEFT, this.worldX(LEFT_EDGE));
      const zoneRight = this._buildZoneMarker(COLOR_RIGHT, this.worldX(RIGHT_EDGE));
      this.scene.add(zoneLeft, zoneRight);

      const centerLine = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.06, 3),
        new THREE.MeshStandardMaterial({ color: 0x7c8794, emissive: 0x7c8794, emissiveIntensity: 0.3 })
      );
      centerLine.position.set(0, 0.03, 0);
      this.scene.add(centerLine);

      // ----- Corde -----
      const anchorX = this.worldX(LEFT_EDGE) - 3.5;
      const anchorXR = this.worldX(RIGHT_EDGE) + 3.5;
      const ropeLength = anchorXR - anchorX;
      const rope = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, ropeLength, 10),
        new THREE.MeshStandardMaterial({ color: 0xd8b992, roughness: 0.85 })
      );
      rope.rotation.z = Math.PI / 2;
      rope.position.set((anchorX + anchorXR) / 2, 1.05, 0);
      rope.castShadow = true;
      this.scene.add(rope);
      this.anchorX = anchorX;
      this.anchorXR = anchorXR;

      // ----- Marqueur central (drapeau lumineux qui indique la position) -----
      const markerGroup = new THREE.Group();
      const markerCore = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0xffd23b, emissive: 0xffd23b, emissiveIntensity: 1.0 })
      );
      markerCore.position.y = 1.05;
      markerGroup.add(markerCore);
      const markerLight = new THREE.PointLight(0xffd23b, 1.0, 8);
      markerLight.position.y = 1.05;
      markerGroup.add(markerLight);
      this.scene.add(markerGroup);
      this.markerGroup = markerGroup;

      // ----- Équipes -----
      this.leftTeamAnchor = anchorX - 1.5;
      this.rightTeamAnchor = anchorXR + 1.5;
      this.characters = []; // { mesh, tag, team, isMe }
    }

    _buildZoneMarker(color, x) {
      const group = new THREE.Group();
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.05, 4),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 })
      );
      strip.position.set(x, 0.03, 0);
      group.add(strip);
      const glow = new THREE.PointLight(color, 0.6, 6);
      glow.position.set(x, 1.2, 0);
      group.add(glow);
      return group;
    }

    _buildTagLayer() {
      this.tagLayer = document.createElement('div');
      this.tagLayer.className = 'mp-tag-layer';
      this.container.appendChild(this.tagLayer);
    }

    // ===== PERSONNAGE (mêmes proportions simplifiées que l'arène 1,2,3 Soleil) =====
    _buildCharacter(color, facing) {
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

      const armGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.7, 8);
      const armL = new THREE.Mesh(armGeo, mat);
      const armR = new THREE.Mesh(armGeo, mat);
      armL.position.set(-0.32, 1.15, 0.28);
      armR.position.set(0.32, 1.15, 0.28);
      armL.rotation.x = -Math.PI / 2.4;
      armR.rotation.x = -Math.PI / 2.4;
      armL.castShadow = true; armR.castShadow = true;
      group.add(armL, armR);

      const legGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.6, 8);
      const legL = new THREE.Mesh(legGeo, mat);
      const legR = new THREE.Mesh(legGeo, mat);
      legL.position.set(-0.14, 0.32, 0.1);
      legR.position.set(0.14, 0.32, -0.1);
      legL.castShadow = true; legR.castShadow = true;
      group.add(legL, legR);

      group.rotation.y = facing; // fait face à la corde (vers le centre)
      group.userData = { bodyMat: mat, torso, armL, armR };
      return group;
    }

    // ===== MISE À JOUR DEPUIS L'ÉTAT SERVEUR (au démarrage du match) =====
    setupPlayers(players, meUserId) {
      // Nettoyage d'un éventuel match précédent
      this.characters.forEach((c) => { this.scene.remove(c.mesh); c.tag.remove(); });
      this.characters = [];

      const left = players.filter((p) => p.team === 'left');
      const right = players.filter((p) => p.team === 'right');

      const place = (list, anchorX, facing, dir, color) => {
        list.forEach((p, i) => {
          const isMe = p.userId === meUserId;
          const mesh = this._buildCharacter(color, facing);
          const row = Math.floor(i / 3);
          const col = i % 3;
          mesh.position.set(anchorX + dir * row * 1.1, 0, (col - 1) * 1.3);
          mesh.castShadow = true;
          this.scene.add(mesh);

          const tag = document.createElement('div');
          tag.className = 'mp-player-tag-3d' + (isMe ? ' is-me' : '');
          tag.textContent = p.username + (isMe ? ' (toi)' : '');
          this.tagLayer.appendChild(tag);

          if (isMe) {
            mesh.userData.bodyMat.emissive.setHex(COLOR_ME_GLOW);
            mesh.userData.bodyMat.emissiveIntensity = 0.25;
          }

          this.characters.push({ mesh, tag, team: p.team, isMe, baseX: mesh.position.x, walkPhase: Math.random() * 10 });
        });
      };

      // L'équipe gauche fait face à droite (+X), l'équipe droite fait face à gauche (-X)
      place(left, this.leftTeamAnchor, Math.PI / 2, -1, COLOR_LEFT);
      place(right, this.rightTeamAnchor, -Math.PI / 2, 1, COLOR_RIGHT);

      this.markerX = 0;
      this.targetMarkerX = 0;
    }

    // ===== MISE À JOUR À CHAQUE TICK SERVEUR =====
    update(state) {
      this.targetMarkerX = this.worldX(state.markerX);
      this.velocitySample = Math.abs(state.markerX - this.lastMarkerServerX);
      this.lastMarkerServerX = state.markerX;
    }

    // ===== BOUCLE DE RENDU =====
    _tick() {
      this._rafId = requestAnimationFrame(this._tick);
      const dt = Math.min(this.clock.getDelta(), 0.1);
      const w = this.container.clientWidth, h = this.container.clientHeight;

      this.markerX += (this.targetMarkerX - this.markerX) * Math.min(1, dt * 8);
      if (this.markerGroup) this.markerGroup.position.x = this.markerX;

      // Tension visuelle : plus le marqueur bouge vite, plus les personnages
      // "tirent" fort (petite oscillation) et plus la caméra vibre légèrement.
      const tension = Math.min(1, this.velocitySample * 3);
      const t = performance.now() / 1000;

      this.characters.forEach((c) => {
        const pullSway = Math.sin(t * 6 + c.walkPhase) * 0.05 * (0.3 + tension);
        c.mesh.userData.torso.rotation.x = pullSway;
        c.mesh.position.y = Math.abs(Math.sin(t * 6 + c.walkPhase)) * 0.02 * tension;

        const worldPos = new THREE.Vector3(c.mesh.position.x, 2.0, c.mesh.position.z).project(this.camera);
        const visible = worldPos.z < 1;
        c.tag.style.display = visible ? 'block' : 'none';
        if (visible) {
          c.tag.style.left = ((worldPos.x * 0.5 + 0.5) * w) + 'px';
          c.tag.style.top = ((-worldPos.y * 0.5 + 0.5) * h) + 'px';
        }
      });

      // Petite vibration de caméra proportionnelle à l'intensité de traction
      const shake = tension * 0.06;
      this.camera.position.set(
        this.basePos.x + (Math.random() - 0.5) * shake,
        this.basePos.y + (Math.random() - 0.5) * shake,
        this.basePos.z
      );
      this.camera.lookAt(this.markerX * 0.4, 1.2, 0);

      this.renderer.render(this.scene, this.camera);
    }

    _onResize() {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      if (!w || !h) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }

    dispose() {
      cancelAnimationFrame(this._rafId);
      window.removeEventListener('resize', this._onResize);
      if (this._resizeObserver) this._resizeObserver.disconnect();
      this.characters.forEach((c) => { this.scene.remove(c.mesh); c.tag.remove(); });
      this.characters = [];
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      if (this.tagLayer.parentNode) this.tagLayer.parentNode.removeChild(this.tagLayer);
    }
  }

  window.TugOfWar3D = TugOfWar3D;
})();
