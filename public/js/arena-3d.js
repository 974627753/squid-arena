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
  const SCALE = 11; // pixels serveur -> unités monde 3D (terrain plus grand qu'avant)

  // ----- Couleurs -----
  // IMPORTANT : COLOR_LIGHT_GREEN (feu vert du poteau + ligne de départ) est
  // volontairement séparée de la couleur des joueurs adverses. Avant, les deux
  // utilisaient le même vert néon (#29ffa3), ce qui rendait les joueurs
  // difficiles à distinguer du décor pendant le feu vert.
  const COLOR_ME = 0x3fb6ff; // bleu — toujours "moi", jamais réutilisé ailleurs
  const COLOR_ELIMINATED = 0x3a4150;
  const COLOR_FINISHED = 0xffd23b; // jaune, cohérent avec la ligne/les balises d'arrivée
  const COLOR_LIGHT_GREEN = 0x29ffa3; // réservé au poteau + ligne de départ
  const COLOR_LIGHT_RED = 0xff3b5c;

  // Palette pour les adversaires : chaque joueur reçoit une couleur stable
  // (dérivée de son userId) parmi ces teintes, toutes bien distinctes du bleu
  // "moi", du vert/rouge du feu, du jaune "arrivé" et du gris "éliminé".
  const OPPONENT_PALETTE = [0xff8a3d, 0xb388ff, 0xff5fa8, 0x4dd2ff, 0xffc24d, 0x8bd450];

  function colorForOpponent(userId) {
    const str = String(userId);
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
    return OPPONENT_PALETTE[Math.abs(hash) % OPPONENT_PALETTE.length];
  }

  class Arena3D {
    constructor(container) {
      this.container = container;
      this.playerEntries = new Map(); // userId -> render state
      this.clock = new THREE.Clock();

      // Vue caméra : "third" (par défaut, caméra à l'épaule qui suit le joueur)
      // ou "first" (vue subjective, à hauteur des yeux). Se bascule au clic sur
      // le bouton ou avec la touche C.
      this.viewMode = 'third';
      this._camLookAt = null;

      this._buildScene();
      this._buildTagLayer();
      this._buildViewToggle();

      this._onResize = this._onResize.bind(this);
      window.addEventListener('resize', this._onResize);
      // window 'resize' ne suffit pas sur mobile (rotation d'écran, barre
      // d'adresse qui apparaît/disparaît, mode split-screen...). On observe
      // aussi directement le conteneur pour rester correct sur tout appareil.
      if (window.ResizeObserver) {
        this._resizeObserver = new ResizeObserver(this._onResize);
        this._resizeObserver.observe(this.container);
      }

      this._onKeyDown = this._onKeyDown.bind(this);
      window.addEventListener('keydown', this._onKeyDown);

      this._tick = this._tick.bind(this);
      this._rafId = requestAnimationFrame(this._tick);
    }

    // ===== BASCULE DE VUE (1ère / 3e personne) =====
    _buildViewToggle() {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mp-view-toggle';
      btn.setAttribute('aria-label', 'Changer de vue caméra (1ère / 3e personne)');
      btn.addEventListener('click', () => this.toggleViewMode());
      this.container.appendChild(btn);
      this.viewToggleBtn = btn;
      this._refreshViewToggleLabel();
    }

    _refreshViewToggleLabel() {
      if (!this.viewToggleBtn) return;
      this.viewToggleBtn.textContent = this.viewMode === 'first'
        ? '🎥 Vue : 1ère personne'
        : '🎥 Vue : 3e personne';
    }

    toggleViewMode() {
      this.viewMode = this.viewMode === 'first' ? 'third' : 'first';
      this._camLookAt = null; // évite un mouvement de caméra brusque au changement
      this._refreshViewToggleLabel();
    }

    _onKeyDown(e) {
      if (e.code === 'KeyC') this.toggleViewMode();
    }

    _findMeEntry() {
      for (const entry of this.playerEntries.values()) {
        if (entry.isMe) return entry;
      }
      return null;
    }

    // ===== CONVERSION COORDONNÉES SERVEUR (px) -> MONDE 3D =====
    worldX(serverX) { return (serverX - ARENA_WIDTH / 2) / SCALE; }
    worldZ(serverY) { return (serverY - START_Y) / SCALE; }

    // ===== CONSTRUCTION DE LA SCÈNE =====
    _buildScene() {
      const w = Math.max(this.container.clientWidth, 1);
      const h = Math.max(this.container.clientHeight, 1);

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0b0f16);
      this.scene.fog = new THREE.Fog(0x0b0f16, 40, 130);

      const finishZ = this.worldZ(FINISH_Y);
      const backZ = this.worldZ(BOUND_MAX_Y);
      const centerZ = (finishZ + backZ) / 2;

      this.camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 200);
      this._applyFovForAspect(w / h);
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

      // Lueur chaude ambiante façon "nuit de stade" (projecteurs qui éclairent le ciel)
      const stadiumGlow = new THREE.HemisphereLight(0x3a4a66, 0x0a0d12, 0.35);
      this.scene.add(stadiumGlow);

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

      // ----- Lignes de "yards" façon terrain de foot américain, en travers du terrain -----
      const yardMat = new THREE.LineBasicMaterial({ color: 0x394252 });
      const yardCount = 8;
      for (let i = 1; i < yardCount; i++) {
        const z = finishZ + (groundD - 2) * (i / yardCount);
        const pts = [
          new THREE.Vector3(-groundW / 2 + 1, 0.02, z),
          new THREE.Vector3(groundW / 2 - 1, 0.02, z)
        ];
        this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), yardMat));
      }

      // ----- Ambiance stade (gradins + public + projecteurs) -----
      this._buildStadium(groundW, groundD, centerZ);

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

    // ===== AMBIANCE STADE (gradins + public + projecteurs) =====
    _buildStadium(groundW, groundD, centerZ) {
      const group = new THREE.Group();
      const margin = 2.5; // écart entre le terrain et le premier gradin
      const tiers = 5;
      const tierHeight = 1.3;
      const tierDepth = 1.35;
      const standMat = new THREE.MeshStandardMaterial({ color: 0x171b22, roughness: 0.95, metalness: 0.05 });
      const crowdColors = [0xffd23b, 0xff5fa8, 0x4dd2ff, 0xb388ff, 0xff8a3d, 0x8bd450, 0xe8ecf1, 0x3fb6ff];
      const crowdGeo = new THREE.BoxGeometry(0.3, 0.34, 0.3);

      // Construit un gradin (une tribune) le long de l'axe X, orienté vers le terrain,
      // avec du "public" (petits cubes colorés) rendu en instancié — un seul mesh GPU
      // pour des centaines de silhouettes, afin de rester léger sur mobile.
      const buildStand = (length) => {
        const stand = new THREE.Group();
        const seatPositions = [];
        const seatColors = [];

        for (let t = 0; t < tiers; t++) {
          const tier = new THREE.Mesh(new THREE.BoxGeometry(length, tierHeight, tierDepth), standMat);
          tier.position.set(0, tierHeight * (t + 0.5), -t * tierDepth * 0.92);
          tier.receiveShadow = true;
          stand.add(tier);

          const seatsOnTier = Math.max(6, Math.floor(length / 0.55));
          for (let s = 0; s < seatsOnTier; s++) {
            if (Math.random() < 0.22) continue; // sièges vides ici et là, plus réaliste
            seatPositions.push([
              -length / 2 + (s + 0.5) * (length / seatsOnTier) + (Math.random() - 0.5) * 0.15,
              tierHeight * (t + 1) + 0.17,
              -t * tierDepth * 0.92 + (Math.random() - 0.5) * 0.3
            ]);
            seatColors.push(crowdColors[Math.floor(Math.random() * crowdColors.length)]);
          }
        }

        const crowdMesh = new THREE.InstancedMesh(
          crowdGeo, new THREE.MeshStandardMaterial({ roughness: 1 }), seatPositions.length
        );
        const dummy = new THREE.Object3D();
        const color = new THREE.Color();
        seatPositions.forEach(([x, y, z], i) => {
          dummy.position.set(x, y, z);
          dummy.updateMatrix();
          crowdMesh.setMatrixAt(i, dummy.matrix);
          color.setHex(seatColors[i]);
          crowdMesh.setColorAt(i, color);
        });
        if (crowdMesh.instanceColor) crowdMesh.instanceColor.needsUpdate = true;
        stand.add(crowdMesh);

        return stand;
      };

      // Deux longues tribunes le long des côtés du terrain (les plus visibles à la caméra)
      const sideLength = groundD + 6;
      const standLeft = buildStand(sideLength);
      standLeft.rotation.y = Math.PI / 2;
      standLeft.position.set(-groundW / 2 - margin, 0, centerZ);
      group.add(standLeft);

      const standRight = buildStand(sideLength);
      standRight.rotation.y = -Math.PI / 2;
      standRight.position.set(groundW / 2 + margin, 0, centerZ);
      group.add(standRight);

      // Deux tribunes plus courtes aux extrémités (derrière la poupée / derrière le départ)
      const endLength = groundW + 6;
      const standFar = buildStand(endLength);
      standFar.rotation.y = Math.PI;
      standFar.position.set(0, 0, centerZ - groundD / 2 - margin);
      group.add(standFar);

      const standNear = buildStand(endLength);
      standNear.position.set(0, 0, centerZ + groundD / 2 + margin);
      group.add(standNear);

      // ----- Tours de projecteurs aux 4 coins -----
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x20242c, metalness: 0.6, roughness: 0.4 });
      const cornerOffsetX = groundW / 2 + margin + 2;
      const cornerOffsetZ = groundD / 2 + margin + 2;
      const corners = [
        [-cornerOffsetX, centerZ - cornerOffsetZ],
        [cornerOffsetX, centerZ - cornerOffsetZ],
        [-cornerOffsetX, centerZ + cornerOffsetZ],
        [cornerOffsetX, centerZ + cornerOffsetZ]
      ];
      corners.forEach(([x, z]) => {
        const poleHeight = 15;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, poleHeight, 8), poleMat);
        pole.position.set(x, poleHeight / 2, z);
        pole.castShadow = true;
        group.add(pole);

        const headPanel = new THREE.Mesh(
          new THREE.BoxGeometry(2.2, 1.4, 0.2),
          new THREE.MeshStandardMaterial({ color: 0xe8ecf1, emissive: 0xe8ecf1, emissiveIntensity: 0.9 })
        );
        headPanel.position.set(x, poleHeight + 0.5, z);
        headPanel.lookAt(0, 0, centerZ);
        group.add(headPanel);

        const spot = new THREE.SpotLight(0xfff6e0, 0.9, 90, Math.PI / 6, 0.5, 1.2);
        spot.position.set(x, poleHeight + 0.5, z);
        spot.target.position.set(0, 0, centerZ);
        group.add(spot, spot.target);
      });

      this.scene.add(group);
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
        new THREE.MeshStandardMaterial({ color: COLOR_LIGHT_GREEN, emissive: COLOR_LIGHT_GREEN, emissiveIntensity: 1.3 })
      );
      eye.position.set(0, 8.8, 0.9);
      group.add(eye);
      this.towerEye = eye;

      this.towerLight = new THREE.PointLight(COLOR_LIGHT_GREEN, 1.3, 14);
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
      const color = green ? COLOR_LIGHT_GREEN : COLOR_LIGHT_RED;
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
          const mesh = this._buildCharacter(isMe ? COLOR_ME : colorForOpponent(p.userId));
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
      this.playerEntries.forEach((entry, userId) => {
        let c = entry.isMe ? COLOR_ME : colorForOpponent(userId);
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
      });

      // ----- Caméra : suit "moi" en 1ère ou 3e personne dès que je suis dans la partie -----
      const me = this._findMeEntry();
      if (me) this._applyCamera(me, dt);

      // ----- Étiquettes de noms (projection écran, après positionnement caméra) -----
      this.playerEntries.forEach((entry) => {
        const hideOwnTagInFirstPerson = entry.isMe && this.viewMode === 'first';
        if (hideOwnTagInFirstPerson) {
          entry.tag.style.display = 'none';
          return;
        }
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

    // ===== POSITIONNEMENT CAMÉRA (1ère personne / 3e personne) =====
    _applyCamera(entry, dt) {
      // Vecteur "vers l'avant" du joueur, dérivé de son cap (même convention
      // que mesh.rotation.y = entry.heading).
      const fx = Math.sin(entry.heading);
      const fz = Math.cos(entry.heading);
      const posLerp = Math.min(1, dt * 10);
      const lookLerp = Math.min(1, dt * 10);

      if (this.viewMode === 'first') {
        entry.mesh.visible = false; // on ne voit pas son propre corps en vue subjective

        const eyeHeight = 1.55;
        const desiredPos = new THREE.Vector3(entry.x, eyeHeight, entry.z);
        this.camera.position.lerp(desiredPos, posLerp);

        const desiredLook = new THREE.Vector3(entry.x + fx, eyeHeight, entry.z + fz);
        if (!this._camLookAt) this._camLookAt = desiredLook.clone();
        this._camLookAt.lerp(desiredLook, lookLerp);
        this.camera.lookAt(this._camLookAt);
      } else {
        entry.mesh.visible = true;

        const backDist = 5.5, height = 3.1;
        const desiredPos = new THREE.Vector3(
          entry.x - fx * backDist,
          height,
          entry.z - fz * backDist
        );
        this.camera.position.lerp(desiredPos, posLerp);

        const desiredLook = new THREE.Vector3(entry.x, 1.1, entry.z);
        if (!this._camLookAt) this._camLookAt = desiredLook.clone();
        this._camLookAt.lerp(desiredLook, lookLerp);
        this.camera.lookAt(this._camLookAt);
      }
    }

    _angleDiff(a, b) {
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return d;
    }

    // Garde un champ de vision HORIZONTAL à peu près constant (~62°) quel que
    // soit l'écran, en recalculant le FOV vertical de Three.js à partir du
    // ratio. Sans ça, un écran de téléphone en portrait (étroit) donne un
    // rendu "zoomé" et inconfortable avec un FOV vertical fixe.
    _applyFovForAspect(aspect) {
      const targetHorizontalFovDeg = 62;
      const hFovRad = THREE.MathUtils.degToRad(targetHorizontalFovDeg);
      const vFovRad = 2 * Math.atan(Math.tan(hFovRad / 2) / Math.max(aspect, 0.01));
      const vFovDeg = THREE.MathUtils.radToDeg(vFovRad);
      this.camera.fov = THREE.MathUtils.clamp(vFovDeg, 40, 90);
    }

    _onResize() {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      if (!w || !h) return;
      this.camera.aspect = w / h;
      this._applyFovForAspect(w / h);
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }

    dispose() {
      cancelAnimationFrame(this._rafId);
      window.removeEventListener('resize', this._onResize);
      window.removeEventListener('keydown', this._onKeyDown);
      if (this._resizeObserver) this._resizeObserver.disconnect();
      if (this.viewToggleBtn && this.viewToggleBtn.parentNode) this.viewToggleBtn.parentNode.removeChild(this.viewToggleBtn);
      this.playerEntries.forEach((e) => { this.scene.remove(e.mesh); e.tag.remove(); });
      this.playerEntries.clear();
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      if (this.tagLayer.parentNode) this.tagLayer.parentNode.removeChild(this.tagLayer);
    }
  }

  window.Arena3D = Arena3D;
})();
