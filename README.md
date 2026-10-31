# Suivi

Suivi global des applications Je peux apprendre (suivi.jepeuxapprendre.fr) : chaque enseignant relie ses applications
et voit les résultats de ses élèves au même endroit, avec une seule liste d'élèves.

- `server.ts` : serveur Express (o2switch). Lit les résultats par la « porte de liaison » de chaque application (`/api/suivi/*`).
- `src/` : écrans (connexion, choix des applications, tableau en direct, noms des élèves, liste de l'établissement).
- `lib/correspondance.ts` : rapprochement des noms d'élèves d'une application à l'autre.
- Réglages : voir l'en-tête de `server.ts`.

Construire : `npm install && npm run build`, puis `npm start`.
Essais : `npm test` (rapprochement des noms) ; `tests/` pour l'essai complet avec les émulateurs Firebase.

## Consommation (onglet administrateur)
- `outils/conso.cjs` : compteurs à copier dans `dist/` de chaque application (appels à Gemini, jetons, refus 429/402, erreurs, demandes simultanées).
  `outils/brancher-conso.mjs` ajoute la ligne qui le charge dans `dist/server.cjs`. L'application répond alors sur `/api/suivi/consommation` (clé de liaison).
- `lib/consommation.ts` : additions et alertes (à 80 % des seuils SEUIL_* réglés dans cPanel) ; route `/api/admin/consommation` ; écran `src/Consommation.tsx`.
