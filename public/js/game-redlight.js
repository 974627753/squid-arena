(function () {
  const canvas = document.getElementById('rl-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const FINISH_Y = 60;
  const START_Y = H - 60;
  const TRACK_X = W / 2;
  const PLAYER_RADIUS = 16;
  const MOVE_SPEED = 90; // pixels par seconde
  const GAME_DURATION = 60; // secondes
  const RED_LIGHT_GRACE_MS = 130; // tolérance avant élimination après passage au rouge

  let playerY, light, lightTimer, lightDuration, isMoving, timeLeft, running;
  let redLightSince = null;
  let rafId = null;
  let lastTs = null;

  const lightDot = document.getElementById('light-dot');
  const lightLabel = document.getElementById('light-label');
  const timeEl = document.getElementById('rl-time');
  const moveBtn = document.getElementById('rl-move-btn');

  function resetGame() {
    playerY = START_Y;
    light = 'green';
    lightDuration = randRange(1.4, 3.2);
    lightTimer = 0;
    isMoving = false;
    timeLeft = GAME_DURATION;
    redLightSince = null;
    running = true;
    lastTs = null;
    updateLightUI();
    timeEl.textContent = timeLeft.toFixed(1);
  }

  function randRange(min, max) { return Math.random() * (max - min) + min; }

  function updateLightUI() {
    if (light === 'green') {
      lightDot.classList.remove('red');
      lightLabel.textContent = 'FEU VERT';
    } else {
      lightDot.classList.add('red');
      lightLabel.textContent = 'FEU ROUGE';
    }
  }

  function switchLight() {
    light = light === 'green' ? 'red' : 'green';
    lightTimer = 0;
    lightDuration = light === 'green' ? randRange(1.3, 3.0) : randRange(1.0, 2.6);
    redLightSince = light === 'red' ? performance.now() : null;
    updateLightUI();
  }

  function loop(ts) {
    if (!running) return;
    if (lastTs === null) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;

    // Timer global
    timeLeft -= dt;
    timeEl.textContent = Math.max(0, timeLeft).toFixed(1);
    if (timeLeft <= 0) {
      endGame(false, 'Temps écoulé');
      return;
    }

    // Cycle du feu
    lightTimer += dt;
    if (lightTimer >= lightDuration) switchLight();

    // Déplacement
    if (isMoving) {
      playerY -= MOVE_SPEED * dt;
    }

    // Détection élimination (mouvement pendant feu rouge, après une courte tolérance)
    if (light === 'red' && isMoving && redLightSince !== null) {
      if (performance.now() - redLightSince > RED_LIGHT_GRACE_MS) {
        endGame(false, 'Éliminé — tu as bougé au feu rouge');
        return;
      }
    }

    // Victoire
    if (playerY <= FINISH_Y) {
      const elapsed = GAME_DURATION - timeLeft;
      endGame(true, null, elapsed);
      return;
    }

    draw();
    rafId = requestAnimationFrame(loop);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Ligne de départ / arrivée
    ctx.strokeStyle = '#262c37';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, FINISH_Y); ctx.lineTo(W, FINISH_Y);
    ctx.moveTo(0, START_Y + 20); ctx.lineTo(W, START_Y + 20);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#7c8794';
    ctx.font = '600 13px Rajdhani, sans-serif';
    ctx.fillText('ARRIVÉE', 12, FINISH_Y - 10);
    ctx.fillText('DÉPART', 12, START_Y + 38);

    // Joueur
    ctx.beginPath();
    ctx.arc(TRACK_X, playerY, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = light === 'red' && isMoving ? '#ff3b5c' : '#29ffa3';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Progression
    const progress = Math.min(1, (START_Y - playerY) / (START_Y - FINISH_Y));
    ctx.fillStyle = '#181d26';
    ctx.fillRect(W - 34, FINISH_Y, 14, START_Y - FINISH_Y);
    ctx.fillStyle = '#29ffa3';
    ctx.fillRect(W - 34, FINISH_Y + (1 - progress) * (START_Y - FINISH_Y), 14, progress * (START_Y - FINISH_Y));
  }

  async function endGame(won, reasonText, elapsedSeconds) {
    running = false;
    cancelAnimationFrame(rafId);
    isMoving = false;
    moveBtn.classList.remove('pressed');

    const titleEl = document.getElementById('result-title');
    const subEl = document.getElementById('result-subtitle');

    if (won) {
      titleEl.textContent = 'SURVIVANT';
      titleEl.style.color = '#29ffa3';
      subEl.textContent = `Tu as terminé en ${elapsedSeconds.toFixed(1)} secondes.`;
    } else {
      titleEl.textContent = 'ÉLIMINÉ';
      titleEl.style.color = '#ff3b5c';
      subEl.textContent = reasonText || '';
    }

    window.currentRetryHandler = startGame;
  showScreen('screen-result');

    try {
      const data = await apiFetch('/game/redlight/result', {
        method: 'POST',
        body: JSON.stringify({
          won,
          timeSeconds: won ? elapsedSeconds : null
        })
      });
      if (AppState.user) {
        AppState.user.stats = data.stats;
        renderUser();
      }
    } catch (err) {
      console.warn('Impossible d\'enregistrer le résultat:', err.message);
    }
  }

  function startGame() {
    resetGame();
    showScreen('screen-redlight');
    draw();
    rafId = requestAnimationFrame(loop);
  }

  // ===== CONTRÔLES =====
  function setMoving(val) {
    isMoving = val;
    moveBtn.classList.toggle('pressed', val);
  }

  moveBtn.addEventListener('mousedown', () => setMoving(true));
  moveBtn.addEventListener('mouseup', () => setMoving(false));
  moveBtn.addEventListener('mouseleave', () => setMoving(false));
  moveBtn.addEventListener('touchstart', (e) => { e.preventDefault(); setMoving(true); }, { passive: false });
  moveBtn.addEventListener('touchend', (e) => { e.preventDefault(); setMoving(false); }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.getElementById('screen-redlight').classList.contains('active')) {
      e.preventDefault();
      setMoving(true);
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') setMoving(false);
  });

  // ===== LANCEMENT DEPUIS LE MENU =====
  document.querySelectorAll('[data-start="redlight"]').forEach((btn) => {
    btn.addEventListener('click', startGame);
  });
})();
