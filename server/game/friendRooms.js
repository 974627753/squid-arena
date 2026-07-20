const User = require('../models/User');

// ===== CONSTANTES (identiques aux autres modes pour la cohérence) =====
const FINISH_Y = 60;
const START_Y = 440;
const ARENA_WIDTH = 900;
const ARENA_MARGIN = 30;
const BOUND_MAX_Y = START_Y + 50;
const MOVE_SPEED = 90;
const GAME_DURATION = 60;
const RED_LIGHT_GRACE_MS = 130;
const TICK_MS = 100;
const MAX_PLAYERS = 6;

// Petit rectangle de départ (tous les joueurs y apparaissent, au centre de l'arène)
const START_RECT = { x: ARENA_WIDTH / 2 - 100, y: START_Y, width: 200, height: 50 };
const START_COLS = 3;

function randRange(min, max) { return Math.random() * (max - min) + min; }

function startPositionForIndex(i) {
  const col = i % START_COLS;
  const row = Math.floor(i / START_COLS);
  const cellW = START_RECT.width / START_COLS;
  const cellH = START_RECT.height / 2;
  const jitterX = (Math.random() - 0.5) * (cellW * 0.5);
  const jitterY = (Math.random() - 0.5) * (cellH * 0.5);
  return {
    x: START_RECT.x + cellW * col + cellW / 2 + jitterX,
    y: START_RECT.y + cellH * row + cellH / 2 + jitterY
  };
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans caractères ambigus (0/O, 1/I...)
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

class FriendRoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // code -> room state
  }

  createRoom(socket) {
    let code;
    do { code = generateRoomCode(); } while (this.rooms.has(code));

    const room = {
      code,
      hostSocketId: socket.id,
      status: 'waiting', // waiting | playing | ended
      players: new Map(), // socketId -> { socketId, userId, username, x, y, dx, dy, eliminated, finished, finishTime }
      light: 'green',
      lightTimer: 0,
      lightDuration: randRange(1.4, 3.2),
      redLightSince: null,
      timeLeft: GAME_DURATION,
      winnerId: null,
      interval: null
    };

    room.players.set(socket.id, this._newPlayer(socket));
    socket.join(`room-${code}`);
    socket.currentRoomCode = code;
    this.rooms.set(code, room);

    socket.emit('friend:room:created', { code });
    this._broadcastRoom(room);
    return room;
  }

  joinRoom(socket, code) {
    const room = this.rooms.get(code);
    if (!room) return socket.emit('friend:room:error', { error: 'Code de salon introuvable.' });
    if (room.status !== 'waiting') return socket.emit('friend:room:error', { error: 'La partie a déjà commencé.' });
    if (room.players.size >= MAX_PLAYERS) return socket.emit('friend:room:error', { error: 'Salon complet (6 joueurs max).' });
    if (room.players.has(socket.id)) return;

    room.players.set(socket.id, this._newPlayer(socket));
    socket.join(`room-${code}`);
    socket.currentRoomCode = code;

    this._broadcastRoom(room);
  }

  leaveRoom(socket) {
    const code = socket.currentRoomCode;
    if (!code) return;
    const room = this.rooms.get(code);
    if (!room) return;

    room.players.delete(socket.id);
    socket.leave(`room-${code}`);
    delete socket.currentRoomCode;

    if (room.players.size === 0) {
      if (room.interval) clearInterval(room.interval);
      this.rooms.delete(code);
      return;
    }

    if (room.hostSocketId === socket.id) {
      room.hostSocketId = room.players.keys().next().value; // nouvel hôte = joueur suivant
    }

    this._broadcastRoom(room);
  }

  startRoom(socket, code) {
    const room = this.rooms.get(code);
    if (!room) return socket.emit('friend:room:error', { error: 'Salon introuvable.' });
    if (room.hostSocketId !== socket.id) return socket.emit('friend:room:error', { error: 'Seul l\'hôte peut lancer la partie.' });
    if (room.players.size < 2) return socket.emit('friend:room:error', { error: 'Il faut au moins 2 joueurs.' });
    if (room.status !== 'waiting') return;

    room.status = 'playing';
    Array.from(room.players.values()).forEach((player, i) => {
      const pos = startPositionForIndex(i);
      player.x = pos.x;
      player.y = pos.y;
    });
    this.io.to(`room-${code}`).emit('match:found', {
      matchId: `friend-${code}`,
      players: Array.from(room.players.values()).map((p) => ({ userId: p.userId, username: p.username }))
    });

    room.interval = setInterval(() => this._tick(room), TICK_MS);
  }

  setDirection(socket, code, dx, dy) {
    const room = this.rooms.get(code);
    if (!room || room.status !== 'playing') return;
    const player = room.players.get(socket.id);
    if (!player) return;

    dx = typeof dx === 'number' && isFinite(dx) ? dx : 0;
    dy = typeof dy === 'number' && isFinite(dy) ? dy : 0;
    const mag = Math.hypot(dx, dy);
    if (mag > 1) { dx /= mag; dy /= mag; }

    player.dx = dx;
    player.dy = dy;
  }

  handleDisconnect(socket) {
    this.leaveRoom(socket);
  }

  // ===== INTERNE =====
  _newPlayer(socket) {
    return {
      socketId: socket.id,
      userId: socket.userId,
      username: socket.username,
      x: START_RECT.x + START_RECT.width / 2,
      y: START_Y,
      dx: 0,
      dy: 0,
      eliminated: false,
      finished: false,
      finishTime: null
    };
  }

  _broadcastRoom(room) {
    this.io.to(`room-${room.code}`).emit('friend:room:update', {
      code: room.code,
      hostSocketId: room.hostSocketId,
      players: Array.from(room.players.values()).map((p) => ({ userId: p.userId, username: p.username }))
    });
  }

  _tick(room) {
    if (room.status !== 'playing') return;
    const dt = TICK_MS / 1000;

    room.timeLeft -= dt;
    room.lightTimer += dt;
    if (room.lightTimer >= room.lightDuration) {
      room.light = room.light === 'green' ? 'red' : 'green';
      room.lightTimer = 0;
      room.lightDuration = room.light === 'green' ? randRange(1.3, 3.0) : randRange(1.0, 2.6);
      room.redLightSince = room.light === 'red' ? Date.now() : null;
    }

    let winner = null;
    room.players.forEach((player) => {
      if (player.eliminated || player.finished) return;

      const isMoving = Math.abs(player.dx) > 0.01 || Math.abs(player.dy) > 0.01;

      if (isMoving) {
        player.x += MOVE_SPEED * dt * player.dx;
        player.y += MOVE_SPEED * dt * player.dy;
        player.x = Math.min(Math.max(player.x, ARENA_MARGIN), ARENA_WIDTH - ARENA_MARGIN);
        player.y = Math.min(Math.max(player.y, FINISH_Y), BOUND_MAX_Y);
      }

      if (
        room.light === 'red' &&
        isMoving &&
        room.redLightSince !== null &&
        Date.now() - room.redLightSince > RED_LIGHT_GRACE_MS
      ) {
        player.eliminated = true;
      } else if (player.y <= FINISH_Y) {
        player.finished = true;
        player.finishTime = GAME_DURATION - room.timeLeft;
        if (!room.winnerId) {
          room.winnerId = player.userId;
          winner = player;
        }
      }
    });

    const allDone = Array.from(room.players.values()).every((p) => p.eliminated || p.finished);
    const timeUp = room.timeLeft <= 0;

    this.io.to(`room-${room.code}`).emit('match:tick', {
      light: room.light,
      timeLeft: Math.max(0, room.timeLeft),
      players: Array.from(room.players.values()).map((p) => ({
        userId: p.userId,
        username: p.username,
        x: p.x,
        y: p.y,
        eliminated: p.eliminated,
        finished: p.finished
      }))
    });

    if (winner || allDone || timeUp) this._endRoom(room);
  }

  async _endRoom(room) {
    if (room.status === 'ended') return;
    room.status = 'ended';
    if (room.interval) clearInterval(room.interval);

    const results = Array.from(room.players.values()).map((p) => ({
      userId: p.userId,
      username: p.username,
      won: p.userId === room.winnerId,
      finishTime: p.finishTime
    }));

    this.io.to(`room-${room.code}`).emit('match:end', { winnerId: room.winnerId, results });

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
        console.error('Erreur sauvegarde stats salon ami:', err.message);
      }
    }

    this.rooms.delete(room.code);
  }
}

module.exports = FriendRoomManager;
