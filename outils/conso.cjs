"use strict";
// ---------------------------------------------------------------------------
// Compteurs de consommation d'une application Je peux apprendre, lus par Suivi (onglet « Consommation »).
// Branché dans dist/server.cjs juste après la création du serveur :
//   try { require("./conso.cjs")(app, "evalia"); } catch (e) { ... }
// Ce que l'on compte, minute par minute, sur les 25 dernières heures :
//   - les demandes reçues par l'application (/api/...), le nombre traité en même temps (pic),
//   - les refus « Trop de demandes » (429), « crédits épuisés » (402) et les erreurs du serveur (5xx), avec la route et le code,
//   - les appels à Gemini (toutes les fonctions IA), leurs erreurs, les refus de Google (429 = quota), les jetons et la durée.
// Rien sur les élèves ni sur les textes : seulement des nombres et des noms de routes.
// Les chiffres sont gardés en mémoire et recopiés chaque minute dans un petit fichier (dossier temporaire du compte),
// pour additionner les processus lancés par l'hébergeur et ne pas tout perdre à un redémarrage.
// Lecture : GET /api/suivi/consommation avec l'en-tête X-Suivi-Cle (la même clé SUIVI_CLE que la porte de liaison).
// ---------------------------------------------------------------------------
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const MINUTE = 60e3;
const GARDE = 25 * 60; // minutes gardées
const IA_URL = /\/models\/[^/?]+:(generateContent|streamGenerateContent|generateImages|generateVideos|predict|predictLongRunning|embedContent|batchEmbedContents)\b/;

let installe = false;

module.exports = function installerConso(app, appId) {
  if (installe) return;
  installe = true;
  const id = String(appId || "appli").replace(/[^a-z0-9_-]/gi, "");
  const demarre = Date.now();
  const dossier = path.join(process.env.CONSO_DOSSIER || os.tmpdir(), "jpa-conso");
  const fichier = path.join(dossier, `${id}-${process.pid}.json`);
  try { fs.mkdirSync(dossier, { recursive: true }); } catch {}

  /** minute (nombre de minutes depuis 1970) -> compteurs */
  const seaux = new Map();
  const vide = () => ({ req: 0, pic: 0, r429: 0, r402: 0, e5xx: 0, ia: 0, iaErr: 0, ia429: 0, iaMs: 0, tokIn: 0, tokOut: 0, motifs: {} });
  const seau = () => {
    const m = Math.floor(Date.now() / MINUTE);
    let s = seaux.get(m);
    if (!s) {
      s = vide();
      seaux.set(m, s);
      for (const k of seaux.keys()) if (k < m - GARDE) seaux.delete(k);
    }
    return s;
  };
  const motif = (s, cle) => {
    if (Object.keys(s.motifs).length < 60 || s.motifs[cle]) s.motifs[cle] = (s.motifs[cle] || 0) + 1;
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
      const s = seau();
      s.ia++;
      let r;
      try {
        r = await fetchOrigine.call(this, entree, init);
      } catch (e) {
        s.iaErr++;
        motif(s, `IA : pas de réponse de Google (${String(e?.name || "erreur")})`);
        throw e;
      }
      s.iaMs += Date.now() - debut;
      if (!r.ok) {
        s.iaErr++;
        if (r.status === 429) s.ia429++;
        motif(s, `IA : Google a répondu ${r.status}${r.status === 429 ? " (quota)" : r.status === 503 ? " (surchargé)" : ""}`);
      } else if (m[1] === "generateContent") {
        // Jetons lus et écrits, d'après la réponse de Google (lue sur une copie, sans retarder l'application).
        try {
          r.clone().json().then(d => {
            const u = d && d.usageMetadata;
            if (!u) return;
            s.tokIn += Number(u.promptTokenCount) || 0;
            s.tokOut += (Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0);
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
    const s = seau();
    s.req++;
    enCours++;
    if (enCours > s.pic) s.pic = enCours;
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
      const t = seau();
      if (st === 429) t.r429++;
      else if (st === 402) t.r402++;
      else t.e5xx++;
      motif(t, `${st} ${req.method} ${routeDe(req)}${res.locals.consoCode ? " " + res.locals.consoCode : ""}`);
    };
    res.on("finish", fin);
    res.on("close", fin);
    next();
  });

  // --- Copie dans un fichier, pour additionner les processus -----------------------------------
  const ecrire = () => {
    try {
      const obj = { pid: process.pid, demarre, maj: Date.now(), memoire: process.memoryUsage().rss, seaux: Object.fromEntries(seaux) };
      fs.writeFileSync(fichier + ".tmp", JSON.stringify(obj));
      fs.renameSync(fichier + ".tmp", fichier);
    } catch {}
  };
  const minuterie = setInterval(ecrire, MINUTE);
  if (minuterie.unref) minuterie.unref();
  process.once("SIGTERM", ecrire);

  const autresProcessus = () => {
    const out = [];
    let noms = [];
    try { noms = fs.readdirSync(dossier); } catch {}
    for (const n of noms) {
      if (!n.startsWith(id + "-") || !n.endsWith(".json")) continue;
      const p = path.join(dossier, n);
      try {
        const st = fs.statSync(p);
        if (Date.now() - st.mtimeMs > 26 * 3600e3) { fs.unlinkSync(p); continue; }
        if (n === path.basename(fichier)) continue;
        const d = JSON.parse(fs.readFileSync(p, "utf8"));
        d.vivant = Date.now() - d.maj < 3 * MINUTE;
        out.push(d);
      } catch {}
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
    const ajouter = (m, s) => {
      if (m < maintenant - 24 * 60 || m > maintenant) return;
      const t = tous.get(m) || vide();
      for (const k of Object.keys(t)) if (k !== "motifs") t[k] += Number(s[k]) || 0;
      for (const [k, v] of Object.entries(s.motifs || {})) t.motifs[k] = (t.motifs[k] || 0) + (Number(v) || 0);
      tous.set(m, t);
    };
    const autres = autresProcessus();
    for (const d of autres) for (const [m, s] of Object.entries(d.seaux || {})) ajouter(Number(m), s);
    for (const [m, s] of seaux) ajouter(m, s);

    const champs = ["req", "pic", "r429", "r402", "e5xx", "ia", "iaErr", "ia429", "iaMs", "tokIn", "tokOut"];
    const resume = (de, a) => {
      const r = { motifs: {} };
      for (const k of champs) r[k] = 0;
      for (let m = de; m <= a; m++) {
        const s = tous.get(m);
        if (!s) continue;
        for (const k of champs) r[k] = k === "pic" ? Math.max(r[k], s[k]) : r[k] + s[k];
        for (const [k, v] of Object.entries(s.motifs)) r.motifs[k] = (r.motifs[k] || 0) + v;
      }
      return r;
    };
    const ligne = s => { const o = {}; for (const k of champs) o[k] = s ? s[k] : 0; return o; };
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
    const limites = {};
    for (const [k, v] of Object.entries(process.env)) if (/^(LIMITE_|AI_MAX_)/.test(k)) limites[k] = v;
    const vivants = autres.filter(d => d.vivant);
    res.json({
      app: id,
      format: 1,
      maintenant: Date.now(),
      demarreLe: demarre,
      processus: 1 + vivants.length,
      memoireMo: Math.round((process.memoryUsage().rss + vivants.reduce((n, d) => n + (Number(d.memoire) || 0), 0)) / 1048576),
      enCours,
      derniereHeure: { ...ligne(h1), motifs: triMotifs(h1.motifs) },
      dernieres24h: { ...ligne(j1), motifs: triMotifs(j1.motifs) },
      minutes,
      heures,
      limites,
    });
  });
};
