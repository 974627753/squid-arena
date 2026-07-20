(function () {
  const FINISH_Y = 60;
  const START_Y = 440;
  const ARENA_W = 900;
  const START_RECT = { x: ARENA_W / 2 - 100, y: START_Y, width: 200, height: 50 };
  const JOYSTICK_MAX_RADIUS = 45;

  const canvas = document.getElementById('mp-rl-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const lightDot = document.getElementById('mp-light-dot');
  const lightLabel = document.getElementById('mp-light-label');
  const timeEl = document.getElementById('mp-rl-time');
  const queueStatusEl = document.getElementById('mp-queue-status');
  const queueCountEl = document.getElementById('mp-queue-count');

  const joystickBase = document.getElementById('mp-joystick-base');
  const joystickStick = document.getElementById('mp-joystick-stick');

  let currentMatchId = null;
  let currentDir = { dx: 0, dy: 0 };

  document.getElementById('btn-online-redlight').addEventListener('click', () => {
    if (!AppState.socket) connectSocket();
    queueStatusEl.textContent = 'Connexion en cours…';
    queueCountEl.textContent = '0 joueur en attente';
    showScreen('screen-mp-queue');
    AppState.socket.emit('redlight:queue:join');
  });

  document.getElementById('mp-queue-cancel').addEventListener('click', () => {
    if (AppState.socket) AppState.socket.emit('redlight:queue:leave');
    showScreen('screen-multi-select');
  });

  function bindSocketEvents(socket) {
    socket.off('queue:status');
    socket.on('queue:status', ({ waiting, minPlayers }) => {
      queueStatusEl.textContent = `En attente d'au moins ${minPlayers} joueurs pour lancer la partie…`;
      queueCountEl.textContent = `${waiting} joueur${waiting > 1 ? 's' : ''} en attente`;
    });

    socket.off('match:found');
    socket.on('match:found', ({ matchId }) => {
      currentMatchId = matchId;
      resetJoystick();
      showScreen('screen-mp-redlight');
    });

    socket.off('match:tick');
    socket.on('match:tick', (state) => {
      timeEl.textContent = state.timeLeft.toFixed(1);
      updateLightUI(state.light);
      draw(state);
    });

    socket.off('match:end');
    socket.on('match:end', ({ winnerId, results }) => {
      currentMatchId = null;
      resetJoystick();
      showMpResult(winnerId, results);
    });
  }

  const originalConnectSocket = window.connectSocket;
  window.connectSocket = function () {
    const socket = originalConnectSocket();
    bindSocketEvents(socket);
    return socket;
  };
  if (AppState.socket) bindSocketEvents(AppState.socket);

  function updateLightUI(light) {
    if (light === 'green') {
      lightDot.classList.remove('red');
      lightLabel.textContent = 'FEU VERT';
    } else {
      lightDot.classList.add('red');
      lightLabel.textContent = 'FEU ROUGE';
    }
  }

  function draw(state) {
    ctx.clearRect(0, 0, W, H);

    ctx.strokeStyle = '#262c37';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, FINISH_Y); ctx.lineTo(W, FINISH_Y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#7c8794';
    ctx.font = '600 13px Rajdhani, sans-serif';
    ctx.fillText('ARRIVÉE', 12, FINISH_Y - 10);

    ctx.strokeStyle = '#29ffa3';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(START_RECT.x, START_RECT.y, START_RECT.width, START_RECT.height);
    ctx.setLineDash([]);
    ctx.fillText('DÉPART', START_RECT.x, START_RECT.y + START_RECT.height + 18);

    const isCurrentlyMoving = currentDir.dx !== 0 || currentDir.dy !== 0;

    state.players.forEach((p) => {
      const isMe = p.userId === AppState.user.id;

      let color = '#29ffa3';
      if (p.eliminated) color = '#3a4150';
      else if (p.finished) color = '#ffd23b';
      else if (state.light === 'red' && isMe && isCurrentlyMoving) color = '#ff3b5c';

      ctx.beginPath();
      ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
      ctx.fillStyle = color;
      if (!p.eliminated) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
      }
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = isMe ? '#eef1f3' : '#7c8794';
      ctx.font = `${isMe ? '700' : '500'} 11px Rajdhani, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(p.username + (isMe ? ' (toi)' : ''), p.x, p.y - 22);
      ctx.textAlign = 'left';
    });
  }

  function showMpResult(winnerId, results) {
    const titleEl = document.getElementById('mp-result-title');
    const subEl = document.getElementById('mp-result-subtitle');
    const listEl = document.getElementById('mp-result-list');

    const me = results.find((r) => r.userId === AppState.user.id);
    if (me && me.won) {
      titleEl.textContent = 'VICTOIRE';
      titleEl.style.color = '#29ffa3';
      subEl.textContent = 'Tu as été le premier à atteindre l\'arrivée !';
    } else if (winnerId) {
      titleEl.textContent = 'PARTIE TERMINÉE';
      titleEl.style.color = '#ff3b5c';
      subEl.textContent = 'Un autre joueur a atteint l\'arrivée en premier.';
    } else {
      titleEl.textContent = 'ÉGALITÉ';
      titleEl.style.color = '#7c8794';
      subEl.textContent = 'Personne n\'a atteint l\'arrivée à temps.';
    }

    listEl.innerHTML = '';
    results
      .slice()
      .sort((a, b) => (a.won === b.won ? 0 : a.won ? -1 : 1))
      .forEach((r) => {
        const row = document.createElement('div');
        row.className = 'mp-result-row' + (r.won ? ' is-winner' : '');
        row.innerHTML = `
          <span class="mp-name">${r.username}${r.userId === AppState.user.id ? ' (toi)' : ''}</span>
          <span class="mp-outcome">${r.won ? `Vainqueur — ${r.finishTime.toFixed(1)}s` : 'Non arrivé'}</span>
        `;
        listEl.appendChild(row);
      });

    if (me) {
      AppState.user.stats.gamesPlayed += 1;
      if (me.won) {
        AppState.user.stats.wins += 1;
        if (
          AppState.user.stats.bestTimeRedLight === null ||
          me.finishTime < AppState.user.stats.bestTimeRedLight
        ) {
          AppState.user.stats.bestTimeRedLight = me.finishTime;
        }
      }
      renderUser();
    }

    showScreen('screen-mp-result');
  }

  document.getElementById('mp-result-retry').addEventListener('click', () => {
    document.getElementById('btn-online-redlight').click();
  });

  function sendDirection(dx, dy) {
    const mag = Math.hypot(dx, dy);
    if (mag > 1) { dx /= mag; dy /= mag; }
    if (dx === currentDir.dx && dy === currentDir.dy) return;
    currentDir = { dx, dy };
    if (!currentMatchId || !AppState.socket) return;
    AppState.socket.emit('redlight:move', { matchId: currentMatchId, dx, dy });
  }

  function updateStickVisual(dx, dy) {
    joystickStick.style.transform = `translate(${dx * JOYSTICK_MAX_RADIUS}px, ${dy * JOYSTICK_MAX_RADIUS}px)`;
  }

  function resetJoystick() {
    currentDir = { dx: 0, dy: 0 };
    updateStickVisual(0, 0);
  }

  let activePointerId = null;

  function handlePointerMove(clientX, clientY) {
    const rect = joystickBase.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = (clientX - cx) / JOYSTICK_MAX_RADIUS;
    let dy = (clientY - cy) / JOYSTICK_MAX_RADIUS;
    const mag = Math.hypot(dx, dy);
    if (mag > 1) { dx /= mag; dy /= mag; }
    updateStickVisual(dx, dy);
    sendDirection(dx, dy);
  }

  joystickBase.addEventListener('pointerdown', (e) => {
    activePointerId = e.pointerId;
    joystickBase.setPointerCapture(e.pointerId);
    handlePointerMove(e.clientX, e.clientY);
  });
  joystickBase.addEventListener('pointermove', (e) => {
    if (activePointerId !== e.pointerId) return;
    handlePointerMove(e.clientX, e.clientY);
  });
  function releasePointer(e) {
    if (activePointerId !== e.pointerId) return;
    activePointerId = null;
    updateStickVisual(0, 0);
    sendDirection(0, 0);
  }
  joystickBase.addEventListener('pointerup', releasePointer);
  joystickBase.addEventListener('pointercancel', releasePointer);
  joystickBase.addEventListener('pointerleave', (e) => {
    if (activePointerId === e.pointerId) releasePointer(e);
  });

  const keysDown = new Set();
  const MOVE_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];

  function vectorFromKeys() {
    let dx = 0, dy = 0;
    if (keysDown.has('ArrowUp') || keysDown.has('KeyW')) dy -= 1;
    if (keysDown.has('ArrowDown') || keysDown.has('KeyS')) dy += 1;
    if (keysDown.has('ArrowLeft') || keysDown.has('KeyA')) dx -= 1;
    if (keysDown.has('ArrowRight') || keysDown.has('KeyD')) dx += 1;
    return { dx, dy };
  }

  document.addEventListener('keydown', (e) => {
    if (!MOVE_KEYS.includes(e.code)) return;
    if (!document.getElementById('screen-mp-redlight').classList.contains('active')) return;
    if (activePointerId !== null) return;
    e.preventDefault();
    keysDown.add(e.code);
    const { dx, dy } = vectorFromKeys();
    sendDirection(dx, dy);
  });
  document.addEventListener('keyup', (e) => {
    if (!keysDown.has(e.code)) return;
    keysDown.delete(e.code);
    if (activePointerId !== null) return;
    const { dx, dy } = vectorFromKeys();
    sendDirection(dx, dy);
  });
})();
