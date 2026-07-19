(function () {
  const canvas = document.getElementById('marble-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const stopBtn = document.getElementById('marble-stop-btn');
  const roundEl = document.getElementById('marble-round');

  const MARGIN = 40;
  const TRACK_Y = H / 2;
  const PENDULUM_SPEED = 480; // px/s
  const ZONE_HALF_WIDTH = 26;
  const AI_ERROR_RANGE = 55; // plus petit = IA plus précise
  const TOTAL_ROUNDS = 3;

  let round, playerWins, aiWins;
  let pointerX, direction, waitingForInput, running, rafId, lastTs;
  let zoneCenter;
  let resultText = '';

  function newRound() {
    zoneCenter = randRange(MARGIN + ZONE_HALF_WIDTH + 20, W - MARGIN - ZONE_HALF_WIDTH - 20);
    pointerX = MARGIN;
    direction = 1;
    waitingForInput = true;
    resultText = '';
    roundEl.textContent = round;
  }

  function randRange(min, max) { return Math.random() * (max - min) + min; }

  function startGame() {
    round = 1;
    playerWins = 0;
    aiWins = 0;
    running = true;
    lastTs = null;
    newRound();
    showScreen('screen-marble');
    draw();
    rafId = requestAnimationFrame(loop);
  }

  function loop(ts) {
    if (!running) return;
    if (lastTs === null) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;

    if (waitingForInput) {
      pointerX += direction * PENDULUM_SPEED * dt;
      if (pointerX >= W - MARGIN) { pointerX = W - MARGIN; direction = -1; }
      if (pointerX <= MARGIN) { pointerX = MARGIN; direction = 1; }
    }

    draw();
    rafId = requestAnimationFrame(loop);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    ctx.strokeStyle = '#262c37';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(MARGIN, TRACK_Y); ctx.lineTo(W - MARGIN, TRACK_Y);
    ctx.stroke();

    // Zone cible
    ctx.fillStyle = 'rgba(41,255,163,0.18)';
    ctx.fillRect(zoneCenter - ZONE_HALF_WIDTH, TRACK_Y - 16, ZONE_HALF_WIDTH * 2, 32);
    ctx.strokeStyle = '#29ffa3';
    ctx.strokeRect(zoneCenter - ZONE_HALF_WIDTH, TRACK_Y - 16, ZONE_HALF_WIDTH * 2, 32);

    // Pointeur
    ctx.beginPath();
    ctx.arc(pointerX, TRACK_Y, 12, 0, Math.PI * 2);
    ctx.fillStyle = waitingForInput ? '#eef1f3' : '#ffd23b';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#7c8794';
    ctx.font = '600 14px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Toi ${playerWins} — ${aiWins} Machine`, W / 2, 34);
    if (resultText) {
      ctx.fillStyle = '#eef1f3';
      ctx.font = '700 16px Rajdhani, sans-serif';
      ctx.fillText(resultText, W / 2, H - 20);
    }
    ctx.textAlign = 'left';
  }

  function playerShoot() {
    if (!waitingForInput || !running) return;
    waitingForInput = false;

    const playerDist = Math.abs(pointerX - zoneCenter);
    const aiX = zoneCenter + (Math.random() - 0.5) * 2 * AI_ERROR_RANGE;
    const aiDist = Math.abs(aiX - zoneCenter);

    const playerScores = playerDist < aiDist;
    if (playerScores) playerWins++; else aiWins++;

    resultText = playerScores
      ? `Point pour toi ! (${playerDist.toFixed(0)}px vs ${aiDist.toFixed(0)}px)`
      : `Point pour la Machine (${playerDist.toFixed(0)}px vs ${aiDist.toFixed(0)}px)`;
    draw();

    setTimeout(() => {
      if (round >= TOTAL_ROUNDS) {
        endGame(playerWins > aiWins);
      } else {
        round++;
        newRound();
      }
    }, 1600);
  }

  async function endGame(won) {
    running = false;
    cancelAnimationFrame(rafId);

    const titleEl = document.getElementById('result-title');
    const subEl = document.getElementById('result-subtitle');
    if (won) {
      titleEl.textContent = 'VICTOIRE';
      titleEl.style.color = '#29ffa3';
      subEl.textContent = `Tu remportes le duel ${playerWins} à ${aiWins}.`;
    } else {
      titleEl.textContent = 'DÉFAITE';
      titleEl.style.color = '#ff3b5c';
      subEl.textContent = `La Machine remporte le duel ${aiWins} à ${playerWins}.`;
    }

    window.currentRetryHandler = startGame;
    showScreen('screen-result');

    try {
      const data = await apiFetch('/game/result', { method: 'POST', body: JSON.stringify({ won }) });
      if (AppState.user) { AppState.user.stats = data.stats; renderUser(); }
    } catch (err) {
      console.warn('Impossible d\'enregistrer le résultat:', err.message);
    }
  }

  stopBtn.addEventListener('mousedown', playerShoot);
  stopBtn.addEventListener('touchstart', (e) => { e.preventDefault(); playerShoot(); }, { passive: false });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.getElementById('screen-marble').classList.contains('active') && !e.repeat) {
      e.preventDefault();
      playerShoot();
    }
  });

  document.querySelectorAll('[data-start="marble"]').forEach((btn) => {
    btn.addEventListener('click', startGame);
  });
})();
