(function () {
  const listEl = document.getElementById('friends-list');
  const errorEl = document.getElementById('add-friend-error');
  const inputEl = document.getElementById('add-friend-username');

  document.getElementById('btn-open-friends').addEventListener('click', async () => {
    showScreen('screen-friends');
    await loadFriends();
  });

  document.getElementById('btn-add-friend').addEventListener('click', async () => {
    errorEl.textContent = '';
    const username = inputEl.value.trim();
    if (!username) return;
    try {
      await apiFetch('/friends/add', { method: 'POST', body: JSON.stringify({ username }) });
      inputEl.value = '';
      await loadFriends();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  async function loadFriends() {
    listEl.innerHTML = '<p class="rl-hint">Chargement…</p>';
    try {
      const data = await apiFetch('/friends');
      renderFriends(data.friends);
    } catch (err) {
      listEl.innerHTML = `<p class="form-error">${err.message}</p>`;
    }
  }

  function renderFriends(friends) {
    if (!friends.length) {
      listEl.innerHTML = '<p class="rl-hint">Tu n\'as pas encore ajouté d\'amis. Ajoute un pseudo ci-dessus.</p>';
      return;
    }
    listEl.innerHTML = '';
    friends.forEach((f) => {
      const card = document.createElement('div');
      card.className = 'menu-tile friend-card';
      const bestTime = f.stats.bestTimeRedLight != null ? `${f.stats.bestTimeRedLight.toFixed(1)}s` : '—';
      card.innerHTML = `
        <h2>${f.username}</h2>
        <div class="friend-stats">
          <span>Parties : <b>${f.stats.gamesPlayed}</b></span>
          <span>Victoires : <b>${f.stats.wins}</b></span>
          <span>Meilleur temps : <b>${bestTime}</b></span>
        </div>
        <button class="btn-remove-friend" data-id="${f.id}">Retirer</button>
      `;
      card.querySelector('.btn-remove-friend').addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await apiFetch(`/friends/${f.id}`, { method: 'DELETE' });
          await loadFriends();
        } catch (err) {
          alert(err.message);
        }
      });
      listEl.appendChild(card);
    });
  }
})();
