(function () {
  let currentCode = null;
  let isHost = false;

  document.getElementById('btn-friend-room').addEventListener('click', () => {
    showScreen('screen-friend-home');
  });

  document.getElementById('btn-create-room-redlight').addEventListener('click', () => {
    if (!AppState.socket) connectSocket();
    bindEvents(AppState.socket);
    AppState.socket.emit('friend:room:create', { gameType: 'redlight' });
  });

  document.getElementById('btn-create-room-tugofwar').addEventListener('click', () => {
    if (!AppState.socket) connectSocket();
    bindEvents(AppState.socket);
    AppState.socket.emit('friend:room:create', { gameType: 'tugofwar' });
  });

  document.getElementById('btn-join-room').addEventListener('click', () => {
    const code = document.getElementById('join-room-code').value.trim().toUpperCase();
    document.getElementById('join-room-error').textContent = '';
    if (!code) return;
    if (!AppState.socket) connectSocket();
    bindEvents(AppState.socket);
    AppState.socket.emit('friend:room:join', { code });
  });

  document.getElementById('btn-leave-room').addEventListener('click', () => {
    if (AppState.socket) AppState.socket.emit('friend:room:leave');
    currentCode = null;
    showScreen('screen-menu');
  });

  document.getElementById('btn-start-room').addEventListener('click', () => {
    if (AppState.socket && currentCode) {
      AppState.socket.emit('friend:room:start', { code: currentCode });
    }
  });

  function gameTypeLabel(gameType) {
    return gameType === 'tugofwar' ? 'Tir à la corde' : '1, 2, 3 Soleil';
  }

  function bindEvents(socket) {
    socket.off('friend:room:created');
    socket.on('friend:room:created', ({ code, gameType }) => {
      currentCode = code;
      document.getElementById('lobby-code').textContent = code;
      document.getElementById('lobby-gametype').textContent = gameTypeLabel(gameType);
      showScreen('screen-friend-lobby');
    });

    socket.off('friend:room:error');
    socket.on('friend:room:error', ({ error }) => {
      const errEl = document.getElementById('join-room-error');
      if (errEl) errEl.textContent = error;
    });

    socket.off('friend:room:update');
    socket.on('friend:room:update', ({ code, gameType, hostSocketId, players }) => {
      currentCode = code;
      isHost = socket.id === hostSocketId;
      document.getElementById('lobby-code').textContent = code;
      document.getElementById('lobby-gametype').textContent = gameTypeLabel(gameType);

      const listEl = document.getElementById('lobby-players');
      listEl.innerHTML = '';
      players.forEach((p) => {
        const row = document.createElement('div');
        row.className = 'mp-result-row';
        row.innerHTML = `<span class="mp-name">${p.username}</span><span class="mp-outcome">${p.userId === AppState.user.id ? 'toi' : ''}</span>`;
        listEl.appendChild(row);
      });

      const startBtn = document.getElementById('btn-start-room');
      const waitMsg = document.getElementById('lobby-wait-msg');
      if (isHost) {
        startBtn.style.display = 'block';
        startBtn.disabled = players.length < 2;
        startBtn.textContent = players.length < 2 ? 'En attente d\'un 2e joueur…' : 'Lancer la partie';
        waitMsg.style.display = 'none';
      } else {
        startBtn.style.display = 'none';
        waitMsg.style.display = 'block';
      }

      showScreen('screen-friend-lobby');
    });
  }

  if (AppState.socket) bindEvents(AppState.socket);

  // Re-bind à chaque nouvelle connexion socket (login)
  const prevConnect = window.connectSocket;
  window.connectSocket = function () {
    const s = prevConnect();
    bindEvents(s);
    return s;
  };
})();
