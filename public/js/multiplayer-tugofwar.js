(function () {
  const sceneContainer = document.getElementById('mp-tow-scene');
  let arena = null;

  const timeEl = document.getElementById('tow-mp-time');
  const queueStatusEl = document.getElementById('tow-queue-status');
  const queueCountEl = document.getElementById('tow-queue-count');
  const teamBadgeLeft = document.getElementById('tow-team-left');
  const teamBadgeRight = document.getElementById('tow-team-right');
  const myTeamLabel = document.getElementById('tow-my-team');
  const tapBtn = document.getElementById('tow-tap-btn');

  let currentMatchId = null;
  let myTeam = null;

  function getArena() {
    if (!arena) arena = new TugOfWar3D(sceneContainer);
    return arena;
  }

  document.getElementById('btn-online-tugofwar').addEventListener('click', () => {
    if (!AppState.socket) connectSocket();
    queueStatusEl.textContent = 'Connexion en cours…';
    queueCountEl.textContent = '0 joueur en attente';
    showScreen('screen-tow-queue');
    AppState.socket.emit('tow:queue:join');
  });

  document.getElementById('tow-queue-cancel').addEventListener('click', () => {
    if (AppState.socket) AppState.socket.emit('tow:queue:leave');
    showScreen('screen-multi-select');
  });

  function bindSocketEvents(socket) {
    socket.off('tow:queue:status');
    socket.on('tow:queue:status', ({ waiting, minPlayers }) => {
      queueStatusEl.textContent = `En attente d'au moins ${minPlayers} joueurs (1 contre 1 minimum) pour lancer la partie…`;
      queueCountEl.textContent = `${waiting} joueur${waiting > 1 ? 's' : ''} en attente`;
    });

    socket.off('tow:match:found');
    socket.on('tow:match:found', ({ matchId, players }) => {
      currentMatchId = matchId;
      const me = players.find((p) => p.userId === AppState.user.id);
      myTeam = me ? me.team : 'left';

      const leftCount = players.filter((p) => p.team === 'left').length;
      const rightCount = players.filter((p) => p.team === 'right').length;
      teamBadgeLeft.textContent = `Équipe bleue — ${leftCount} joueur${leftCount > 1 ? 's' : ''}`;
      teamBadgeRight.textContent = `Équipe orange — ${rightCount} joueur${rightCount > 1 ? 's' : ''}`;
      myTeamLabel.textContent = myTeam === 'left' ? 'Tu es dans l\'équipe BLEUE' : 'Tu es dans l\'équipe ORANGE';
      myTeamLabel.className = 'tow-my-team ' + (myTeam === 'left' ? 'is-left' : 'is-right');

      showScreen('screen-mp-tugofwar');
      requestAnimationFrame(() => {
        getArena()._onResize();
        getArena().setupPlayers(players, AppState.user.id);
      });
    });

    socket.off('tow:match:tick');
    socket.on('tow:match:tick', (state) => {
      timeEl.textContent = state.timeLeft.toFixed(1);
      getArena().update(state);
    });

    socket.off('tow:match:end');
    socket.on('tow:match:end', ({ winnerTeam, results }) => {
      currentMatchId = null;
      showTowResult(winnerTeam, results);
    });
  }

  const originalConnectSocket = window.connectSocket;
  window.connectSocket = function () {
    const socket = originalConnectSocket();
    bindSocketEvents(socket);
    return socket;
  };
  if (AppState.socket) bindSocketEvents(AppState.socket);

  function showTowResult(winnerTeam, results) {
    const titleEl = document.getElementById('tow-result-title');
    const subEl = document.getElementById('tow-result-subtitle');
    const listEl = document.getElementById('tow-result-list');

    const me = results.find((r) => r.userId === AppState.user.id);
    if (me && me.won) {
      titleEl.textContent = 'VICTOIRE';
      titleEl.style.color = '#29ffa3';
      subEl.textContent = 'Ton équipe a tiré la corde de son côté !';
    } else if (winnerTeam) {
      titleEl.textContent = 'DÉFAITE';
      titleEl.style.color = '#ff3b5c';
      subEl.textContent = 'L\'équipe adverse a été la plus forte.';
    } else {
      titleEl.textContent = 'ÉGALITÉ';
      titleEl.style.color = '#7c8794';
      subEl.textContent = 'Aucune équipe n\'a réussi à faire basculer la corde à temps.';
    }

    listEl.innerHTML = '';
    ['left', 'right'].forEach((team) => {
      const teamResults = results.filter((r) => r.team === team);
      if (!teamResults.length) return;
      const header = document.createElement('div');
      header.className = 'mp-result-row';
      header.innerHTML = `<span class="mp-name">${team === 'left' ? 'Équipe bleue' : 'Équipe orange'}</span><span class="mp-outcome">${teamResults[0].won ? 'Vainqueur' : winnerTeam ? 'Perdant' : 'Nul'}</span>`;
      listEl.appendChild(header);
      teamResults.forEach((r) => {
        const row = document.createElement('div');
        row.className = 'mp-result-row';
        row.innerHTML = `<span class="mp-name" style="padding-left:14px;">${r.username}${r.userId === AppState.user.id ? ' (toi)' : ''}</span><span class="mp-outcome"></span>`;
        listEl.appendChild(row);
      });
    });

    if (me) {
      AppState.user.stats.gamesPlayed += 1;
      if (me.won) AppState.user.stats.wins += 1;
      renderUser();
    }

    showScreen('screen-tow-result');
  }

  document.getElementById('tow-result-retry').addEventListener('click', () => {
    document.getElementById('btn-online-tugofwar').click();
  });

  // ===== TAPE (bouton + espace) =====
  function tap() {
    if (!currentMatchId || !AppState.socket) return;
    AppState.socket.emit('tow:tap', { matchId: currentMatchId });
    tapBtn.classList.add('pressed');
    setTimeout(() => tapBtn.classList.remove('pressed'), 80);
  }

  tapBtn.addEventListener('mousedown', tap);
  tapBtn.addEventListener('touchstart', (e) => { e.preventDefault(); tap(); }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.getElementById('screen-mp-tugofwar').classList.contains('active') && !e.repeat) {
      e.preventDefault();
      tap();
    }
  });
})();
