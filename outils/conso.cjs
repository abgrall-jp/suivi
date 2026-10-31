"use strict";
// ---------------------------------------------------------------------------
// Compteurs de consommation d'une application Je peux apprendre, lus par Suivi (onglet « Consommation »).
// Chargé par dist/demarrer.cjs (fichier de démarrage) ou par une ligne ajoutée dans dist/server.cjs :
//   try { require("./conso.cjs")(app, "evalia"); } catch (e) { ... }
// Ce que l'on compte, minute par minute sur 25 heures, et jour par jour sur 400 jours :
//   - les demandes reçues par l'application (/api/...), le nombre traité en même temps (pic),
//   - les refus « Trop de demandes » (429), « crédits épuisés » (402) et les erreurs du serveur (5xx), avec la route et le code,
//   - les appels à Gemini (toutes les fonctions IA), leurs erreurs, les refus de Google (429 = quota), les jetons et la durée.
// Rien sur les élèves ni sur les textes : seulement des nombres et des noms de routes.
// Les chiffres sont gardés en mémoire et recopiés chaque minute dans un petit fichier par processus (dossier ~/.jpa-conso),
// pour additionner les processus lancés par l'hébergeur et ne rien perdre aux redémarrages. Les fichiers des processus
// arrêtés depuis plus d'un jour sont versés dans un fichier « archive » par application.
// Lecture : GET /api/suivi/consommation avec l'en-tête X-Suivi-Cle (la clé SUIVI_CLE de l'application).
// ---------------------------------------------------------------------------
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const MINUTE = 60e3;
const GARDE = 25 * 60;   // minutes gardées
const GARDE_JOURS = 400; // jours gardés
const IA_URL = /\/models\/[^/?]+:(generateContent|streamGenerateContent|generateImages|generateVideos|predict|predictLongRunning|embedContent|batchEmbedContents)\b/;
const CHAMPS = ["req", "pic", "r429", "r402", "e5xx", "ia", "iaErr", "ia429", "iaMs", "tokIn", "tokOut"];
const MAXIMA = new Set(["pic", "iaMin"]); // gardés au plus haut (et non additionnés)

/** Jour à Paris (AAAA-MM-JJ) d'un instant. */
const formatJour = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const jourDe = t => formatJour.format(new Date(t));

let installe = false;

module.exports = function installerConso(app, appId) {
  if (installe) return;
  installe = true;
  const id = String(appId || "appli").replace(/[^a-z0-9_-]/gi, "");
  const demarre = Date.now();
  const dossier = process.env.CONSO_DOSSIER ? path.join(process.env.CONSO_DOSSIER, "jpa-conso") : path.join(os.homedir() || os.tmpdir(), ".jpa-conso");
  const fichier = path.join(dossier, `${id}-${process.pid}.json`);
  const archive = path.join(dossier, `${id}-archive.json`);
  try { fs.mkdirSync(dossier, { recursive: true }); } catch {}
  // Première version : les fichiers étaient dans le dossier temporaire. On les reprend.
  if (!process.env.CONSO_DOSSIER) {
    const ancien = path.join(os.tmpdir(), "jpa-conso");
    try {
      for (const n of fs.readdirSync(ancien)) {
        if (!n.startsWith(id + "-") || !n.endsWith(".json")) continue;
        try { fs.copyFileSync(path.join(ancien, n), path.join(dossier, n)); fs.unlinkSync(path.join(ancien, n)); } catch {}
      }
    } catch {}
  }

  const vide = () => ({ req: 0, pic: 0, r429: 0, r402: 0, e5xx: 0, ia: 0, iaErr: 0, ia429: 0, iaMs: 0, tokIn: 0, tokOut: 0, motifs: {} });
  const videJour = () => ({ ...vide(), iaMin: 0 });
  /** minute (nombre de minutes depuis 1970) -> compteurs */
  const seaux = new Map();
  /** jour (AAAA-MM-JJ) -> compteurs du jour, pour ce processus */
  const jours = new Map();
  let jourCourant = { cle: "", fin: 0 };
  // Un processus précédent avait peut-être le même numéro : on reprend ses chiffres plutôt que de les écraser.
  try {
    const avant = JSON.parse(fs.readFileSync(fichier, "utf8"));
    for (const [m, s] of Object.entries(avant.seaux || {})) seaux.set(Number(m), { ...vide(), ...s, motifs: { ...(s.motifs || {}) } });
    for (const [j, s] of Object.entries(avant.jours || {})) jours.set(j, { ...videJour(), ...s, motifs: { ...(s.motifs || {}) } });
  } catch {}
  /** Les compteurs de la minute et du jour en cours, à mettre à jour ensemble. */
  const seaux2 = () => {
    const now = Date.now();
    const m = Math.floor(now / MINUTE);
    let s = seaux.get(m);
    if (!s) {
      s = vide();
      seaux.set(m, s);
      for (const k of seaux.keys()) if (k < m - GARDE) seaux.delete(k);
    }
    if (now >= jourCourant.fin) jourCourant = { cle: jourDe(now), fin: (m + 1) * MINUTE };
    let j = jours.get(jourCourant.cle);
    if (!j) {
      j = videJour();
      jours.set(jourCourant.cle, j);
      if (jours.size > GARDE_JOURS) jours.delete(jours.keys().next().value);
    }
    return [s, j];
  };
  const ajouter = (paire, champ, n = 1) => {
    paire[0][champ] += n;
    paire[1][champ] += n;
    if (champ === "ia" && paire[0].ia > paire[1].iaMin) paire[1].iaMin = paire[0].ia;
  };
  const motif = (paire, cle) => {
    for (const s of paire) if (Object.keys(s.motifs).length < 60 || s.motifs[cle]) s.motifs[cle] = (s.motifs[cle] || 0) + 1;
  };

  // --- Appels à Gemini : le client Google passe par fetch ---------------------------------
  const fetchOrigine = globalThis.fetch;
  if (typeof fetchOrigine === "function" && !fetchOrigine.__conso) {
    const compte = async function (entree, init) {
      let url = "";
      try { url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : String(entree?.url || ""); } catch {}
      const m = IA_URL.exec(url);
      if (!m) return fetchOrigine.call(this, entree, init);
      const debut = Date.now();
      const p = seaux2();
      ajouter(p, "ia");
      let r;
      try {
        r = await fetchOrigine.call(this, entree, init);
      } catch (e) {
        ajouter(p, "iaErr");
        motif(p, `IA : pas de réponse de Google (${String(e?.name || "erreur")})`);
        throw e;
      }
      ajouter(p, "iaMs", Date.now() - debut);
      if (!r.ok) {
        ajouter(p, "iaErr");
        if (r.status === 429) ajouter(p, "ia429");
        motif(p, `IA : Google a répondu ${r.status}${r.status === 429 ? " (quota)" : r.status === 503 ? " (surchargé)" : ""}`);
      } else if (m[1] === "generateContent") {
        // Jetons lus et écrits, d'après la réponse de Google (lue sur une copie, sans retarder l'application).
        try {
          r.clone().json().then(d => {
            const u = d && d.usageMetadata;
            if (!u) return;
            ajouter(p, "tokIn", Number(u.promptTokenCount) || 0);
            ajouter(p, "tokOut", (Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0));
          }, () => {});
        } catch {}
      }
      return r;
    };
    compte.__conso = true;
    globalThis.fetch = compte;
  }

  // --- Demandes reçues par l'application ----------------------------------------------------
  let enCours = 0;
  const routeDe = req => {
    const r = req.route && req.route.path;
    if (typeof r === "string") return (req.baseUrl || "") + r;
    return String(req.path || "").replace(/\/[^/]*\d[^/]*/g, "/:id").slice(0, 80);
  };
  app.use((req, res, next) => {
    if (!String(req.path || "").startsWith("/api/") || req.path === "/api/suivi/consommation") return next();
    const p = seaux2();
    ajouter(p, "req");
    enCours++;
    for (const s of p) if (enCours > s.pic) s.pic = enCours;
    const json = res.json;
    res.json = function (corps) {
      if (res.statusCode >= 400 && corps && typeof corps === "object" && corps.code) res.locals.consoCode = String(corps.code).slice(0, 30);
      return json.call(this, corps);
    };
    let fini = false;
    const fin = () => {
      if (fini) return;
      fini = true;
      enCours--;
      const st = res.statusCode;
      if (st !== 429 && st !== 402 && st < 500) return;
      const q = seaux2();
      ajouter(q, st === 429 ? "r429" : st === 402 ? "r402" : "e5xx");
      motif(q, `${st} ${req.method} ${routeDe(req)}${res.locals.consoCode ? " " + res.locals.consoCode : ""}`);
    };
    res.on("finish", fin);
    res.on("close", fin);
    next();
  });

  // --- Fichiers : un par processus, plus l'archive des processus arrêtés ------------------------
  const ecrireJson = (p, obj) => {
    fs.writeFileSync(p + ".tmp", JSON.stringify(obj));
    fs.renameSync(p + ".tmp", p);
  };
  const ecrire = () => {
    try {
      ecrireJson(fichier, { format: 2, pid: process.pid, demarre, maj: Date.now(), memoire: process.memoryUsage().rss, seaux: Object.fromEntries(seaux), jours: Object.fromEntries(jours) });
    } catch {}
  };
  const lire = p => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
  /** Jours d'un fichier ; un fichier de la première version n'a que ses minutes : on les range par jour. */
  const joursDuFichier = d => {
    if (d && d.jours) return d.jours;
    const out = {};
    for (const [m, s] of Object.entries((d && d.seaux) || {})) {
      const j = (out[jourDe(Number(m) * MINUTE)] ||= videJour());
      ajouterTout(j, s);
      if ((Number(s.ia) || 0) > j.iaMin) j.iaMin = Number(s.ia) || 0;
    }
    return out;
  };
  const ajouterTout = (t, s) => {
    for (const k of [...CHAMPS, "iaMin"]) {
      if (!(k in t)) continue;
      const v = Number(s[k]) || 0;
      t[k] = MAXIMA.has(k) ? Math.max(t[k], v) : t[k] + v;
    }
    for (const [k, v] of Object.entries(s.motifs || {})) if (Object.keys(t.motifs).length < 60 || t.motifs[k]) t.motifs[k] = (t.motifs[k] || 0) + (Number(v) || 0);
  };
  /** Verse dans l'archive les fichiers des processus arrêtés depuis plus de 26 heures (un seul processus à la fois). */
  const archiver = () => {
    const verrou = archive + ".verrou";
    try { fs.mkdirSync(verrou); } catch {
      try { if (Date.now() - fs.statSync(verrou).mtimeMs > 10 * MINUTE) fs.rmdirSync(verrou); } catch {}
      return;
    }
    try {
      let noms = [];
      try { noms = fs.readdirSync(dossier); } catch {}
      const vieux = noms.filter(n => /^.+-\d+\.json$/.test(n) && n.startsWith(id + "-") && n !== path.basename(fichier)).map(n => path.join(dossier, n))
        .filter(p => { try { return Date.now() - fs.statSync(p).mtimeMs > 26 * 3600e3; } catch { return false; } });
      if (!vieux.length) return;
      const a = lire(archive) || { jours: {} };
      for (const p of vieux) {
        const d = lire(p);
        for (const [j, s] of Object.entries(joursDuFichier(d))) ajouterTout((a.jours[j] ||= videJour()), s);
      }
      const garder = Object.keys(a.jours).sort().slice(-GARDE_JOURS);
      a.jours = Object.fromEntries(garder.map(j => [j, a.jours[j]]));
      ecrireJson(archive, a);
      for (const p of vieux) try { fs.unlinkSync(p); } catch {}
    } catch {} finally {
      try { fs.rmdirSync(verrou); } catch {}
    }
  };
  setTimeout(archiver, 5000).unref?.();
  const minuterieArchive = setInterval(archiver, 6 * 3600e3);
  if (minuterieArchive.unref) minuterieArchive.unref();
  const minuterie = setInterval(ecrire, MINUTE);
  if (minuterie.unref) minuterie.unref();
  // À l'arrêt : dernière copie, puis arrêt normal si l'application ne gère pas elle-même ce signal.
  process.once("SIGTERM", () => {
    ecrire();
    if (process.listenerCount("SIGTERM") === 0) process.kill(process.pid, "SIGTERM");
  });

  const autresProcessus = () => {
    const out = [];
    let noms = [];
    try { noms = fs.readdirSync(dossier); } catch {}
    for (const n of noms) {
      if (!n.startsWith(id + "-") || !/-\d+\.json$/.test(n) || n === path.basename(fichier)) continue;
      const d = lire(path.join(dossier, n));
      if (!d) continue;
      d.vivant = Date.now() - (Number(d.maj) || 0) < 3 * MINUTE;
      out.push(d);
    }
    return out;
  };

  // --- Lecture par Suivi -----------------------------------------------------------------------
  const essais = new Map();
  app.get("/api/suivi/consommation", (req, res) => {
    const cle = String(process.env.SUIVI_CLE || "").trim();
    if (!cle) return res.status(404).json({ error: "Cette application n'est pas reliée à Suivi (SUIVI_CLE manquante)." });
    const recue = crypto.createHash("sha256").update(String(req.headers["x-suivi-cle"] || "")).digest();
    if (!crypto.timingSafeEqual(recue, crypto.createHash("sha256").update(cle).digest())) {
      const ip = String(req.ip || "");
      const e = essais.get(ip) || { n: 0, fin: Date.now() + 15 * MINUTE };
      if (e.fin < Date.now()) { e.n = 0; e.fin = Date.now() + 15 * MINUTE; }
      essais.set(ip, e);
      if (++e.n > 30) return res.status(429).json({ error: "Trop d'essais." });
      return res.status(401).json({ error: "Clé de liaison incorrecte." });
    }
    const maintenant = Math.floor(Date.now() / MINUTE);
    const tous = new Map();
    const ajouterMinute = (m, s) => {
      if (m < maintenant - 24 * 60 || m > maintenant) return;
      let t = tous.get(m);
      if (!t) { t = vide(); tous.set(m, t); }
      for (const k of CHAMPS) t[k] += Number(s[k]) || 0;
      for (const [k, v] of Object.entries(s.motifs || {})) t.motifs[k] = (t.motifs[k] || 0) + (Number(v) || 0);
    };
    const tousJours = new Map();
    const ajouterJour = (j, s) => {
      let t = tousJours.get(j);
      if (!t) { t = videJour(); tousJours.set(j, t); }
      ajouterTout(t, s);
    };
    const autres = autresProcessus();
    for (const d of autres) {
      for (const [m, s] of Object.entries(d.seaux || {})) ajouterMinute(Number(m), s);
      for (const [j, s] of Object.entries(joursDuFichier(d))) ajouterJour(j, s);
    }
    for (const [m, s] of seaux) ajouterMinute(m, s);
    for (const [j, s] of jours) ajouterJour(j, s);
    for (const [j, s] of Object.entries((lire(archive) || {}).jours || {})) ajouterJour(j, s);

    const resume = (de, a) => {
      const r = { motifs: {}, iaMin: 0 };
      for (const k of CHAMPS) r[k] = 0;
      for (let m = de; m <= a; m++) {
        const s = tous.get(m);
        if (!s) continue;
        if (s.ia > r.iaMin) r.iaMin = s.ia;
        for (const k of CHAMPS) r[k] = k === "pic" ? Math.max(r[k], s[k]) : r[k] + s[k];
        for (const [k, v] of Object.entries(s.motifs)) r.motifs[k] = (r.motifs[k] || 0) + v;
      }
      return r;
    };
    const ligne = s => { const o = {}; for (const k of CHAMPS) o[k] = s ? s[k] : 0; return o; };
    const minutes = [];
    for (let m = maintenant - 59; m <= maintenant; m++) minutes.push({ t: m * MINUTE, ...ligne(tous.get(m)) });
    const heures = [];
    for (let h = 23; h >= 0; h--) {
      const a = maintenant - h * 60, de = a - 59;
      const r = resume(de, a);
      delete r.motifs;
      heures.push({ t: de * MINUTE, ...r });
    }
    const triMotifs = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([motif, n]) => ({ motif, n }));
    const h1 = resume(maintenant - 59, maintenant), j1 = resume(maintenant - 24 * 60 + 1, maintenant);
    const listeJours = [...tousJours.keys()].sort().slice(-GARDE_JOURS).map(j => {
      const s = tousJours.get(j);
      return { jour: j, ...ligne(s), iaMin: s.iaMin };
    });
    const limites = {};
    for (const [k, v] of Object.entries(process.env)) if (/^(LIMITE_|AI_MAX_)/.test(k)) limites[k] = v;
    const vivants = autres.filter(d => d.vivant);
    res.json({
      app: id,
      format: 1,
      version: 2,
      maintenant: Date.now(),
      aujourdhui: jourDe(Date.now()),
      demarreLe: demarre,
      processus: 1 + vivants.length,
      memoireMo: Math.round((process.memoryUsage().rss + vivants.reduce((n, d) => n + (Number(d.memoire) || 0), 0)) / 1048576),
      enCours,
      derniereHeure: { ...ligne(h1), iaMin: h1.iaMin, motifs: triMotifs(h1.motifs) },
      dernieres24h: { ...ligne(j1), iaMin: j1.iaMin, motifs: triMotifs(j1.motifs) },
      minutes,
      heures,
      jours: listeJours,
      limites,
    });
  });
};
