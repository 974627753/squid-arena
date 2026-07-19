const User = require('../models/User');

// ===== CONSTANTES (identiques à la version solo pour la cohérence) =====
const FINISH_Y = 60;
const START_Y = 440;
const MOVE_SPEED = 90; // pixels par seconde
const GAME_DURATION = 60; // secondes
const RED_LIGHT_GRACE_MS = 130;
const TICK_MS = 100; // fréquence de simulation/diffusion (10x/s)

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const QUEUE_TIMEOUT_MS = 15000; // démarre avec ce qu'il y a si le minimum est atteint

function randRange(min, max) { return Math.random() * (max - min) + min; }

class OnlineRedLightManager {
  constructor(io) {
    this.io = io;
    this.queue = []; // { socketId, userId, username }
    this.matches = new Map(); // matchId -> match state
    this.queueTimer = null;
    this.matchCounter = 0;
  }

  // ===== FILE D'ATTENTE =====
  joinQueue(socket) {
    if (this.queue.find((p) => p.socketId === socket.id)) return;
    this.queue.push({ socketId: socket.id, userId: socket.userId, username: socket.username });
    this.broadcastQueueStatus();

    if (this.queue.length >= MAX_PLAYERS) {
      this.startMatch();
    } else if (this.queue.length >= MIN_PLAYERS && !this.queueTimer) {
      this.queueTimer = setTimeout(() => this.startMatch(), QUEUE_TIMEOUT_MS);
    }
  }

  leaveQueue(socket) {
    this.queue = this.queue.filter((p) => p.socketId !== socket.id);
    this.broadcastQueueStatus();
    if (this.queue.length < MIN_PLAYERS && this.queueTimer) {
      clearTimeout(this.queueTimer);
      this.queueTimer = null;
    }
  }

  broadcastQueueStatus() {
    this.queue.forEach((p) => {
      this.io.to(p.socketId).emit('queue:status', {
        waiting: this.queue.length,
        minPlayers: MIN_PLAYERS
      });
    });
  }

  // ===== DÉMARRAGE D'UNE PARTIE =====
  startMatch() {
    if (this.queueTimer) {
      clearTimeout(this.queueTimer);
      this.queueTimer = null;
    }
    if (this.queue.length < MIN_PLAYERS) return;

    const participants = this.queue.splice(0, MAX_PLAYERS);
    this.matchCounter += 1;
    const matchId = `redlight-${Date.now()}-${this.matchCounter}`;

    const players = new Map();
    participants.forEach((p) => {
      const socket = this.io.sockets.sockets.get(p.socketId);
      if (socket) socket.join(matchId);
      players.set(p.socketId, {
        socketId: p.socketId,
        userId: p.userId,
        username: p.username,
        y: START_Y,
        isMoving: false,
        eliminated: false,
        finished: false,
        finishTime: null
      });
    });

    const match = {
      id: matchId,
      players,
      light: 'green',
      lightTimer: 0,
      lightDuration: randRange(1.4, 3.2),
      redLightSince: null,
      timeLeft: GAME_DURATION,
      winnerId: null,
      ended: false,
      interval: null
    };

    this.matches.set(matchId, match);

    this.io.to(matchId).emit('match:found', {
      matchId,
      players: Array.from(players.values()).map((p) => ({ userId: p.userId, username: p.username }))
    });

    match.interval = setInterval(() => this.tick(match), TICK_MS);

    // Si des joueurs restent en file (plus que MAX_PLAYERS), on relance une recherche pour eux
    if (this.queue.length >= MIN_PLAYERS) {
      this.queueTimer = setTimeout(() => this.startMatch(), QUEUE_TIMEOUT_MS);
    }
  }

  // ===== BOUCLE DE SIMULATION =====
  tick(match) {
    if (match.ended) return;
    const dt = TICK_MS / 1000;

    match.timeLeft -= dt;
    match.lightTimer += dt;
    if (match.lightTimer >= match.lightDuration) {
      match.light = match.light === 'green' ? 'red' : 'green';
      match.lightTimer = 0;
      match.lightDuration = match.light === 'green' ? randRange(1.3, 3.0) : randRange(1.0, 2.6);
      match.redLightSince = match.light === 'red' ? Date.now() : null;
    }

    let winner = null;

    match.players.forEach((player) => {
      if (player.eliminated || player.finished) return;

      if (player.isMoving) {
        player.y -= MOVE_SPEED * dt;
      }

      if (
        match.light === 'red' &&
        player.isMoving &&
        match.redLightSince !== null &&
        Date.now() - match.redLightSince > RED_LIGHT_GRACE_MS
      ) {
        player.eliminated = true;
      } else if (player.y <= FINISH_Y) {
        player.finished = true;
        player.finishTime = GAME_DURATION - match.timeLeft;
        if (!match.winnerId) {
          match.winnerId = player.userId;
          winner = player;
        }
      }
    });

    const allDone = Array.from(match.players.values()).every((p) => p.eliminated || p.finished);
    const timeUp = match.timeLeft <= 0;

    this.io.to(match.id).emit('match:tick', {
      light: match.light,
      timeLeft: Math.max(0, match.timeLeft),
      players: Array.from(match.players.values()).map((p) => ({
        userId: p.userId,
        username: p.username,
        y: p.y,
        eliminated: p.eliminated,
        finished: p.finished
      }))
    });

    if (winner || allDone || timeUp) {
      this.endMatch(match);
    }
  }

  async endMatch(match) {
    if (match.ended) return;
    match.ended = true;
    clearInterval(match.interval);

    const results = Array.from(match.players.values()).map((p) => ({
      userId: p.userId,
      username: p.username,
      won: p.userId === match.winnerId,
      finishTime: p.finishTime
    }));

    this.io.to(match.id).emit('match:end', { winnerId: match.winnerId, results });

    // Sauvegarde des stats en base pour chaque joueur
    for (const r of results) {
      try {
        const user = await User.findById(r.userId);
        if (!user) continue;
        user.stats.gamesPlayed += 1;
        if (r.won) {
          user.stats.wins += 1;
          if (
            typeof r.finishTime === 'number' &&
            (user.stats.bestTimeRedLight === null || r.finishTime < user.stats.bestTimeRedLight)
          ) {
            user.stats.bestTimeRedLight = r.finishTime;
          }
        }
        await user.save();
      } catch (err) {
        console.error('Erreur sauvegarde stats multijoueur:', err.message);
      }
    }

    // Les sockets quittent la room
    match.players.forEach((p) => {
      const socket = this.io.sockets.sockets.get(p.socketId);
      if (socket) socket.leave(match.id);
    });

    this.matches.delete(match.id);
  }

  // ===== ENTRÉES DU JOUEUR =====
  setMoving(socket, matchId, isMoving) {
    const match = this.matches.get(matchId);
    if (!match) return;
    const player = match.players.get(socket.id);
    if (!player) return;
    player.isMoving = isMoving;
  }

  handleDisconnect(socket) {
    this.leaveQueue(socket);
    // Si le joueur était dans une partie en cours, on l'élimine proprement
    this.matches.forEach((match) => {
      const player = match.players.get(socket.id);
      if (player && !player.finished) {
        player.eliminated = true;
      }
    });
  }
}

module.exports = OnlineRedLightManager;
