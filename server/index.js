require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/game');

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

// --- Socket.io : scaffold pour le multijoueur (Phase 2) ---
// Pour l'instant, on garde juste une connexion de base prête.
// Les rooms "amis" et "en ligne" seront branchées ici à l'étape suivante.
io.on('connection', (socket) => {
  console.log(`Socket connecté: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`Socket déconnecté: ${socket.id}`);
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
