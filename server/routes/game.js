const express = require('express');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// --- Enregistrer le résultat d'une partie "1,2,3 Soleil" vs IA ---
router.post('/redlight/result', authMiddleware, async (req, res) => {
  try {
    const { won, timeSeconds } = req.body;

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    user.stats.gamesPlayed += 1;
    if (won) {
      user.stats.wins += 1;
      if (
        typeof timeSeconds === 'number' &&
        (user.stats.bestTimeRedLight === null || timeSeconds < user.stats.bestTimeRedLight)
      ) {
        user.stats.bestTimeRedLight = timeSeconds;
      }
    }
    await user.save();

    res.json({ stats: user.stats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// --- Classement des meilleurs temps ---
router.get('/leaderboard', async (req, res) => {
  try {
    const top = await User.find({ 'stats.bestTimeRedLight': { $ne: null } })
      .sort({ 'stats.bestTimeRedLight': 1 })
      .limit(10)
      .select('username stats.bestTimeRedLight stats.wins');

    res.json({ leaderboard: top });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
