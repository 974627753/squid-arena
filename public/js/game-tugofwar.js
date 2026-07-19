(function () {
  const canvas = document.getElementById('tow-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const pullBtn = document.getElementById('tow-pull-btn');

  const LEFT_EDGE = 90;
  const RIGHT_EDGE = W - 90;
  const CENTER = W / 2;
  const TAP_IMPULSE = 46; // px/s ajoutés par tape
  const FRICTION = 0.985; // décroissance de la vitesse par frame
  const AI_MIN_INTERVAL = 220, AI_MAX_INTERVAL = 420; // ms entre deux "tapes" de l'IA
  const MAX_DURATION = 25; // secondes avant match nul

  let markerX, velocity, running, timeElapsed, aiNextTapAt, rafId, lastTs;

  function resetGame() {
    markerX = CENTER;
    velocity = 0;
    running = true;
    timeElapsed = 0;
    aiNextTapAt = randRange(AI_MIN_INTERVAL, AI_MAX_INTERVAL);
    lastTs = null;
  }

  function randRange(min, max) { return Math.random() * (max - min) + min; }

  function playerTap() {
    if (!running) return;
    velocity -= TAP_IMPULSE;
    pullBtn.classList.add('pressed');
    setTimeout(() => pullBtn.classList.remove('pressed'), 80);
  }

  function loop(ts) {
    if (!running) return;
    if (lastTs === null) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    timeElapsed += dt;

    aiNextTapAt -= dt * 1000;
    if (aiNextTapAt <= 0) {
      velocity += TAP_IMPULSE * randRange(0.75, 1.05); // l'IA n'est pas parfaite
      aiNextTapAt = randRange(AI_MIN_INTERVAL, AI_MAX_INTERVAL);
    }

    velocity *= FRICTION;
    markerX += velocity * dt;
    markerX = Math.max(LEFT_EDGE - 10, Math.min(RIGHT_EDGE + 10, markerX));

    draw();

    if (markerX <= LEFT_EDGE) return endGame(true);
    if (markerX >= RIGHT_EDGE) return endGame(false);
    if (timeElapsed >= MAX_DURATION) return endGame(markerX < CENTER);

    rafId = requestAnimationFrame(loop);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Corde
    ctx.strokeStyle = '#3a4150';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(40, H / 2); ctx.lineTo(W - 40, H / 2);
    ctx.stroke();

    // Zones de victoire
    ctx.fillStyle = 'rgba(41,255,163,0.08)';
    ctx.fillRect(0, 0, LEFT_EDGE, H);
    ctx.fillStyle = 'rgba(255,59,92,0.08)';
    ctx.fillRect(RIGHT_EDGE, 0, W - RIGHT_EDGE, H);

    ctx.strokeStyle = '#29ffa3';
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(LEFT_EDGE, 0); ctx.lineTo(LEFT_EDGE, H); ctx.stroke();
    ctx.strokeStyle = '#ff3b5c';
    ctx.beginPath(); ctx.moveTo(RIGHT_EDGE, 0); ctx.lineTo(RIGHT_EDGE, H); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#7c8794';
    ctx.font = '600 13px Rajdhani, sans-serif';
    ctx.fillText('TOI', 16, 24);
    ctx.textAlign = 'right';
    ctx.fillText('MACHINE', W - 16, 24);
    ctx.textAlign = 'left';

    // Marqueur
    ctx.beginPath();
    ctx.arc(markerX, H / 2, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#eef1f3';
    ctx.shadowColor = '#eef1f3';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  async function endGame(won) {
    running = false;
    cancelAnimationFrame(rafId);

    const titleEl = document.getElementById('result-title');
    const subEl = document.getElementById('result-subtitle');
    if (won) {
      titleEl.textContent = 'VICTOIRE';
      titleEl.style.color = '#29ffa3';
      subEl.textContent = 'Tu as tiré la corde de ton côté !';
    } else {
      titleEl.textContent = 'DÉFAITE';
      titleEl.style.color = '#ff3b5c';
      subEl.textContent = 'La Machine a été plus rapide.';
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

  function startGame() {
    resetGame();
    showScreen('screen-tugofwar');
    draw();
    rafId = requestAnimationFrame(loop);
  }

  pullBtn.addEventListener('mousedown', playerTap);
  pullBtn.addEventListener('touchstart', (e) => { e.preventDefault(); playerTap(); }, { passive: false });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.getElementById('screen-tugofwar').classList.contains('active') && !e.repeat) {
      e.preventDefault();
      playerTap();
    }
  });

  document.querySelectorAll('[data-start="tugofwar"]').forEach((btn) => {
    btn.addEventListener('click', startGame);
  });
})();
