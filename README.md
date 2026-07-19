# Arène 456 — Phase 1

Jeu d'élimination inspiré des jeux de survie, jouable dans le navigateur.
**Phase 1** : comptes joueurs + mini-jeu "1, 2, 3 Soleil" en solo vs IA.
**Phase 2 (à venir)** : multijoueur entre amis + en ligne (Socket.io déjà en place côté serveur).

## 🎮 Fonctionnalités actuelles

- Inscription / connexion (mot de passe hashé + JWT)
- Statistiques joueur sauvegardées en base (parties jouées, victoires, meilleur temps)
- Mini-jeu "1, 2, 3 Soleil" : avance pendant le feu vert, fige-toi au feu rouge
- Classement (endpoint prêt, à afficher dans l'UI à l'étape suivante)

## 🧱 Stack technique

- **Backend** : Node.js, Express, Socket.io (prêt pour le multijoueur)
- **Base de données** : MongoDB (via Mongoose)
- **Auth** : bcrypt + JWT
- **Frontend** : HTML / CSS / JS vanilla, Canvas pour le jeu

## 🚀 Lancer en local

```bash
npm install
cp .env.example .env
# Remplis .env avec ton URI MongoDB et un JWT_SECRET
npm run dev
```

Ouvre ensuite `http://localhost:3000`.

## 🗄️ Créer une base MongoDB gratuite (5 min)

1. Va sur [mongodb.com/cloud/atlas/register](https://www.mongodb.com/cloud/atlas/register) et crée un compte gratuit.
2. Crée un cluster **M0 (gratuit)**.
3. Dans "Database Access", crée un utilisateur avec mot de passe.
4. Dans "Network Access", autorise `0.0.0.0/0` (accès depuis partout — pratique pour l'hébergement gratuit).
5. Clique sur "Connect" → "Drivers" → copie l'URI (ressemble à `mongodb+srv://user:password@cluster.mongodb.net/...`).
6. Colle cette URI dans `MONGODB_URI` dans ton fichier `.env`.

## 🌐 Héberger gratuitement (Render.com)

1. Mets ce projet sur un dépôt GitHub (public ou privé).
2. Va sur [render.com](https://render.com) → New → Web Service.
3. Connecte ton dépôt GitHub.
4. Configure :
   - **Build command** : `npm install`
   - **Start command** : `npm start`
5. Dans "Environment", ajoute les variables :
   - `MONGODB_URI` → ton URI MongoDB Atlas
   - `JWT_SECRET` → une longue chaîne aléatoire
6. Déploie. Render te donne une URL publique gratuite (ex: `arene456.onrender.com`).

> ⚠️ Sur le plan gratuit de Render, le serveur "s'endort" après 15 min d'inactivité et met ~30-50s à redémarrer au premier accès. C'est normal et gratuit — pour éviter ça il faudrait un plan payant.

**Alternatives gratuites** : Railway.app, Fly.io — le principe est identique (build + start command + variables d'environnement).

## 📁 Structure du projet

```
squid-arena/
├── server/
│   ├── index.js          # Point d'entrée : Express + Socket.io + Mongo
│   ├── models/User.js    # Schéma utilisateur
│   ├── routes/auth.js    # Inscription / connexion / profil
│   ├── routes/game.js    # Sauvegarde des résultats + classement
│   └── middleware/auth.js
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js              # Auth + navigation
│       └── game-redlight.js    # Logique du mini-jeu
├── package.json
└── .env.example
```

## 🔜 Prochaine étape

Une fois ce socle testé et validé :
1. Brancher Socket.io pour le multijoueur **"Entre amis"** (création de salon avec code à partager).
2. Ajouter le mode **"En ligne"** (matchmaking automatique).
3. Synchroniser plusieurs joueurs en temps réel sur la même partie de "1, 2, 3 Soleil" (ou un nouveau mini-jeu compétitif).
