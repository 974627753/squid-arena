// ===== ÉTAT GLOBAL =====
const AppState = {
  token: localStorage.getItem('arena_token') || null,
  user: null,
  socket: null
};

function connectSocket() {
  if (AppState.socket) AppState.socket.disconnect();
  AppState.socket = io({ auth: { token: AppState.token } });
  return AppState.socket;
}

function disconnectSocket() {
  if (AppState.socket) {
    AppState.socket.disconnect();
    AppState.socket = null;
  }
}

function apiFetch(path, options = {}) {
  const headers = options.headers || {};
  headers['Content-Type'] = 'application/json';
  if (AppState.token) headers['Authorization'] = `Bearer ${AppState.token}`;
  return fetch(`/api${path}`, { ...options, headers }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erreur inconnue');
    return data;
  });
}

// ===== NAVIGATION ENTRE ÉCRANS =====
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => showScreen(btn.dataset.back));
});

document.querySelectorAll('.menu-tile[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => showScreen(`screen-${btn.dataset.view}`));
});

// ===== TABS CONNEXION / INSCRIPTION =====
document.querySelectorAll('.tab-btn').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach((f) => f.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`form-${tab.dataset.tab}`).classList.add('active');
  });
});

// ===== INSCRIPTION =====
document.getElementById('form-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('register-error');
  errorEl.textContent = '';
  const username = document.getElementById('register-username').value;
  const password = document.getElementById('register-password').value;
  try {
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    onAuthSuccess(data);
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// ===== CONNEXION =====
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    onAuthSuccess(data);
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

function onAuthSuccess(data) {
  AppState.token = data.token;
  AppState.user = data.user;
  localStorage.setItem('arena_token', data.token);
  renderUser();
  connectSocket();
  showScreen('screen-menu');
}

function renderUser() {
  document.getElementById('user-display-name').textContent = AppState.user.username;
  document.getElementById('stat-games').textContent = AppState.user.stats.gamesPlayed;
  document.getElementById('stat-wins').textContent = AppState.user.stats.wins;
  document.getElementById('stat-besttime').textContent =
    AppState.user.stats.bestTimeRedLight != null
      ? `${AppState.user.stats.bestTimeRedLight.toFixed(1)}s`
      : '—';
}

// ===== DÉCONNEXION =====
document.getElementById('btn-logout').addEventListener('click', () => {
  disconnectSocket();
  AppState.token = null;
  AppState.user = null;
  localStorage.removeItem('arena_token');
  showScreen('screen-auth');
});

// ===== AU CHARGEMENT : essayer de restaurer la session =====
(async function init() {
  if (!AppState.token) {
    showScreen('screen-auth');
    return;
  }
  try {
    const data = await apiFetch('/auth/me');
    AppState.user = data.user;
    renderUser();
    connectSocket();
    showScreen('screen-menu');
  } catch (err) {
    localStorage.removeItem('arena_token');
    AppState.token = null;
    showScreen('screen-auth');
  }
})();
