require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/game');
const OnlineRedLightManager = require('./game/onlineRedLight');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// --- Middlewares ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- Routes API ---
app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', mongoConnected: mongoose.connection.readyState === 1 });
});

// --- Socket.io : authentification puis dispatch vers les modules de jeu ---
const onlineRedLight = new OnlineRedLightManager(io);

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentification requise'));
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('Token invalide'));
    socket.userId = decoded.userId;
    socket.username = decoded.username;
    next();
  });
});

io.on('connection', (socket) => {
  console.log(`Socket connecté: ${socket.username} (${socket.id})`);

  // --- Matchmaking "1,2,3 Soleil" en ligne ---
  socket.on('redlight:queue:join', () => onlineRedLight.joinQueue(socket));
  socket.on('redlight:queue:leave', () => onlineRedLight.leaveQueue(socket));
  socket.on('redlight:move', ({ matchId, isMoving }) => {
    onlineRedLight.setMoving(socket, matchId, isMoving);
  });

  socket.on('disconnect', () => {
    console.log(`Socket déconnecté: ${socket.username} (${socket.id})`);
    onlineRedLight.handleDisconnect(socket);
  });
});

// --- Connexion MongoDB puis démarrage du serveur ---
const PORT = process.env.PORT || 3000;

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ Connecté à MongoDB');
    server.listen(PORT, () => {
      console.log(`🚀 Serveur lancé sur le port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Erreur de connexion à MongoDB:', err.message);
    process.exit(1);
  });
