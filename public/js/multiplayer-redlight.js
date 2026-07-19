(function () {
  const FINISH_Y = 60;
  const START_Y = 440;

  const canvas = document.getElementById('mp-rl-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const lightDot = document.getElementById('mp-light-dot');
  const lightLabel = document.getElementById('mp-light-label');
  const timeEl = document.getElementById('mp-rl-time');
  const moveBtn = document.getElementById('mp-rl-move-btn');
  const queueStatusEl = document.getElementById('mp-queue-status');
  const queueCountEl = document.getElementById('mp-queue-count');

  let currentMatchId = null;
  let isMoving = false;

  // ===== ENTRER DANS LA FILE D'ATTENTE =====
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

  // ===== BRANCHEMENT DES ÉVÉNEMENTS SOCKET (une seule fois le socket créé) =====
  function bindSocketEvents(socket) {
    socket.off('queue:status');
    socket.on('queue:status', ({ waiting, minPlayers }) => {
      queueStatusEl.textContent = `En attente d'au moins ${minPlayers} joueurs pour lancer la partie…`;
      queueCountEl.textContent = `${waiting} joueur${waiting > 1 ? 's' : ''} en attente`;
    });

    socket.off('match:found');
    socket.on('match:found', ({ matchId }) => {
      currentMatchId = matchId;
      isMoving = false;
      moveBtn.classList.remove('pressed');
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
      isMoving = false;
      moveBtn.classList.remove('pressed');
      showMpResult(winnerId, results);
    });
  }

  // On (re)branche les événements à chaque nouvelle connexion socket
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

  // ===== RENDU CANVAS =====
  function draw(state) {
    ctx.clearRect(0, 0, W, H);

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

    const n = state.players.length;
    const spacing = W / (n + 1);

    state.players.forEach((p, i) => {
      const x = spacing * (i + 1);
      const isMe = p.userId === AppState.user.id;

      let color = '#29ffa3';
      if (p.eliminated) color = '#3a4150';
      else if (p.finished) color = '#ffd23b';
      else if (state.light === 'red' && isMe && isMoving) color = '#ff3b5c';

      ctx.beginPath();
      ctx.arc(x, p.y, 14, 0, Math.PI * 2);
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
      ctx.fillText(p.username + (isMe ? ' (toi)' : ''), x, p.y - 22);
      ctx.textAlign = 'left';
    });
  }

  // ===== RÉSULTATS =====
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

  // ===== CONTRÔLES =====
  function setMoving(val) {
    if (!currentMatchId || !AppState.socket) return;
    isMoving = val;
    moveBtn.classList.toggle('pressed', val);
    AppState.socket.emit('redlight:move', { matchId: currentMatchId, isMoving: val });
  }

  moveBtn.addEventListener('mousedown', () => setMoving(true));
  moveBtn.addEventListener('mouseup', () => setMoving(false));
  moveBtn.addEventListener('mouseleave', () => setMoving(false));
  moveBtn.addEventListener('touchstart', (e) => { e.preventDefault(); setMoving(true); }, { passive: false });
  moveBtn.addEventListener('touchend', (e) => { e.preventDefault(); setMoving(false); }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.getElementById('screen-mp-redlight').classList.contains('active')) {
      e.preventDefault();
      setMoving(true);
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') setMoving(false);
  });
})();
