# Blocage de connexion : 5 minutes + avertissement (9 nov.)

Clients (index.html + assets) : copier dans le dist de chaque appli (sans supprimer les anciens assets).
Serveurs :
- suivi/server.cjs et planclasse/server.cjs : fichiers complets fournis (dépôts publics).
- Autres applis (dépôts privés) : retouche directe du server.cjs en ligne, après sauvegarde :
  - Mots croisés, Organigrammes, Eval-IA, Edubot :
    `loginLimiter = makeLimiter(10, 15 * 60 * 1e3)` -> `loginLimiter = makeLimiter(10, 5 * 60 * 1e3)`
    et les messages « Réessaie/Réessayez dans 15 minutes » -> « dans 5 minutes » (route de connexion élève/parent).
  - Concentré : `limiteEssaisEleve = makeLimiter(10, 15 * MINUTE)` -> `makeLimiter(10, 5 * MINUTE)` ;
    `limiteEssaisIP = makeLimiter(60, 15 * MINUTE)` -> `makeLimiter(600, 5 * MINUTE)` (toute une classe sur la même adresse) ;
    message « Patiente un quart d'heure ou demande… » -> « Patiente 5 minutes ou demande… ».
  - Séquenceur : dans /api/auth/student-login uniquement : `studentLoginAttempts.set(rateKey, { count: 1, resetTime: now + 15 * 60 * 1e3 })`
    -> `5 * 60 * 1e3`, et le message « … pour cet élève. Veuillez réessayer dans 15 minutes. » -> « dans 5 minutes. ».
    Garder la ligne conso.cjs.
Contrôle : `node --check server.cjs`, redémarrage, attente >= 15 s, page 200 et nouveaux assets référencés ; sinon retour à la sauvegarde.
Avant de copier un client : comparer avec le JS en ligne (rien ne doit manquer, sinon arrêter et signaler).
