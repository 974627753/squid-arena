const express = require('express');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// --- Ajouter un ami par pseudo ---
router.post('/add', authMiddleware, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Pseudo requis.' });

    const target = await User.findOne({ username: username.trim() });
    if (!target) return res.status(404).json({ error: 'Ce joueur n\'existe pas.' });
    if (target._id.equals(req.userId)) {
      return res.status(400).json({ error: 'Tu ne peux pas t\'ajouter toi-même.' });
    }

    const me = await User.findById(req.userId);
    if (me.friends.some((f) => f.equals(target._id))) {
      return res.status(409).json({ error: 'Ce joueur est déjà dans ta liste d\'amis.' });
    }

    me.friends.push(target._id);
    await me.save();

    res.status(201).json({
      friend: { id: target._id, username: target.username, stats: target.stats }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// --- Liste des amis avec leurs stats ---
router.get('/', authMiddleware, async (req, res) => {
  try {
    const me = await User.findById(req.userId).populate('friends', 'username stats');
    res.json({
      friends: me.friends.map((f) => ({ id: f._id, username: f.username, stats: f.stats }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// --- Retirer un ami ---
router.delete('/:friendId', authMiddleware, async (req, res) => {
  try {
    const me = await User.findById(req.userId);
    me.friends = me.friends.filter((f) => !f.equals(req.params.friendId));
    await me.save();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
