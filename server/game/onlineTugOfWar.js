const User = require('../models/User');

// ===== CONSTANTES =====
// Mêmes proportions que la version solo (tow-canvas 900px de large) pour
// rester cohérent avec le reste du projet.
const ARENA_WIDTH = 900;
const CENTER = ARENA_WIDTH / 2;
const LEFT_EDGE = 90;
const RIGHT_EDGE = ARENA_WIDTH - 90;

const TAP_IMPULSE = 46; // px/s ajoutés par tape (identique à la version solo)
const FRICTION_PER_FRAME = 0.985; // décroissance de référence, exprimée par frame ~60fps
const FRICTION_LN60 = Math.log(FRICTION_PER_FRAME) * 60; // convertie en décroissance continue
const MIN_TAP_INTERVAL_MS = 45; // anti-spam : au-delà, ce n'est plus un humain qui tape
const MAX_DURATION = 30; // secondes avant décision au temps si personne n'a gagné
const TICK_MS = 100; // fréquence de diffusion (10x/s)

const MIN_PLAYERS = 2; // minimum pour démarrer : 1 contre 1
const MAX_PLAYERS = 8; // maximum : 4 contre 4
const QUEUE_TIMEOUT_MS = 15000; // démarre avec ce qu'il y a dès que le minimum est atteint

class OnlineTugOfWarManager {
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
      this.io.to(p.socketId).emit('tow:queue:status', {
        waiting: this.queue.length,
        minPlayers: MIN_PLAYERS
      });
    });
  }

  // ===== DÉMARRAGE D'UNE PARTIE =====
  // Les équipes sont réparties en alternance selon l'ordre d'arrivée dans la
  // file, ce qui donne des équipes de taille égale (ou avec un joueur d'écart)
  // quel que soit le nombre total de participants.
  startMatch() {
    if (this.queueTimer) {
      clearTimeout(this.queueTimer);
      this.queueTimer = null;
    }
    if (this.queue.length < MIN_PLAYERS) return;

    const participants = this.queue.splice(0, MAX_PLAYERS);
    this.matchCounter += 1;
    const matchId = `tow-${Date.now()}-${this.matchCounter}`;

    const players = new Map();
    participants.forEach((p, i) => {
      const socket = this.io.sockets.sockets.get(p.socketId);
      if (socket) socket.join(matchId);
      const team = i % 2 === 0 ? 'left' : 'right';
      players.set(p.socketId, {
        socketId: p.socketId,
        userId: p.userId,
        username: p.username,
        team,
        lastTapAt: 0
      });
    });

    const match = {
      id: matchId,
      players,
      markerX: CENTER,
      velocity: 0,
      timeLeft: MAX_DURATION,
      winnerTeam: null,
      ended: false,
      interval: null
    };

    this.matches.set(matchId, match);

    this.io.to(matchId).emit('tow:match:found', {
      matchId,
      players: Array.from(players.values()).map((p) => ({
        userId: p.userId,
        username: p.username,
        team: p.team
      }))
    });

    match.interval = setInterval(() => this.tick(match), TICK_MS);

    // S'il reste assez de joueurs en file, on relance une recherche pour eux
    if (this.queue.length >= MIN_PLAYERS) {
      this.queueTimer = setTimeout(() => this.startMatch(), QUEUE_TIMEOUT_MS);
    }
  }

  // ===== BOUCLE DE SIMULATION =====
  tick(match) {
    if (match.ended) return;
    const dt = TICK_MS / 1000;

    match.timeLeft -= dt;

    // Frottement continu équivalent à ×0.985 par frame ~60fps dans la version solo
    match.velocity *= Math.exp(dt * FRICTION_LN60);
    match.markerX += match.velocity * dt;
    match.markerX = Math.max(LEFT_EDGE - 10, Math.min(RIGHT_EDGE + 10, match.markerX));

    let winnerTeam = null;
    if (match.markerX <= LEFT_EDGE) winnerTeam = 'left';
    else if (match.markerX >= RIGHT_EDGE) winnerTeam = 'right';

    const timeUp = match.timeLeft <= 0;
    if (timeUp && !winnerTeam) {
      if (match.markerX < CENTER) winnerTeam = 'left';
      else if (match.markerX > CENTER) winnerTeam = 'right';
      // égalité parfaite au centre -> pas de vainqueur (très rare)
    }

    this.io.to(match.id).emit('tow:match:tick', {
      markerX: match.markerX,
      timeLeft: Math.max(0, match.timeLeft)
    });

    if (winnerTeam || timeUp) {
      this.endMatch(match, winnerTeam);
    }
  }

  async endMatch(match, winnerTeam) {
    if (match.ended) return;
    match.ended = true;
    clearInterval(match.interval);
    match.winnerTeam = winnerTeam;

    const results = Array.from(match.players.values()).map((p) => ({
      userId: p.userId,
      username: p.username,
      team: p.team,
      won: winnerTeam ? p.team === winnerTeam : false
    }));

    this.io.to(match.id).emit('tow:match:end', { winnerTeam, results });

    for (const r of results) {
      try {
        const user = await User.findById(r.userId);
        if (!user) continue;
        user.stats.gamesPlayed += 1;
        if (r.won) user.stats.wins += 1;
        await user.save();
      } catch (err) {
        console.error('Erreur sauvegarde stats tir à la corde:', err.message);
      }
    }

    match.players.forEach((p) => {
      const socket = this.io.sockets.sockets.get(p.socketId);
      if (socket) socket.leave(match.id);
    });

    this.matches.delete(match.id);
  }

  // ===== ENTRÉE DU JOUEUR : UNE TAPE =====
  tap(socket, matchId) {
    const match = this.matches.get(matchId);
    if (!match || match.ended) return;
    const player = match.players.get(socket.id);
    if (!player) return;

    const now = Date.now();
    if (now - player.lastTapAt < MIN_TAP_INTERVAL_MS) return; // anti-spam
    player.lastTapAt = now;

    const direction = player.team === 'left' ? -1 : 1;
    match.velocity += TAP_IMPULSE * direction;
  }

  handleDisconnect(socket) {
    this.leaveQueue(socket);
    // Contrairement à "1,2,3 Soleil", il n'y a pas de notion d'élimination
    // individuelle ici : si un joueur quitte, son équipe continue de tirer
    // avec les joueurs restants.
  }
}

module.exports = OnlineTugOfWarManager;
