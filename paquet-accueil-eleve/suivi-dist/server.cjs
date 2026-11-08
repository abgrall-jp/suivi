"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_crypto3 = __toESM(require("crypto"), 1);
var import_nodemailer = __toESM(require("nodemailer"), 1);
var import_app = require("firebase-admin/app");
var import_auth = require("firebase-admin/auth");
var import_firestore = require("firebase-admin/firestore");

// lib/correspondance.ts
var normaliser = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
var jetons = (s) => normaliser(s).split(" ").filter(Boolean);
var nombres = (mots) => mots.filter((m) => /\d/.test(m));
var cleClasse = (s) => normaliser(s).replace(/\s+/g, "").replace(/^(\d+)(ieme|eme|em|e)?/, "$1");
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prec = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cour = [i];
    for (let j = 1; j <= b.length; j++) cour.push(Math.min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prec = cour;
  }
  return prec[b.length];
}
function comparer(nomApp, classeApp, ref) {
  const a = jetons(nomApp);
  const p = jetons(ref.prenom), n = jetons(ref.nom);
  if (!a.length || !p.length) return null;
  const r = [...p, ...n];
  const trie = (x) => [...x].sort().join(" ");
  let niveau = null;
  if (trie(a) === trie(r)) niveau = "sur";
  else if (Math.min(trie(a).length, trie(r).length) >= 6 && distance(trie(a), trie(r)) <= 1 && trie(nombres(a)) === trie(nombres(r))) niveau = "probable";
  else if (p.every((x) => a.includes(x))) {
    const reste = a.filter((x) => !p.includes(x));
    if (reste.length === 0 || reste.length === 1 && reste[0].length === 1 && n[0]?.startsWith(reste[0])) niveau = "probable";
  }
  if (niveau === "sur" && classeApp && ref.classe && cleClasse(classeApp) !== cleClasse(ref.classe)) niveau = "probable";
  return niveau;
}
function decider(nomApp, classeApp, refs) {
  const surs = [], probables = [];
  for (const ref of refs) {
    const n = comparer(nomApp, classeApp, ref);
    if (n === "sur") surs.push(ref.id);
    else if (n === "probable") probables.push(ref.id);
  }
  if (surs.length === 1) return { statut: "auto", refId: surs[0] };
  if (!surs.length) {
    const cle = [...jetons(nomApp)].sort().join(" ");
    const memes = cle ? refs.filter((r) => [...jetons(r.prenom), ...jetons(r.nom)].sort().join(" ") === cle) : [];
    if (memes.length === 1) return { statut: "auto", refId: memes[0].id };
  }
  const candidats = [...surs, ...probables];
  return candidats.length ? { statut: "a_verifier", candidats: candidats.slice(0, 5) } : { statut: "aucun" };
}
var idEleve = (classe, nom, prenom) => `${cleClasse(classe)}_${normaliser(nom).replace(/ /g, "-")}_${normaliser(prenom).replace(/ /g, "-")}`.slice(0, 150);
function nomPrenomDepuis(nomApp) {
  const mots = String(nomApp || "").trim().split(/\s+/).filter(Boolean);
  if (mots.length <= 1) return { nom: mots[0] || "", prenom: "" };
  const majuscule = (m) => /\p{L}/u.test(m) && m === m.toUpperCase() && m !== m.toLowerCase();
  const nom = mots.filter(majuscule);
  if (nom.length && nom.length < mots.length) return { nom: nom.join(" "), prenom: mots.filter((m) => !majuscule(m)).join(" ") };
  return { nom: mots[mots.length - 1], prenom: mots.slice(0, -1).join(" ") };
}
function lireListe(texte) {
  const eleves = /* @__PURE__ */ new Map();
  const erreurs = [];
  const lignes = String(texte || "").replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lignes.forEach((ligne, i) => {
    const cols = ligne.split(/[;\t,]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (i === 0 && /classe/i.test(cols[0] || "") && /nom/i.test(cols[1] || "")) return;
    const [classe, nom, prenom] = cols;
    const [email1, email2] = [cols[3], cols[4]].map((e) => (e || "").toLowerCase());
    if (!classe || !nom || !prenom) {
      erreurs.push(`Ligne ${i + 1} : il faut la classe, le nom et le pr\xE9nom.`);
      return;
    }
    const mauvais = [email1, email2].find((e) => e && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(e));
    if (mauvais) {
      erreurs.push(`Ligne ${i + 1} : adresse e-mail incorrecte (${mauvais.slice(0, 80)}).`);
      return;
    }
    const id = idEleve(classe, nom, prenom);
    eleves.set(id, { id, classe: classe.slice(0, 40), nom: nom.slice(0, 80), prenom: prenom.slice(0, 80), email1, email2 });
  });
  return { eleves: Array.from(eleves.values()), erreurs };
}
function classeEstUnNom(classe, nom) {
  const c = normaliser(classe);
  if (!c || /\d/.test(c)) return false;
  const mots = new Set(normaliser(nom).split(" "));
  return c.split(" ").every((m) => mots.has(m));
}

// lib/applications.ts
var APPLICATIONS = [
  { id: "sequenceur", code: "SEQ", nom: "S\xE9quenceur", url: "https://sequenceur.jepeuxapprendre.fr", eleves: true },
  { id: "evalia", code: "EVA", nom: "Eval IA", url: "https://evalia.jepeuxapprendre.fr", eleves: true, libelleCode: "Mot de passe enseignant" },
  { id: "edubot", code: "EDU", nom: "Edubot", url: "https://edubot.jepeuxapprendre.fr", eleves: true },
  { id: "cps", code: "CPS", nom: "AI CPS", url: "https://cps.jepeuxapprendre.fr", eleves: true, parents: false },
  { id: "concentre", code: "CON", nom: "Concentr\xE9 et Attentif", url: "https://concentre.jepeuxapprendre.fr", eleves: true, libelleCode: "Code de la classe" },
  { id: "memoriser", code: "MEM", nom: "M\xE9moriser c'est facile", url: "https://memoriser.jepeuxapprendre.fr", eleves: true },
  { id: "motscroises", code: "MCR", nom: "Mots crois\xE9s", url: "https://motscroises.jepeuxapprendre.fr", eleves: true },
  { id: "textetrous", code: "TAT", nom: "Texte \xE0 trous", url: "https://textetrous.jepeuxapprendre.fr", eleves: true },
  { id: "planclasse", code: "PDC", nom: "Plan de classe IA", url: "https://planclasse.jepeuxapprendre.fr", eleves: true, lecture: "planclasse" },
  { id: "appreciations", code: "APP", nom: "Studio d'Appr\xE9ciations", url: "https://appreciations.jepeuxapprendre.fr", eleves: true, lecture: "studio" },
  { id: "quiz", code: "QUIZ", nom: "Quiz IA", url: "https://quiz.jepeuxapprendre.fr", eleves: true },
  { id: "edublockly", code: "EBK", nom: "EduBlockly Micro:bit", url: "https://edublockly.jepeuxapprendre.fr", eleves: true, parents: false },
  { id: "categorisation", code: "CAT", nom: "Cat\xE9gorisation de mots", url: "https://categorisation.jepeuxapprendre.fr", eleves: true },
  { id: "motsmagiques", code: "MMG", nom: "Mots Magiques", url: "https://motsmagiques.jepeuxapprendre.fr", eleves: true, parents: false },
  { id: "conception", code: "CNC", nom: "Assistant Conception P\xE9dagogique", url: "https://conception.jepeuxapprendre.fr", eleves: false },
  { id: "maths", code: "MTH", nom: "G\xE9n\xE9rateur de Probl\xE8mes de Maths", url: "https://maths-pb.jepeuxapprendre.fr", eleves: false },
  { id: "motsmeles", code: "MML", nom: "Mots m\xEAl\xE9s", url: "https://motsmeles.jepeuxapprendre.fr", eleves: false },
  { id: "organigrammes", code: "ORG", nom: "Organigrammes", url: "https://organigrammes.jepeuxapprendre.fr", eleves: true, parents: false },
  { id: "craft", code: "CRF", nom: "Craft", url: "https://craft.jepeuxapprendre.fr", eleves: false },
  { id: "generateurcraft", code: "GCR", nom: "G\xE9n\xE9rateur Craft", url: "https://generateur-craft.jepeuxapprendre.fr", eleves: false },
  { id: "bd", code: "BD", nom: "Cr\xE9ateur BD s\xE9quenc\xE9e", url: "https://bd.jepeuxapprendre.fr", eleves: false },
  { id: "exercicesimage", code: "EXI", nom: "Cr\xE9ateur d'exercices sur image", url: "https://exercices-image.jepeuxapprendre.fr", eleves: false }
];

// lib/consommation.ts
var SEUILS_PAR_DEFAUT = { iaParMinute: 1e3, simultanees: 80, coutJour: 30, prixEntree: 0.75, prixSortie: 3.75, euroParDollar: 0.86, erreursHeure: 5 };
function lireSeuils(env) {
  const n = (cle, def) => {
    const v = Number(String(env[cle] ?? "").replace(",", "."));
    return Number.isFinite(v) && v > 0 ? v : def;
  };
  const d = SEUILS_PAR_DEFAUT;
  return {
    iaParMinute: n("SEUIL_IA_PAR_MINUTE", d.iaParMinute),
    simultanees: n("SEUIL_SIMULTANEES", d.simultanees),
    coutJour: n("SEUIL_COUT_JOUR", d.coutJour),
    prixEntree: n("PRIX_IA_ENTREE", d.prixEntree),
    prixSortie: n("PRIX_IA_SORTIE", d.prixSortie),
    euroParDollar: n("EURO_PAR_DOLLAR", d.euroParDollar),
    erreursHeure: n("SEUIL_ERREURS_HEURE", d.erreursHeure)
  };
}
var ALERTE = 0.8;
var cout = (c, s) => (c.tokIn * s.prixEntree + c.tokOut * s.prixSortie) / 1e6 * s.euroParDollar;
var pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
function synthese(lignes, s, maintenant = Date.now()) {
  const minute = Math.floor(maintenant / 6e4);
  const parMinute = /* @__PURE__ */ new Map();
  for (const l of lignes) {
    const r = l.rapport;
    if (!r) continue;
    l.cout24h = cout(r.dernieres24h, s);
    l.cout1h = cout(r.derniereHeure, s);
    for (const m of r.minutes || []) {
      const k = Math.floor(m.t / 6e4);
      if (k < minute - 59 || k > minute) continue;
      const v = parMinute.get(k) || { ia: 0, pic: 0 };
      v.ia += m.ia || 0;
      v.pic += m.pic || 0;
      parMinute.set(k, v);
    }
  }
  const minutes = Array.from({ length: 60 }, (_, i) => ({ t: (minute - 59 + i) * 6e4, ia: parMinute.get(minute - 59 + i)?.ia || 0, pic: parMinute.get(minute - 59 + i)?.pic || 0 }));
  const avec = lignes.filter((l) => l.rapport);
  const somme = (f) => avec.reduce((n, l) => n + f(l.rapport), 0);
  const total = {
    ia1h: somme((r) => r.derniereHeure.ia),
    ia24h: somme((r) => r.dernieres24h.ia),
    r429h: somme((r) => r.derniereHeure.r429),
    r402h: somme((r) => r.derniereHeure.r402),
    ia429h: somme((r) => r.derniereHeure.ia429),
    e5xxh: somme((r) => r.derniereHeure.e5xx),
    cout1h: avec.reduce((n, l) => n + (l.cout1h || 0), 0),
    cout24h: avec.reduce((n, l) => n + (l.cout24h || 0), 0),
    picIaMinute: Math.max(0, ...minutes.map((m) => m.ia)),
    picSimultanees: Math.max(0, ...minutes.map((m) => m.pic)),
    enCours: somme((r) => r.enCours || 0)
  };
  const alertes = [];
  const seuil = (valeur, max, texte, app2 = null) => {
    if (valeur >= max) alertes.push({ niveau: "danger", app: app2, texte: texte(Math.round(100 * valeur / max)) });
    else if (valeur >= ALERTE * max) alertes.push({ niveau: "attention", app: app2, texte: texte(Math.round(100 * valeur / max)) });
  };
  seuil(total.picIaMinute, s.iaParMinute, (p) => `Appels \xE0 l'IA : jusqu'\xE0 ${total.picIaMinute} par minute dans l'heure, ${p} % du seuil (${s.iaParMinute} par minute, cl\xE9 Gemini commune).`);
  seuil(total.picSimultanees, s.simultanees, (p) => `Jusqu'\xE0 ${total.picSimultanees} demandes trait\xE9es en m\xEAme temps, ${p} % de la limite o2switch (${s.simultanees}).`);
  seuil(total.cout24h, s.coutJour, (p) => `D\xE9pense IA estim\xE9e sur 24 h : ${total.cout24h.toFixed(2).replace(".", ",")} \u20AC, ${p} % du seuil (${s.coutJour} \u20AC).`);
  for (const l of lignes) {
    if (l.etat === "erreur") {
      alertes.push({ niveau: "danger", app: l.nom, texte: `Ne r\xE9pond pas : ${l.message || "erreur"}` });
      continue;
    }
    const r = l.rapport;
    if (!r) continue;
    const h = r.derniereHeure;
    if (h.ia429 > 0) alertes.push({ niveau: "danger", app: l.nom, texte: `Google a refus\xE9 ${pluriel(h.ia429, "appel")} \xE0 l'IA dans l'heure (quota de la cl\xE9 Gemini atteint).` });
    if (h.r402 > 0) alertes.push({ niveau: "danger", app: l.nom, texte: `${pluriel(h.r402, "demande")} refus\xE9e${h.r402 > 1 ? "s" : ""} dans l'heure : cr\xE9dits IA \xE9puis\xE9s. Rechargez les cr\xE9dits de l'enseignant concern\xE9.` });
    if (h.r429 > 0) {
      const ou = h.motifs.filter((m) => m.motif.startsWith("429 ")).slice(0, 3).map((m) => `${m.motif.slice(4)} (${m.n})`).join(", ");
      alertes.push({ niveau: h.r429 >= 20 ? "danger" : "attention", app: l.nom, texte: `${h.r429} refus \xAB Trop de demandes \xBB dans l'heure${ou ? " : " + ou : ""}.` });
    }
    seuil(h.e5xx, s.erreursHeure, () => `${pluriel(h.e5xx, "erreur")} du serveur dans l'heure.`, l.nom);
    if (h.ia >= 10 && h.iaErr / h.ia >= 0.1) alertes.push({ niveau: h.iaErr / h.ia >= 0.3 ? "danger" : "attention", app: l.nom, texte: `${Math.round(100 * h.iaErr / h.ia)} % des appels \xE0 l'IA ont \xE9chou\xE9 dans l'heure.` });
    if (h.ia >= 5 && h.iaMs / h.ia > 2e4) alertes.push({ niveau: "attention", app: l.nom, texte: `L'IA r\xE9pond lentement : ${Math.round(h.iaMs / h.ia / 1e3)} s en moyenne dans l'heure.` });
  }
  alertes.sort((a, b) => Number(a.niveau !== "danger") - Number(b.niveau !== "danger"));
  return { total, minutes, alertes };
}
function estRapport(d) {
  return !!d && typeof d === "object" && d.format === 1 && !!d.derniereHeure && !!d.dernieres24h && Array.isArray(d.minutes) && Array.isArray(d.heures);
}
function jourMoins(jour, n) {
  const d = /* @__PURE__ */ new Date(jour + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
var PERIODES_ENS = [
  { id: "auj", nom: "Aujourd'hui", jours: 1 },
  { id: "7j", nom: "7 jours", jours: 7 },
  { id: "30j", nom: "30 jours", jours: 30 },
  { id: "3m", nom: "3 mois", jours: 91 },
  { id: "1an", nom: "1 an", jours: 365 }
];
var estPeriodeEns = (p) => PERIODES_ENS.some((x) => x.id === p);
function regrouperEnseignants(parApp, s, trouver = () => void 0) {
  const lignes = /* @__PURE__ */ new Map();
  for (const a of parApp) {
    for (const e of a.liste) {
      const sansCompte = e.cle === "-";
      const f = sansCompte ? void 0 : trouver(a.id, e.cle);
      const cle = sansCompte ? "-" : f?.cle || e.cle;
      let l = lignes.get(cle);
      if (!l) {
        l = { cle, nom: sansCompte ? "Sans compte (\xE9l\xE8ves, visiteurs)" : f?.nom || e.nom || e.cle, connu: !!f, sansCompte, req: 0, ia: 0, iaErr: 0, tokIn: 0, tokOut: 0, cout: 0, apps: [] };
        lignes.set(cle, l);
      }
      const c = cout({ tokIn: Number(e.tokIn) || 0, tokOut: Number(e.tokOut) || 0 }, s);
      for (const k of ["req", "ia", "iaErr", "tokIn", "tokOut"]) l[k] += Number(e[k]) || 0;
      l.cout += c;
      const ap = l.apps.find((x) => x.id === a.id);
      if (ap) {
        ap.ia += Number(e.ia) || 0;
        ap.cout += c;
      } else l.apps.push({ id: a.id, nom: a.nom, ia: Number(e.ia) || 0, cout: c });
    }
  }
  for (const l of lignes.values()) l.apps.sort((x, y) => y.cout - x.cout || y.ia - x.ia);
  return [...lignes.values()].sort((x, y) => Number(x.sansCompte) - Number(y.sansCompte) || y.cout - x.cout || y.ia - x.ia);
}
function lireTauxBce(xml) {
  const usd = /currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/.exec(xml);
  const jour = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml);
  const r = usd ? Number(usd[1]) : NaN;
  if (!jour || !Number.isFinite(r) || r < 0.5 || r > 2) return null;
  return { euroParDollar: Math.round(1 / r * 1e4) / 1e4, jour: jour[1] };
}

// lib/parents.ts
var import_crypto = __toESM(require("crypto"), 1);
var MOTS = [
  "Arbre",
  "Avion",
  "Balle",
  "Bateau",
  "Biche",
  "Bougie",
  "Cactus",
  "Castor",
  "Cerise",
  "Chat",
  "Citron",
  "Colline",
  "Comete",
  "Corail",
  "Dauphin",
  "Domino",
  "Dragon",
  "Etoile",
  "Falaise",
  "Fusee",
  "Girafe",
  "Glacier",
  "Hibou",
  "Jardin",
  "Kiwi",
  "Lama",
  "Lapin",
  "Lune",
  "Mangue",
  "Marmotte",
  "Melon",
  "Mouette",
  "Nuage",
  "Olive",
  "Orange",
  "Panda",
  "Papillon",
  "Pirate",
  "Planete",
  "Plume",
  "Poire",
  "Pomme",
  "Prairie",
  "Radis",
  "Renard",
  "Riviere",
  "Robot",
  "Sable",
  "Sapin",
  "Soleil",
  "Tigre",
  "Tomate",
  "Tortue",
  "Tulipe",
  "Vague",
  "Vanille",
  "Violon",
  "Volcan",
  "Zebre",
  "Ecureuil",
  "Flocon",
  "Grenade",
  "Moulin",
  "Phare"
];
function genererMotDePasse() {
  const m = () => MOTS[import_crypto.default.randomInt(MOTS.length)];
  return `${m()}-${m()}-${String(import_crypto.default.randomInt(100)).padStart(2, "0")}`;
}
function empreinte(motDePasse) {
  const sel = import_crypto.default.randomBytes(16);
  return `scrypt:${sel.toString("hex")}:${import_crypto.default.scryptSync(motDePasse, sel, 32).toString("hex")}`;
}
function correspond(motDePasse, e) {
  const [, sel, attendue] = String(e).split(":");
  if (!sel || !attendue) return false;
  const calculee = import_crypto.default.scryptSync(motDePasse, Buffer.from(sel, "hex"), 32);
  const b = Buffer.from(attendue, "hex");
  return b.length === calculee.length && import_crypto.default.timingSafeEqual(calculee, b);
}

// lib/famille.ts
var import_crypto2 = __toESM(require("crypto"), 1);
function genererCode() {
  return `${genererMotDePasse()}-${import_crypto2.default.randomInt(10)}`;
}
function normaliserCode(code) {
  return String(code ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}
var empreinteCode = (code, secret2) => import_crypto2.default.createHmac("sha256", secret2).update(normaliserCode(code)).digest("hex");
function signerJeton(refId, secret2, dureeMs = 30 * 24 * 36e5) {
  const corps = Buffer.from(JSON.stringify({ r: refId, e: Date.now() + dureeMs })).toString("base64url");
  return `${corps}.${import_crypto2.default.createHmac("sha256", secret2).update(corps).digest("base64url")}`;
}
function lireJeton(jeton, secret2) {
  const [corps, sig] = String(jeton || "").split(".");
  if (!corps || !sig) return null;
  const attendue = import_crypto2.default.createHmac("sha256", secret2).update(corps).digest();
  const recue = Buffer.from(sig, "base64url");
  if (recue.length !== attendue.length || !import_crypto2.default.timingSafeEqual(recue, attendue)) return null;
  try {
    const { r, e } = JSON.parse(Buffer.from(corps, "base64url").toString());
    return typeof r === "string" && typeof e === "number" && e > Date.now() ? r : null;
  } catch {
    return null;
  }
}

// lib/studio.ts
function trimestreDe(term) {
  const t = String(term || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/semestre|annee/.test(t)) return null;
  const m = /(?:^|\b|t)([123])(?:er|e|eme)?\b/.exec(t.replace(/trimestre/g, " ").trim()) || /trimestre\s*([123])/.exec(t);
  return m ? `T${m[1]}` : null;
}
var millis = (d) => {
  const t = d.timestamp;
  if (typeof t === "number") return t;
  if (typeof t?.toMillis === "function") return t.toMillis();
  return Date.parse(String(d.createdAt || "")) || 0;
};
function textesParEleve(docs, trimestre, eleves) {
  const res = /* @__PURE__ */ new Map();
  for (const d of docs) {
    const texte = String(d.text || "").trim();
    if (!texte || trimestreDe(d.term || d.period) !== trimestre) continue;
    const dec = decider(String(d.studentName || ""), "", eleves);
    const refId = dec.statut === "auto" ? dec.refId : dec.statut === "a_verifier" && dec.candidats.length === 1 ? dec.candidats[0] : null;
    if (!refId) continue;
    const genre = d.mode === "student" ? "eleve" : "prof";
    const le = millis(d);
    const t = res.get(refId) || {};
    if (!t[genre] || le >= t[genre].le) t[genre] = { texte: texte.slice(0, 3e3), le };
    res.set(refId, t);
  }
  return res;
}

// lib/bulletin.ts
var TRIMESTRES = ["T1", "T2", "T3"];
function periodesParDefaut(maintenant = /* @__PURE__ */ new Date()) {
  const a = maintenant.getMonth() >= 7 ? maintenant.getFullYear() : maintenant.getFullYear() - 1;
  const finFevrier = new Date(Date.UTC(a + 1, 2, 0)).toISOString().slice(0, 10);
  return {
    T1: { debut: `${a}-09-01`, fin: `${a}-11-30` },
    T2: { debut: `${a}-12-01`, fin: finFevrier },
    T3: { debut: `${a + 1}-03-01`, fin: `${a + 1}-07-14` }
  };
}
var estTrimestre = (t) => TRIMESTRES.includes(t);
var dateValide = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
function bornes(p) {
  return { debut: Date.parse(`${p.debut}T00:00:00Z`) - 2 * 36e5, fin: Date.parse(`${p.fin}T23:59:59Z`) };
}
function lireCoef(v) {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) && n > 0 ? Math.min(10, Math.max(0.5, Math.round(n * 2) / 2)) : 1;
}
function essaiRetenu(essais, periode) {
  const { debut, fin } = bornes(periode);
  return essaiQuiCompte((essais || []).filter((e) => e.at === null || e.at >= debut && e.at <= fin));
}
var plusRecent = (liste) => liste.reduce((m, x) => (x.at ?? 0) >= (m.at ?? 0) ? x : m);
function essaiQuiCompte(essais) {
  if (!essais.length) return null;
  const manuelles = essais.filter((e) => e.manuelle), appli = essais.filter((e) => !e.manuelle);
  if (!manuelles.length || !appli.length) return plusRecent(essais);
  const m = plusRecent(manuelles);
  const meilleurEnsuite = appli.filter((e) => (e.at ?? 0) > (m.at ?? 0) && e.percent > m.percent);
  return meilleurEnsuite.length ? plusRecent(meilleurEnsuite) : m;
}
var sur20 = (percent) => Math.round(Math.max(0, Math.min(100, percent)) / 5 * 10) / 10;
function noteColonne(essais, periode) {
  const e = essaiRetenu(essais, periode);
  return e ? sur20(e.percent) : null;
}
function noteSur20(essais, colonnes, periode) {
  let somme = 0, poids = 0;
  for (const c of colonnes) {
    const cle = typeof c === "string" ? c : c.cle;
    const coef = typeof c === "string" ? 1 : lireCoef(c.coef);
    const e = essaiRetenu(essais[cle], periode);
    if (!e) continue;
    somme += Math.max(0, Math.min(100, e.percent)) * coef;
    poids += coef;
  }
  if (!poids) return null;
  return Math.round(somme / poids / 5 * 10) / 10;
}
function colonnesManuelles(essais, colonnes, periode) {
  return colonnes.filter((c) => essaiRetenu(essais[c.cle], periode)?.manuelle).map((c) => c.cle);
}
function dateDansTrimestre(periode, maintenant = Date.now()) {
  const { debut, fin } = bornes(periode);
  if (maintenant > fin) return fin - 12 * 36e5;
  if (maintenant < debut) return debut + 14 * 36e5;
  return maintenant;
}
function lireNote(v) {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", ".").trim());
  if (!Number.isFinite(n) || n < 0 || n > 20) return void 0;
  return Math.round(n * 10) / 10;
}
function moyenne(notes) {
  const v = notes.filter((n) => typeof n === "number");
  return v.length ? Math.round(v.reduce((s, n) => s + n, 0) / v.length * 10) / 10 : null;
}

// lib/sequenceur.ts
function noteDeResultat(score, percent) {
  const m = String(score ?? "").replace(/,/g, ".").match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
  if (m && Number(m[2]) > 0) return { note: Number(m[1]), sur: Number(m[2]) };
  const p = Number(percent);
  return Number.isFinite(p) ? { note: Math.round(Math.max(0, Math.min(100, p)) * 10) / 10, sur: 100 } : null;
}
function trimestresCommences(per, maintenant = Date.now()) {
  return TRIMESTRES.filter((t) => bornes(per[t]).debut <= maintenant).reverse();
}
function codesDeLEleve(refId, resultat, lus) {
  const texte = (v, max) => typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "";
  const codes = [];
  for (const { app: app2, d } of lus) {
    if (!d) continue;
    const mes = new Set(resultat.filter((r) => r.app === app2.id && r.refId === refId).map((r) => r.studentId));
    if (!mes.size) continue;
    const classeDe = new Map(d.classes.map((c) => [c.id, c]));
    const vus = /* @__PURE__ */ new Set();
    for (const s of d.students) {
      if (!mes.has(s.id)) continue;
      const c = classeDe.get(s.classId);
      const code = texte(s.code, 40) || texte(c?.code, 40);
      const libelle = (texte(s.code, 40) ? texte(s.codeLibelle, 60) : texte(c?.codeLibelle, 60)) || app2.libelleCode || "";
      if (!code || !libelle || vus.has(code)) continue;
      vus.add(code);
      codes.push({ appli: app2.id, nom: app2.nom, url: app2.url, libelle, classe: String(c?.name || s.className || ""), code });
    }
  }
  return codes;
}

// lib/planclasse.ts
var plansDe = (plans, email) => plans.filter((p) => String(p.teacherEmail || "").trim().toLowerCase() === email.trim().toLowerCase());
function remarquesParEleve(plans, periode, eleves) {
  const res = /* @__PURE__ */ new Map();
  const vues = /* @__PURE__ */ new Set();
  for (const p of plans) {
    for (const liste of Object.values(p.studentRemarks || {})) {
      for (const r of Array.isArray(liste) ? liste : []) {
        const texte = String(r?.text || "").trim();
        const date = String(r?.date || "").slice(0, 10);
        if (!texte || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < periode.debut || date > periode.fin) continue;
        const dec = decider(String(r.studentName || ""), String(p.className || ""), eleves);
        if (dec.statut !== "auto") continue;
        const cle = `${dec.refId}|${date}|${texte}`;
        if (vues.has(cle)) continue;
        vues.add(cle);
        const seance = [r.sequenceNumber, r.sessionNumber && (/^\d+$/.test(r.sessionNumber) ? `S\xE9ance ${r.sessionNumber}` : r.sessionNumber)].filter(Boolean).join(", ");
        res.set(dec.refId, [...res.get(dec.refId) || [], { date, seance: String(seance).slice(0, 200), texte: texte.slice(0, 2e3) }]);
      }
    }
  }
  for (const l of res.values()) l.sort((a, b) => a.date.localeCompare(b.date));
  return res;
}

// server.ts
var PORT = Number(process.env.PORT) || 3e3;
var APP_VERSION = "2026-11-08.1";
function readJsonFile(fileName) {
  try {
    const p = import_path.default.join(process.cwd(), fileName);
    if (import_fs.default.existsSync(p)) return JSON.parse(import_fs.default.readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`Lecture impossible de ${fileName} :`, e);
  }
  return null;
}
var appletConfig = readJsonFile("firebase-applet-config.json") || {};
var serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT ? (() => {
  try {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch {
    console.error("FIREBASE_SERVICE_ACCOUNT n'est pas un JSON valide");
    return null;
  }
})() : readJsonFile("service-account.json");
var projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount?.project_id || appletConfig.projectId;
var databaseId = process.env.FIRESTORE_DATABASE_ID || appletConfig.firestoreDatabaseId || "(default)";
var adminApp = (0, import_app.getApps)()[0] || (0, import_app.initializeApp)({ projectId, ...serviceAccount ? { credential: (0, import_app.cert)(serviceAccount) } : {} });
var adminAuth = (0, import_auth.getAuth)(adminApp);
var db = databaseId === "(default)" ? (0, import_firestore.getFirestore)(adminApp) : (0, import_firestore.getFirestore)(adminApp, databaseId);
db.settings({ ignoreUndefinedProperties: true });
var studioDb = (0, import_firestore.getFirestore)(adminApp, process.env.STUDIO_FIRESTORE_DATABASE_ID || "ai-studio-f415485f-4d6c-4b39-a9de-42a310ca2292");
var comptePdc = process.env.FIREBASE_SERVICE_ACCOUNT_PLANCLASSE ? (() => {
  try {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_PLANCLASSE);
  } catch {
    console.error("FIREBASE_SERVICE_ACCOUNT_PLANCLASSE n'est pas un JSON valide");
    return null;
  }
})() : readJsonFile("service-account-planclasse.json");
var projetPdc = comptePdc?.project_id || process.env.PLANCLASSE_PROJECT_ID;
var pdcDb = projetPdc ? (0, import_firestore.getFirestore)(
  (0, import_app.initializeApp)({ projectId: projetPdc, ...comptePdc ? { credential: (0, import_app.cert)(comptePdc) } : {} }, "planclasse"),
  process.env.PLANCLASSE_DATABASE_ID || "plan-classe-eu"
) : null;
var cachePlans = null;
async function plansPublies() {
  if (!pdcDb) return [];
  if (cachePlans && Date.now() - cachePlans.at < 2e4) return cachePlans.plans;
  const [plans, secrets, profs] = await Promise.all([
    pdcDb.collection("publishedPlans").select("teacherEmail", "teacherId", "teacherName", "className", "studentRemarks").get(),
    pdcDb.collection("planSecrets").select("studentRemarks").get(),
    pdcDb.collection("teachers").select("email").get()
  ]);
  const remarques = new Map(secrets.docs.map((d) => [d.id, d.get("studentRemarks")]));
  const emails = new Map(profs.docs.map((d) => [d.id, String(d.get("email") || "")]));
  cachePlans = {
    at: Date.now(),
    plans: plans.docs.map((d) => {
      const p = d.data();
      return {
        teacherEmail: p.teacherEmail || emails.get(String(p.teacherId || "")) || "",
        teacherName: p.teacherName,
        className: p.className,
        studentRemarks: remarques.get(d.id) || p.studentRemarks
      };
    })
  };
  return cachePlans.plans;
}
var ADMIN_EMAILS = String(process.env.ADMIN_EMAILS ?? "alimatlea@gmail.com").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
var varApp = (prefixe, a) => process.env[`${prefixe}_${a.id.toUpperCase()}`] || "";
var cleDe = (a) => varApp("SUIVI_CLE", a);
var urlDe = (a) => (varApp("SUIVI_URL", a) || a.url).replace(/\/+$/, "");
var appParId = (id) => APPLICATIONS.find((a) => a.id === id);
var parPorte = (a) => (a.lecture || "porte") === "porte";
var estPrete = (a) => parPorte(a) ? !!cleDe(a) : a.lecture === "planclasse" ? !!pdcDb : true;
async function porte(a, chemin, body) {
  const cle = cleDe(a);
  if (!cle) throw httpError(409, `${a.nom} n'est pas encore reli\xE9e \xE0 Suivi.`);
  for (let essai = 1; ; essai++) {
    let r;
    try {
      r = await fetch(urlDe(a) + chemin, {
        method: body ? "POST" : "GET",
        headers: { "X-Suivi-Cle": cle, ...body ? { "Content-Type": "application/json" } : {} },
        body: body ? JSON.stringify(body) : void 0,
        signal: AbortSignal.timeout(2e4)
      });
    } catch {
      if (!body && essai === 1) {
        await new Promise((ok) => setTimeout(ok, 1500));
        continue;
      }
      throw httpError(502, `${a.nom} ne r\xE9pond pas pour le moment.`);
    }
    let data = {};
    try {
      data = await r.json();
    } catch {
    }
    if (r.ok) return data;
    if (!body && essai === 1 && r.status >= 500) {
      await new Promise((ok) => setTimeout(ok, 1500));
      continue;
    }
    throw httpError(r.status === 404 ? 404 : 502, data?.error || `${a.nom} a refus\xE9 la demande (erreur ${r.status}). R\xE9essayez dans un instant ; si cela continue, red\xE9marrez ${a.nom} dans cPanel.`);
  }
}
function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
function route(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      const status = Number(e?.status) || 500;
      if (status >= 500 && status !== 502) console.error(`${req.method} ${req.path}`, e);
      if (!res.headersSent) res.status(status).json({ error: status >= 500 && status !== 502 ? "Erreur du serveur. R\xE9essayez." : e.message, ...e?.code && status < 500 ? { code: String(e.code) } : {} });
    }
  };
}
function makeLimiter(max, windowMs) {
  const hits = /* @__PURE__ */ new Map();
  return (key) => {
    const now = Date.now();
    if (hits.size > 2e4) {
      for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    }
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    return ++h.count <= max;
  };
}
var limiteCodes = makeLimiter(5, 60 * 60 * 1e3);
var limiteEssais = makeLimiter(10, 15 * 60 * 1e3);
var emailValide = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(e);
var empreinteCode2 = (code) => import_crypto3.default.createHash("sha256").update(code).digest("hex");
function exigerEnseignant() {
  return async (req, res, next) => {
    const h = req.headers.authorization || "";
    let t = null;
    if (h.startsWith("Bearer ")) {
      try {
        t = await adminAuth.verifyIdToken(h.slice(7).trim());
      } catch {
      }
    }
    if (!t?.email) return res.status(401).json({ error: "Connexion requise." });
    if (t.email_verified !== true) return res.status(403).json({ error: "Confirmez d'abord votre adresse avec le lien re\xE7u par e-mail, puis reconnectez-vous." });
    const email = t.email.toLowerCase();
    req.ens = { uid: t.uid, email, nom: String(t.name || email.split("@")[0]), isAdmin: ADMIN_EMAILS.includes(email) };
    next();
  };
}
var ensDe = (req) => req.ens;
async function fiche(e) {
  const ref = db.doc(`enseignants/${e.uid}`);
  const snap = await ref.get();
  if (snap.exists) return snap.data();
  const data = { uid: e.uid, email: e.email, nom: e.nom, apps: {}, creeLe: (/* @__PURE__ */ new Date()).toISOString() };
  await ref.set(data);
  return data;
}
var mailer = process.env.MAIL_FICHIER ? import_nodemailer.default.createTransport({ jsonTransport: true }) : process.env.SMTP_HOST ? import_nodemailer.default.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 465,
  secure: (Number(process.env.SMTP_PORT) || 465) === 465,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : void 0
}) : null;
async function envoyerMail(a, sujet, texte) {
  if (!mailer) throw httpError(503, "L'envoi d'e-mails n'est pas encore r\xE9gl\xE9 sur le serveur.");
  const info = await mailer.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER || "suivi@jepeuxapprendre.fr", to: a, subject: sujet, text: texte });
  if (process.env.MAIL_FICHIER) import_fs.default.appendFileSync(process.env.MAIL_FICHIER, String(info.message) + "\n");
}
var cacheDonnees = /* @__PURE__ */ new Map();
var lecturesEnCours = /* @__PURE__ */ new Map();
async function donnees(a, email, frais = false) {
  const cle = `${a.id}:${email}`;
  const hit = cacheDonnees.get(cle);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < (frais ? 5e3 : 12e4)) return hit.data;
  if (hit && !frais && age < 30 * 6e4) {
    lireDonnees(a, email).catch((err) => console.error(`Relecture de ${a.nom} :`, err?.message || err));
    return hit.data;
  }
  return lireDonnees(a, email);
}
function lireDonnees(a, email) {
  const cle = `${a.id}:${email}`;
  const enCours = lecturesEnCours.get(cle);
  if (enCours) return enCours;
  const p = lireDonneesPorte(a, email).finally(() => lecturesEnCours.delete(cle));
  lecturesEnCours.set(cle, p);
  return p;
}
async function lireDonneesPorte(a, email) {
  const cle = `${a.id}:${email}`;
  const d = await porte(a, `/api/suivi/donnees?email=${encodeURIComponent(email)}`);
  const data = {
    classes: Array.isArray(d.classes) ? d.classes : [],
    students: Array.isArray(d.students) ? d.students : [],
    exercises: Array.isArray(d.exercises) ? d.exercises : [],
    results: Array.isArray(d.results) ? d.results : []
  };
  cacheDonnees.set(cle, { at: Date.now(), data });
  return data;
}
var cacheRefs = null;
async function elevesReference() {
  if (cacheRefs && Date.now() - cacheRefs.at < 6e4) return cacheRefs.refs;
  const snap = await db.collection("eleves").get();
  const refs = snap.docs.map((d) => ({ id: d.id, classe: String(d.get("classe") || ""), nom: String(d.get("nom") || ""), prenom: String(d.get("prenom") || "") }));
  cacheRefs = { at: Date.now(), refs };
  return refs;
}
var cleCorr = (app2, studentId) => `${app2}__${studentId}`.slice(0, 400);
async function rapprocher(lignes) {
  let refs = await elevesReference();
  const provisoire = refs.length === 0;
  const choix = /* @__PURE__ */ new Map();
  const cles = lignes.flatMap((l) => l.d.students.map((s) => cleCorr(l.app.id, s.id)));
  for (let i = 0; i < cles.length; i += 300) {
    const snaps = cles.length ? await db.getAll(...cles.slice(i, i + 300).map((c) => db.doc(`correspondances/${c}`))) : [];
    for (const s of snaps) if (s.exists) choix.set(s.id, s.get("refId") ?? null);
  }
  if (provisoire) refs = [];
  const idsRefs = new Set(refs.map((r) => r.id));
  const resultat = [];
  const entrees = lignes.flatMap(({ app: app2, d }) => {
    const classeDe = new Map(d.classes.map((c) => [c.id, c.name]));
    return d.students.map((s) => {
      const brute = s.className || classeDe.get(s.classId) || "";
      return { app: app2, s, classe: classeEstUnNom(brute, s.name) ? "" : brute };
    });
  });
  entrees.sort((a, b) => Number(!a.classe) - Number(!b.classe));
  for (const { app: app2, s, classe } of entrees) {
    {
      const c = cleCorr(app2.id, s.id);
      if (choix.has(c) && (provisoire || choix.get(c) === null || idsRefs.has(choix.get(c)))) {
        const refId = choix.get(c) ?? null;
        resultat.push({ app: app2.id, studentId: s.id, nom: s.name, classe, statut: refId ? "confirme" : "ignore", refId, candidats: [] });
        continue;
      }
      const dec = decider(s.name, classe, refs);
      if (dec.statut === "auto") resultat.push({ app: app2.id, studentId: s.id, nom: s.name, classe, statut: "auto", refId: dec.refId, candidats: [] });
      else if (provisoire && dec.statut === "aucun") {
        const morceaux = s.name.trim().split(/\s+/);
        const classeVue = !classe ? "Sans classe" : refs.find((r) => cleClasse(r.classe) === cleClasse(classe))?.classe || classe;
        const majuscule = (m) => m.length > 1 && m === m.toLocaleUpperCase("fr") && m !== m.toLocaleLowerCase("fr");
        const enMaj = morceaux.filter(majuscule);
        const [nom, prenom] = enMaj.length && enMaj.length < morceaux.length ? [enMaj.join(" "), morceaux.filter((m) => !majuscule(m)).join(" ")] : [morceaux.slice(1).join(" ") || morceaux[0], morceaux.length > 1 ? morceaux[0] : ""];
        const ref = { id: `app_${cleClasse(classe)}_${normaliser(s.name).replace(/ /g, "-")}`, classe: classeVue, nom, prenom };
        refs.push(ref);
        resultat.push({ app: app2.id, studentId: s.id, nom: s.name, classe, statut: "auto", refId: ref.id, candidats: [] });
      } else resultat.push({ app: app2.id, studentId: s.id, nom: s.name, classe, statut: dec.statut, refId: null, candidats: dec.statut === "a_verifier" ? dec.candidats : [] });
    }
  }
  const corr = new Map((await db.collection("corrections").get()).docs.map((d) => [d.id, d.data()]));
  refs = refs.map((r) => {
    const c = corr.get(r.id.replace(/\//g, "_"));
    return c ? { ...r, nom: String(c.nom ?? r.nom), prenom: String(c.prenom ?? r.prenom) } : r;
  });
  return { refs, provisoire, resultat };
}
var app = (0, import_express.default)();
app.set("trust proxy", true);
app.use(import_express.default.json({ limit: "2mb" }));
app.use((req, res, next) => {
  if (req.method !== "GET" && req.path.startsWith("/api/") && !req.path.startsWith("/api/famille")) res.on("finish", () => memoTableau.clear());
  next();
});
app.get("/api/health", route(async (req, res) => {
  const out = { status: "ok", version: APP_VERSION };
  if (req.query.db !== void 0) {
    out.projet = projectId;
    out.base = databaseId;
    try {
      await db.collection("eleves").limit(1).get();
      out.acces = "ok";
    } catch (e) {
      out.acces = String(e?.message || e).slice(0, 200);
    }
    out.applications = APPLICATIONS.filter((a) => a.eleves).map((a) => ({ id: a.id, reliee: estPrete(a) }));
    out.mails = !!mailer;
  }
  res.json(out);
}));
app.get("/api/moi", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const f = await fiche(e);
  res.json({
    email: e.email,
    nom: f.nom || e.nom,
    isAdmin: e.isAdmin,
    choisies: Array.isArray(f.choisies) ? f.choisies : null,
    apps: f.apps || {},
    catalogue: APPLICATIONS.map((a) => ({ id: a.id, code: a.code, nom: a.nom, url: urlDe(a), eleves: a.eleves, prete: estPrete(a) })),
    mails: !!mailer
  });
}));
app.post("/api/choix", exigerEnseignant(), route(async (req, res) => {
  const ids = Array.isArray(req.body?.applications) ? req.body.applications.filter((id) => !!appParId(id)) : [];
  await fiche(ensDe(req));
  await db.doc(`enseignants/${ensDe(req).uid}`).set({ choisies: Array.from(new Set(ids)) }, { merge: true });
  res.json({ ok: true });
}));
app.post("/api/apps/code", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const a = appParId(req.body?.app);
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!a) throw httpError(400, "Application inconnue.");
  if (!emailValide(email)) throw httpError(400, "Adresse e-mail incorrecte.");
  if (!limiteCodes(e.uid)) throw httpError(429, "Trop de codes demand\xE9s. R\xE9essayez dans une heure.");
  const code = String(import_crypto3.default.randomInt(1e5, 1e6));
  await envoyerMail(
    email,
    "Code de confirmation Suivi",
    `Bonjour,

${e.email} veut relier ${a.nom} \xE0 Suivi avec cette adresse.
Code de confirmation : ${code}
Il est valable 15 minutes.

Si vous n'\xEAtes pas \xE0 l'origine de cette demande, ignorez ce message.`
  );
  await db.doc(`codes/${e.uid}_${a.id}`).set({ email, empreinte: empreinteCode2(code), expire: Date.now() + 15 * 60 * 1e3 });
  res.json({ ok: true });
}));
app.post("/api/apps/relier", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const a = appParId(req.body?.app);
  if (!a || !a.eleves) throw httpError(400, "Application inconnue.");
  const email = String(req.body?.email || e.email).trim().toLowerCase();
  if (email !== e.email) {
    if (!limiteEssais(`code:${e.uid}`)) throw httpError(429, "Trop d'essais. R\xE9essayez dans 15 minutes.");
    const ref = db.doc(`codes/${e.uid}_${a.id}`);
    const c = (await ref.get()).data();
    const code = String(req.body?.code || "").trim();
    if (!c || c.email !== email || c.expire < Date.now() || !code || c.empreinte !== empreinteCode2(code)) throw httpError(403, "Code incorrect ou expir\xE9.");
    await ref.delete();
  }
  let r;
  if (parPorte(a)) r = await porte(a, `/api/suivi/enseignant?email=${encodeURIComponent(email)}`);
  else if (a.lecture === "planclasse") {
    if (!pdcDb) throw httpError(409, `${a.nom} n'est pas encore reli\xE9e \xE0 Suivi.`);
    const plan = plansDe(await plansPublies(), email)[0];
    r = { teacher: plan ? { name: plan.teacherName || "" } : null };
    if (!plan) throw httpError(404, `Aucun plan de classe publi\xE9 avec l'adresse ${email} dans ${a.nom}.`);
  } else r = { teacher: { name: e.nom } };
  if (!r.teacher) throw httpError(404, `Aucun compte enseignant avec l'adresse ${email} dans ${a.nom}.`);
  await fiche(e);
  await db.doc(`enseignants/${e.uid}`).set({
    apps: { [a.id]: { email, nomDansAppli: String(r.teacher.name || ""), relieeLe: (/* @__PURE__ */ new Date()).toISOString() } },
    choisies: import_firestore.FieldValue.arrayUnion(a.id)
  }, { merge: true });
  if (parPorte(a)) db.collection("parents").get().then((snap) => {
    const cibles = /* @__PURE__ */ new Map();
    for (const d of snap.docs) cibles.set(String(d.get("refId")), { ...cibles.get(String(d.get("refId"))) || {}, [Number(d.get("n"))]: String(d.get("empreinte")) });
    return pousserEmpreintes(cibles, { uid: e.uid, app: a.id });
  }).then((r2) => {
    if (r2.erreurs.length) console.error("Mots de passe des parents :", r2.erreurs);
  }).catch((err) => console.error("Mots de passe des parents :", err));
  res.json({ ok: true, nom: String(r.teacher.name || "") });
}));
app.post("/api/apps/retirer", exigerEnseignant(), route(async (req, res) => {
  const a = appParId(req.body?.app);
  if (!a) throw httpError(400, "Application inconnue.");
  await db.doc(`enseignants/${ensDe(req).uid}`).set({ apps: { [a.id]: import_firestore.FieldValue.delete() } }, { merge: true });
  res.json({ ok: true });
}));
async function lireApplications(e, frais = false) {
  const f = await fiche(e);
  const choisies = Array.isArray(f.choisies) ? f.choisies : null;
  const reliees = APPLICATIONS.filter((a) => a.eleves && parPorte(a) && f.apps?.[a.id]?.email && (!choisies || choisies.includes(a.id)));
  const lus = await Promise.all(reliees.map(async (a) => {
    try {
      return { app: a, d: await donnees(a, f.apps[a.id].email, frais), erreur: null };
    } catch (err) {
      const ancien = cacheDonnees.get(`${a.id}:${f.apps[a.id].email}`);
      if (ancien && Date.now() - ancien.at < 12 * 36e5) {
        const heure = new Date(ancien.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
        return { app: a, d: ancien.data, erreur: `${String(err?.message || err)} R\xE9sultats lus \xE0 ${heure} affich\xE9s.` };
      }
      return { app: a, d: null, erreur: String(err?.message || err) };
    }
  }));
  return lus;
}
var appreciationDe = (n, studioProf) => typeof n?.appreciation === "string" ? n.appreciation : String(studioProf || "");
function autreNote(essais, periode) {
  const retenu = essaiRetenu(essais, periode);
  if (!retenu) return null;
  const autre = essaiRetenu((essais || []).filter((e) => !!e.manuelle !== !!retenu.manuelle), periode);
  return autre ? { note: noteColonne([autre], periode), manuelle: !!autre.manuelle } : null;
}
var idNotesManuelles = (uid, refId) => `${uid}__${refId.replace(/\//g, "_")}`;
async function notesManuelles(uid) {
  const snap = await db.collection("notesManuelles").where("uid", "==", uid).get();
  return snap.docs.map((d) => d.data()).filter((d) => d.refId && d.notes && typeof d.notes === "object");
}
async function rattacherColonnesRenommees(uid, manuelles, actuelles) {
  const inconnues = new Set(manuelles.flatMap((m) => Object.keys(m.notes)).filter((c) => !actuelles.has(c)));
  const fin = (cle) => {
    const i = cle.indexOf(":"), j = cle.indexOf("~", i);
    return i > 0 && j > i ? `${cle.slice(0, i)}:${cle.slice(j)}` : null;
  };
  const parFin = /* @__PURE__ */ new Map();
  for (const c of actuelles) {
    const f = fin(c);
    if (f) parFin.set(f, [...parFin.get(f) || [], c]);
  }
  const renommees = /* @__PURE__ */ new Map();
  for (const c of inconnues) {
    const f = fin(c), cand = f ? parFin.get(f) : void 0;
    if (cand?.length === 1) renommees.set(c, cand[0]);
  }
  if (!renommees.size) return;
  const lot = db.batch();
  for (const m of manuelles) {
    if (!Object.keys(m.notes).some((c) => renommees.has(c))) continue;
    const notes = {};
    for (const [c, n] of Object.entries(m.notes)) {
      const nouvelle = renommees.get(c);
      if (nouvelle && !(nouvelle in m.notes)) notes[nouvelle] = n;
      else notes[c] = n;
    }
    m.notes = notes;
    lot.update(db.doc(`notesManuelles/${idNotesManuelles(uid, m.refId)}`), { notes });
  }
  const bulletins = await db.collection("bulletins").where("uid", "==", uid).get();
  for (const d of bulletins.docs) {
    const colonnes = Array.isArray(d.get("colonnes")) ? d.get("colonnes") : [];
    if (!colonnes.some((c) => renommees.has(c?.cle))) continue;
    const deja = new Set(colonnes.map((c) => c?.cle));
    lot.update(d.ref, { colonnes: colonnes.flatMap((c) => {
      const nouvelle = renommees.get(c?.cle);
      if (!nouvelle) return [c];
      return deja.has(nouvelle) ? [] : [{ ...c, cle: nouvelle }];
    }) });
  }
  await lot.commit();
  console.log(`Colonnes renomm\xE9es rattach\xE9es (${uid}) :`, Object.fromEntries(renommees));
}
var derniersConnus = /* @__PURE__ */ new Map();
async function connus(e) {
  const m = derniersConnus.get(e.uid);
  if (m && Date.now() - m.at < 15 * 6e4) return m;
  await calculerTableau(e);
  return derniersConnus.get(e.uid);
}
var memoTableau = /* @__PURE__ */ new Map();
function calculerTableau(e, frais = false) {
  const m = memoTableau.get(e.uid);
  if (m && !frais && Date.now() - m.at < 6e4) return m.p;
  const p = calculerTableauSansMemo(e, frais);
  memoTableau.set(e.uid, { at: Date.now(), p });
  p.catch(() => {
    if (memoTableau.get(e.uid)?.p === p) memoTableau.delete(e.uid);
  });
  return p;
}
async function calculerTableauSansMemo(e, frais = false) {
  const lus = await lireApplications(e, frais);
  const ok = lus.filter((l) => !!l.d);
  const rap = await rapprocher(ok);
  const { provisoire, resultat } = rap;
  const fe = await fiche(e);
  const exclu = estExclu(fe);
  const refs = rap.refs.filter((r) => !exclu(r));
  const gardes = new Set(refs.map((r) => r.id));
  const refDe = new Map(resultat.filter((r) => r.refId && gardes.has(r.refId)).map((r) => [`${r.app}:${r.studentId}`, r.refId]));
  const essais = /* @__PURE__ */ new Map();
  for (const { app: a, d } of ok) {
    for (const r of d.results) {
      const refId = refDe.get(`${a.id}:${r.studentId}`);
      if (!refId) continue;
      const parExo = essais.get(refId) || {};
      (parExo[`${a.id}:${r.exerciseId}`] ||= []).push({ percent: Number(r.percent) || 0, score: String(r.score || ""), at: r.completedAt ?? null });
      essais.set(refId, parExo);
    }
  }
  const manuelles = await notesManuelles(e.uid);
  await rattacherColonnesRenommees(e.uid, manuelles, new Set(ok.flatMap(({ app: a, d }) => d.exercises.map((x) => `${a.id}:${x.id}`))));
  for (const m of manuelles) {
    if (!gardes.has(m.refId)) continue;
    const parExo = essais.get(m.refId) || {};
    for (const [cle, n] of Object.entries(m.notes)) {
      if (typeof n?.note !== "number") continue;
      (parExo[cle] ||= []).push({ percent: n.note * 5, score: `${String(n.note).replace(".", ",")}/20`, at: typeof n.at === "number" ? n.at : null, manuelle: true });
    }
    essais.set(m.refId, parExo);
  }
  const classesApps = lireClassesApps(fe);
  if (Object.keys(classesApps).length) {
    const classeRef = new Map(refs.map((r) => [r.id, cleClasse(r.classe)]));
    for (const [refId, parExo] of essais) {
      const cl = classeRef.get(refId) || "";
      for (const cle of Object.keys(parExo)) {
        const permises = classesApps[cle] || classesApps[cle.split(":")[0]];
        if (permises && !permises.includes(cl)) delete parExo[cle];
      }
    }
  }
  const plusRecent2 = (liste) => essaiQuiCompte(liste);
  derniersConnus.set(e.uid, {
    at: Date.now(),
    refs,
    colonnes: new Set(ok.flatMap(({ app: a, d }) => d.exercises.map((x) => `${a.id}:${x.id}`)))
  });
  const presents = new Set(resultat.map((r) => r.refId).filter((id) => !!id && gardes.has(id)));
  return {
    provisoire,
    refs,
    presents,
    essais,
    plusRecent: plusRecent2,
    resultat,
    lus,
    applications: lus.map((l) => ({
      id: l.app.id,
      code: l.app.code,
      nom: l.app.nom,
      erreur: l.erreur,
      exercices: (l.d?.exercises || []).filter((x) => l.d.results.some((r) => r.exerciseId === x.id)).map((x) => ({ id: x.id, titre: x.title }))
    })),
    aVerifier: resultat.filter((r) => (r.statut === "a_verifier" || r.statut === "aucun") && !exclu({ id: "", nom: r.nom, prenom: "", classe: r.classe })).length,
    masquees: Array.isArray(fe.colonnesMasquees) ? fe.colonnesMasquees.map(String) : [],
    classesApps
  };
}
function lireExclus(f) {
  const x = f?.exclus || {};
  const liste = (v) => Array.isArray(v) ? v.map(String) : [];
  return { eleves: liste(x.eleves), classes: liste(x.classes), inclus: liste(x.inclus) };
}
var estTest = (...textes) => textes.some((t) => /(^| )tests?( |$)/.test(normaliser(t)));
function estExclu(f) {
  const x = lireExclus(f);
  const eleves = new Set(x.eleves), classes = new Set(x.classes), inclus = new Set(x.inclus);
  return (r) => !inclus.has(r.id) && (eleves.has(r.id) || classes.has(cleClasse(r.classe)) || estTest(r.nom, r.prenom, r.classe));
}
var parNom = (a, b) => a.classe.localeCompare(b.classe, "fr") || a.nom.localeCompare(b.nom, "fr") || a.prenom.localeCompare(b.prenom, "fr");
app.get("/api/tableau", exigerEnseignant(), route(async (req, res) => {
  const t = await calculerTableau(ensDe(req), req.query.frais === "1");
  await synchroAnnuaire(ensDe(req), t).catch((err) => console.error("Annuaire de l'accueil :", err));
  res.json({
    provisoire: t.provisoire,
    applications: t.applications,
    eleves: t.refs.filter((r) => t.presents.has(r.id)).sort(parNom).map((r) => ({
      id: r.id,
      classe: r.classe,
      nom: r.nom,
      prenom: r.prenom,
      resultats: Object.fromEntries(Object.entries(t.essais.get(r.id) || {}).map(([k, v]) => [k, t.plusRecent(v)])),
      // Note de l'application et note saisie à la main pour la même colonne : la plus récente compte, l'autre est montrée à côté.
      autres: Object.fromEntries(Object.entries(t.essais.get(r.id) || {}).flatMap(([k, v]) => {
        const retenu = t.plusRecent(v);
        const autres = v.filter((x) => !!x.manuelle !== !!retenu.manuelle);
        return autres.length ? [[k, t.plusRecent(autres)]] : [];
      }))
    })),
    aVerifier: t.aVerifier,
    masquees: t.masquees,
    classesApps: t.classesApps,
    ...await (async () => {
      const pubs = (await db.collection("publications").where("uid", "==", ensDe(req).uid).get()).docs.map((d) => d.data()).filter((d) => d.type === "tableau");
      return {
        publiees: Object.fromEntries(pubs.filter((d) => !d.eleve).map((d) => [String(d.classe), String(d.publieLe)])),
        publieesEleves: Object.fromEntries(pubs.filter((d) => d.eleve).map((d) => [String(d.eleve), String(d.publieLe)]))
      };
    })(),
    lu: Date.now()
  });
}));
async function periodes() {
  const p = periodesParDefaut();
  const reglage = (await db.doc("reglages/trimestres").get()).data() || {};
  for (const t of TRIMESTRES) if (dateValide(reglage[t]?.debut) && dateValide(reglage[t]?.fin)) p[t] = { debut: reglage[t].debut, fin: reglage[t].fin };
  return p;
}
var idBulletin = (uid, t, classe) => `${uid}__${t}__${classe}`;
var texteCourt = (v, max) => String(v ?? "").slice(0, max);
function lireTrimestreClasse(src) {
  const trimestre = src?.trimestre;
  const classe = cleClasse(String(src?.classe || ""));
  if (!estTrimestre(trimestre)) throw httpError(400, "Trimestre incorrect.");
  if (!classe || classe.length > 40) throw httpError(400, "Classe incorrecte.");
  return { trimestre, classe };
}
var elevesDeClasse = (t, classe) => t.refs.filter((r) => cleClasse(r.classe) === classe && (!t.provisoire || t.presents.has(r.id))).sort(parNom);
app.get("/api/bulletin", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const per = await periodes();
  const t = await calculerTableau(e);
  const classes = Array.from(new Map(t.refs.filter((r) => t.presents.has(r.id)).map((r) => [cleClasse(r.classe), r.classe])).entries()).map(([cle, nom]) => ({ cle, nom })).sort((a, b2) => a.nom.localeCompare(b2.nom, "fr"));
  const toutes = t.applications.flatMap((a) => a.exercices.map((x) => ({ cle: `${a.id}:${x.id}`, app: a.nom, titre: x.titre })));
  if (!req.query.trimestre || !req.query.classe) return res.json({ periodes: per, classes, colonnesDispo: toutes });
  const { trimestre, classe } = lireTrimestreClasse(req.query);
  const ref = db.doc(`bulletins/${idBulletin(e.uid, trimestre, classe)}`);
  const b = (await ref.get()).data() || {};
  const refsClasse = elevesDeClasse(t, classe);
  const colonnesDispo = toutes.filter((c) => refsClasse.some((r) => t.essais.get(r.id)?.[c.cle]?.length));
  const titreDe = new Map(toutes.map((c) => [c.cle, c.titre]));
  const colonnes = (Array.isArray(b.colonnes) ? b.colonnes : []).map((c) => ({ cle: String(c.cle), app: String(c.app || ""), titre: titreDe.get(c.cle) || String(c.titre || ""), coef: lireCoef(c.coef) }));
  const externes = Array.isArray(b.externes) ? b.externes : [];
  const notes = b.eleves || {};
  const f = await fiche(e);
  let studio = /* @__PURE__ */ new Map();
  if (f.apps?.appreciations) {
    try {
      const snap = await studioDb.collection("appreciations").where("teacherId", "==", e.uid).get();
      studio = textesParEleve(snap.docs.map((d) => d.data()), trimestre, refsClasse);
    } catch (err) {
      console.error("Lecture du Studio d'Appr\xE9ciations :", err);
    }
  }
  let remarques = /* @__PURE__ */ new Map();
  if (f.apps?.planclasse?.email && pdcDb) {
    try {
      remarques = remarquesParEleve(plansDe(await plansPublies(), f.apps.planclasse.email), per[trimestre], refsClasse);
    } catch (err) {
      console.error("Lecture du Plan de classe IA :", err);
    }
  }
  const eleves = refsClasse.map((r) => {
    const n = notes[r.id] || {};
    const essais = t.essais.get(r.id) || {};
    const calculee = colonnes.length ? noteSur20(essais, colonnes, per[trimestre]) : null;
    return {
      id: r.id,
      nom: r.nom,
      prenom: r.prenom,
      calculee,
      notes: Object.fromEntries(colonnes.map((c) => [c.cle, noteColonne(essais[c.cle], per[trimestre])])),
      manuelles: colonnesManuelles(essais, colonnes, per[trimestre]),
      autres: Object.fromEntries(colonnes.flatMap((c) => {
        const a = autreNote(essais[c.cle], per[trimestre]);
        return a ? [[c.cle, a]] : [];
      })),
      finale: typeof n.finale === "number" ? n.finale : null,
      figeeLe: n.figeeLe || null,
      externes: n.externes || {},
      appreciation: appreciationDe(n, studio.get(r.id)?.prof?.texte),
      appreciationEcrite: typeof n.appreciation === "string",
      studio: { eleve: studio.get(r.id)?.eleve?.texte || "", prof: studio.get(r.id)?.prof?.texte || "" },
      remarques: remarques.get(r.id) || []
    };
  });
  const copie = Object.fromEntries(eleves.map((x) => [x.id, x.calculee]));
  const noms = Object.fromEntries(eleves.map((x) => [x.id, `${x.nom} ${x.prenom}`.trim()]));
  const autoEval = Object.fromEntries(eleves.filter((x) => x.studio.eleve).map((x) => [x.id, x.studio.eleve]));
  const studioProf = Object.fromEntries(eleves.filter((x) => x.studio.prof).map((x) => [x.id, x.studio.prof]));
  if (b.classeNom && JSON.stringify([b.calculees || {}, b.noms || {}, b.autoEval || {}, b.studioProf || {}]) !== JSON.stringify([copie, noms, autoEval, studioProf])) {
    await ref.set({ calculees: copie, noms, autoEval, studioProf, calculeesLe: (/* @__PURE__ */ new Date()).toISOString() }, { merge: true });
  }
  res.json({
    periodes: per,
    classes,
    colonnesDispo,
    trimestre,
    classe,
    colonnes,
    externes,
    eleves,
    studioRelie: !!f.apps?.appreciations,
    publieLe: (await db.doc(`publications/${e.uid}__bulletin__${trimestre}__${classe}`).get()).get("publieLe") || null,
    publieesEleves: Object.fromEntries((await db.collection("publications").where("uid", "==", e.uid).get()).docs.map((d) => d.data()).filter((d) => d.type === "bulletin" && d.eleve && d.trimestre === trimestre && d.classe === classe).map((d) => [String(d.eleve), String(d.publieLe)]))
  });
}));
app.post("/api/bulletin/colonnes", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const { trimestre, classe } = lireTrimestreClasse(req.body);
  const colonnes = (Array.isArray(req.body?.colonnes) ? req.body.colonnes : []).slice(0, 100).map((c) => ({ cle: texteCourt(c?.cle, 300), app: texteCourt(c?.app, 80), titre: texteCourt(c?.titre, 200), coef: lireCoef(c?.coef) })).filter((c) => c.cle);
  const externes = (Array.isArray(req.body?.externes) ? req.body.externes : []).slice(0, 20).map((c) => ({ id: texteCourt(c?.id, 40).replace(/[^a-z0-9_-]/gi, ""), titre: texteCourt(c?.titre, 80).trim() })).filter((c) => c.id && c.titre);
  const t = await calculerTableau(e);
  const classeNom = t.refs.find((r) => cleClasse(r.classe) === classe)?.classe || classe;
  const f = await fiche(e);
  const nomAppli = Object.values(f.apps || {}).map((a) => a?.nomDansAppli).find(Boolean);
  await db.doc(`bulletins/${idBulletin(e.uid, trimestre, classe)}`).set({
    uid: e.uid,
    email: e.email,
    nom: (e.nom.includes("@") || e.nom === e.email.split("@")[0]) && nomAppli ? nomAppli : e.nom,
    trimestre,
    classe,
    classeNom,
    colonnes,
    externes,
    majLe: (/* @__PURE__ */ new Date()).toISOString()
  }, { merge: true });
  res.json({ ok: true });
}));
app.post("/api/bulletin/eleve", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const { trimestre, classe } = lireTrimestreClasse(req.body);
  const refId = texteCourt(req.body?.refId, 200);
  if (!(await connus(e)).refs.some((r) => r.id === refId && cleClasse(r.classe) === classe)) throw httpError(404, "Cet \xE9l\xE8ve n'est pas dans cette classe.");
  const ref = db.doc(`bulletins/${idBulletin(e.uid, trimestre, classe)}`);
  const b = (await ref.get()).data();
  if (!b) throw httpError(409, "Choisissez d'abord les notes \xE0 reprendre.");
  const maj = {};
  if ("finale" in (req.body || {})) {
    const n = lireNote(req.body.finale);
    if (n === void 0) throw httpError(400, "La note doit \xEAtre entre 0 et 20.");
    maj.finale = n;
    maj.figeeLe = n === null ? null : (/* @__PURE__ */ new Date()).toISOString();
  }
  if (req.body?.externes && typeof req.body.externes === "object") {
    maj.externes = {};
    for (const x of b.externes || []) {
      if (!(x.id in req.body.externes)) continue;
      const n = lireNote(req.body.externes[x.id]);
      if (n === void 0) throw httpError(400, `${x.titre} : la note doit \xEAtre entre 0 et 20.`);
      maj.externes[x.id] = n;
    }
  }
  if ("appreciation" in (req.body || {})) maj.appreciation = texteCourt(req.body.appreciation, 2e3);
  await ref.set({ eleves: { [refId]: maj }, majLe: (/* @__PURE__ */ new Date()).toISOString() }, { merge: true });
  res.json({ ok: true });
}));
app.post("/api/bulletin/figer", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const { trimestre, classe } = lireTrimestreClasse(req.body);
  const ref = db.doc(`bulletins/${idBulletin(e.uid, trimestre, classe)}`);
  const b = (await ref.get()).data();
  if (!b?.colonnes?.length) throw httpError(409, "Choisissez d'abord les notes \xE0 reprendre.");
  const per = await periodes();
  const t = await calculerTableau(e);
  const maj = {};
  const le = (/* @__PURE__ */ new Date()).toISOString();
  for (const r of elevesDeClasse(t, classe)) {
    if (typeof b.eleves?.[r.id]?.finale === "number") continue;
    const n = noteSur20(t.essais.get(r.id) || {}, b.colonnes, per[trimestre]);
    if (n !== null) maj[r.id] = { finale: n, figeeLe: le };
  }
  await ref.set({ eleves: maj, majLe: le }, { merge: true });
  res.json({ ok: true, figees: Object.keys(maj).length });
}));
app.post("/api/notes-manuelles", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const refId = texteCourt(req.body?.refId, 200);
  const cle = texteCourt(req.body?.cle, 300);
  const n = lireNote(req.body?.note);
  if (n === void 0) throw httpError(400, "La note doit \xEAtre entre 0 et 20.");
  const c = await connus(e);
  if (!c.refs.some((r) => r.id === refId)) throw httpError(404, "\xC9l\xE8ve introuvable.");
  if (!c.colonnes.has(cle)) throw httpError(404, "Colonne introuvable.");
  let at = Date.now();
  if (req.body?.trimestre !== void 0) {
    if (!estTrimestre(req.body.trimestre)) throw httpError(400, "Trimestre incorrect.");
    at = dateDansTrimestre((await periodes())[req.body.trimestre]);
  }
  await db.doc(`notesManuelles/${idNotesManuelles(e.uid, refId)}`).set({
    uid: e.uid,
    refId,
    notes: { [cle]: n === null ? import_firestore.FieldValue.delete() : { note: n, at, le: (/* @__PURE__ */ new Date()).toISOString() } }
  }, { merge: true });
  res.json({ ok: true });
}));
app.get("/api/pp", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const snap = await db.collection("classes").where("pp", "array-contains", e.email).get();
  const classes = snap.docs.map((d) => ({ cle: d.id, nom: String(d.get("nom") || d.id) })).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const gerees = e.isAdmin ? Array.from(new Map((await elevesReference()).map((r) => [cleClasse(r.classe), r.classe])).entries()).map(([cle, nom]) => ({ cle, nom })).sort((a, b) => a.nom.localeCompare(b.nom, "fr")) : classes;
  res.json({ classes, gerees, periodes: await periodes() });
}));
app.get("/api/pp/bulletin", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const { trimestre, classe } = lireTrimestreClasse(req.query);
  const c = (await db.doc(`classes/${classe}`).get()).data();
  if (!c || !Array.isArray(c.pp) || !c.pp.includes(e.email)) throw httpError(403, "Vous n'\xEAtes pas professeur principal de cette classe.");
  const snap = await db.collection("bulletins").where("classe", "==", classe).where("trimestre", "==", trimestre).get();
  const refs = (await elevesReference()).filter((r) => cleClasse(r.classe) === classe).sort(parNom);
  const matieres = snap.docs.map((d) => d.data()).sort((a, b) => String(a.nom).localeCompare(String(b.nom), "fr")).map((b) => ({
    enseignant: String(b.nom || b.email),
    email: String(b.email || ""),
    externes: Array.isArray(b.externes) ? b.externes : [],
    notes: Object.fromEntries(Object.entries({ ...b.calculees || {}, ...b.eleves || {} }).map(([id]) => {
      const n = b.eleves?.[id] || {};
      return [id, { note: typeof n.finale === "number" ? n.finale : b.calculees?.[id] ?? null, definitive: typeof n.finale === "number", externes: n.externes || {}, appreciation: appreciationDe(n, b.studioProf?.[id]) }];
    }))
  }));
  const nomDe = new Map(snap.docs.flatMap((d) => Object.entries(d.get("noms") || {})));
  const ids = refs.length ? refs.map((r) => ({ id: r.id, nom: r.nom, prenom: r.prenom })) : Array.from(new Set(matieres.flatMap((m) => Object.keys(m.notes)))).map((id) => ({ id, nom: nomDe.get(id) || id, prenom: "" })).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const autoEval = new Map(snap.docs.flatMap((d) => Object.entries(d.get("autoEval") || {})));
  res.json({
    classe,
    nom: c.nom || classe,
    trimestre,
    matieres,
    eleves: ids.map((x) => ({ ...x, moyenne: moyenne(matieres.map((m) => m.notes[x.id]?.note)), autoEval: autoEval.get(x.id) || "" }))
  });
}));
app.get("/api/correspondances", exigerEnseignant(), route(async (req, res) => {
  const lus = await lireApplications(ensDe(req));
  const ok = lus.filter((l) => !!l.d);
  const { refs, provisoire, resultat } = await rapprocher(ok);
  const f = await fiche(ensDe(req));
  const exclu = estExclu(f);
  res.json({
    provisoire,
    exclus: lireExclus(f),
    references: refs.map((r) => ({ id: r.id, classe: r.classe, nom: r.nom, prenom: r.prenom, suivi: !exclu(r) })),
    eleves: resultat.map((r) => ({ ...r, appNom: appParId(r.app)?.nom || r.app, exclu: exclu({ id: r.refId || "", nom: r.nom, prenom: "", classe: r.classe }) }))
  });
}));
app.post("/api/correspondances", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const a = appParId(req.body?.app);
  const studentId = String(req.body?.studentId || "");
  const refId = req.body?.refId === null ? null : String(req.body?.refId || "");
  if (!a || !studentId || studentId.length > 200) throw httpError(400, "\xC9l\xE8ve incorrect.");
  const f = await fiche(e);
  if (!f.apps?.[a.id]?.email) throw httpError(403, "Reliez d'abord cette application.");
  const d = await donnees(a, f.apps[a.id].email);
  if (!d.students.some((s) => s.id === studentId)) throw httpError(404, "Cet \xE9l\xE8ve n'est pas dans vos classes.");
  if (req.body?.oublier) {
    await db.doc(`correspondances/${cleCorr(a.id, studentId)}`).delete();
    return res.json({ ok: true });
  }
  if (refId !== null) {
    const refs = await elevesReference();
    if (refs.length && !refs.some((r) => r.id === refId)) throw httpError(400, "\xC9l\xE8ve de r\xE9f\xE9rence inconnu.");
  }
  await db.doc(`correspondances/${cleCorr(a.id, studentId)}`).set({ refId, par: e.email, le: (/* @__PURE__ */ new Date()).toISOString() });
  res.json({ ok: true });
}));
app.post("/api/eleves/ajouter", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const a = appParId(req.body?.app);
  const studentId = texteCourt(req.body?.studentId, 200);
  if (!a || !studentId) throw httpError(400, "\xC9l\xE8ve incorrect.");
  const f = await fiche(e);
  if (!f.apps?.[a.id]?.email) throw httpError(403, "Reliez d'abord cette application.");
  const d = await donnees(a, f.apps[a.id].email);
  const s = d.students.find((x) => x.id === studentId);
  if (!s) throw httpError(404, "Cet \xE9l\xE8ve n'est pas dans vos classes.");
  const c = d.classes.find((x) => x.id === s.classId);
  const classe = String(c?.name || s.className || "").trim().slice(0, 40);
  const { nom, prenom } = nomPrenomDepuis(String(s.name || ""));
  if (!classe || !nom) throw httpError(400, "Il faut un nom et une classe pour ajouter cet \xE9l\xE8ve.");
  const id = idEleve(classe, nom, prenom);
  const ref = db.doc(`eleves/${id}`);
  if (!(await ref.get()).exists) await ref.set({ classe, nom: nom.slice(0, 80), prenom: prenom.slice(0, 80), email1: "", email2: "", ajoute: true, par: e.email, le: (/* @__PURE__ */ new Date()).toISOString() });
  cacheRefs = null;
  await db.doc(`correspondances/${cleCorr(a.id, studentId)}`).set({ refId: id, par: e.email, le: (/* @__PURE__ */ new Date()).toISOString() });
  res.json({ ok: true, id });
}));
app.post("/api/eleves/nom", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const refId = texteCourt(req.body?.refId, 200);
  const nom = texteCourt(req.body?.nom, 80).trim(), prenom = texteCourt(req.body?.prenom, 80).trim();
  const t = await calculerTableau(e);
  if (!t.refs.some((r) => r.id === refId)) throw httpError(404, "\xC9l\xE8ve introuvable.");
  const ref = db.doc(`corrections/${refId.replace(/\//g, "_")}`);
  if (!nom && !prenom) await ref.delete();
  else if (!nom) throw httpError(400, "Le nom ne peut pas \xEAtre vide.");
  else await ref.set({ nom, prenom, par: e.email, le: (/* @__PURE__ */ new Date()).toISOString() });
  res.json({ ok: true });
}));
app.post("/api/eleves/fusionner", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const de = texteCourt(req.body?.de, 200), vers = texteCourt(req.body?.vers, 200);
  if (!de || !vers || de === vers) throw httpError(400, "Choisissez deux \xE9l\xE8ves diff\xE9rents.");
  const t = await calculerTableau(e, true);
  if (!t.refs.some((r) => r.id === de) || !t.refs.some((r) => r.id === vers)) throw httpError(404, "\xC9l\xE8ve introuvable.");
  const comptes = t.resultat.filter((r) => r.refId === de);
  if (!comptes.length) throw httpError(404, "Aucun compte d'application \xE0 rattacher.");
  const lot = db.batch();
  const le = (/* @__PURE__ */ new Date()).toISOString();
  for (const c of comptes) lot.set(db.doc(`correspondances/${cleCorr(c.app, c.studentId)}`), { refId: vers, par: e.email, le, fusion: de });
  const mDe = await db.doc(`notesManuelles/${idNotesManuelles(e.uid, de)}`).get();
  if (mDe.exists) {
    const mVers = (await db.doc(`notesManuelles/${idNotesManuelles(e.uid, vers)}`).get()).data();
    lot.set(db.doc(`notesManuelles/${idNotesManuelles(e.uid, vers)}`), { uid: e.uid, refId: vers, notes: { ...mDe.get("notes") || {}, ...mVers?.notes || {} } });
    lot.delete(mDe.ref);
  }
  await lot.commit();
  res.json({ ok: true, comptes: comptes.length });
}));
function lireClassesApps(f) {
  const x = f?.classesApps && typeof f.classesApps === "object" ? f.classesApps : {};
  return Object.fromEntries(Object.entries(x).filter(([cle, v]) => appParId(cle.split(":")[0]) && Array.isArray(v) && v.length).map(([cle, v]) => [cle, v.map(String)]));
}
app.post("/api/classes-apps", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const cle = String(req.body?.cle ?? req.body?.app ?? "").slice(0, 300);
  const [appId, ...exo] = cle.split(":");
  if (!appParId(appId) || exo.length && !exo.join(":")) throw httpError(400, "Application inconnue.");
  const classes = Array.from(new Set((Array.isArray(req.body?.classes) ? req.body.classes : []).map((c) => cleClasse(String(c ?? ""))).filter(Boolean))).slice(0, 200);
  await fiche(e);
  await db.doc(`enseignants/${e.uid}`).set({ classesApps: { [cle]: classes } }, { merge: true });
  res.json({ ok: true, classes });
}));
app.post("/api/colonnes-masquees", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const masquees = Array.from(new Set((Array.isArray(req.body?.masquees) ? req.body.masquees : []).map((x) => String(x ?? "").slice(0, 300)).filter(Boolean))).slice(0, 2e3);
  await fiche(e);
  await db.doc(`enseignants/${e.uid}`).set({ colonnesMasquees: masquees }, { merge: true });
  res.json({ ok: true, masquees });
}));
app.post("/api/exclus", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const liste = (v, max, f) => Array.from(new Set((Array.isArray(v) ? v : []).map((x) => f(String(x ?? "")).slice(0, 200)).filter(Boolean))).slice(0, max);
  const exclus = { eleves: liste(req.body?.eleves, 3e3, (x) => x), classes: liste(req.body?.classes, 200, cleClasse), inclus: liste(req.body?.inclus, 3e3, (x) => x) };
  await fiche(e);
  await db.doc(`enseignants/${e.uid}`).set({ exclus }, { merge: true });
  res.json({ ok: true, exclus });
}));
app.get("/api/admin/eleves", exigerEnseignant(), route(async (req, res) => {
  if (!ensDe(req).isAdmin) throw httpError(403, "R\xE9serv\xE9 \xE0 l'administrateur.");
  res.json({ eleves: await elevesReference() });
}));
app.post("/api/admin/eleves", exigerEnseignant(), route(async (req, res) => {
  if (!ensDe(req).isAdmin) throw httpError(403, "R\xE9serv\xE9 \xE0 l'administrateur.");
  const { eleves, erreurs } = lireListe(String(req.body?.texte || "").slice(0, 1e6));
  if (erreurs.length) return res.status(400).json({ error: erreurs.slice(0, 10).join("\n") });
  if (!eleves.length) throw httpError(400, "Aucun \xE9l\xE8ve dans la liste.");
  const avant = await db.collection("eleves").get();
  const garder = new Set(eleves.map((x) => x.id));
  const w = db.bulkWriter();
  for (const d of avant.docs) if (!garder.has(d.id) && d.get("ajoute") !== true) w.delete(d.ref);
  for (const x of eleves) w.set(db.doc(`eleves/${x.id}`), { classe: x.classe, nom: x.nom, prenom: x.prenom, email1: x.email1, email2: x.email2 });
  await w.close();
  cacheRefs = null;
  res.json({ ok: true, nombre: eleves.length, retires: avant.docs.filter((d) => !garder.has(d.id) && d.get("ajoute") !== true).length });
}));
var ADRESSE = (process.env.ADRESSE_PUBLIQUE || "https://suivi.jepeuxapprendre.fr").replace(/\/+$/, "");
var limiteOubliIp = makeLimiter(10, 60 * 60 * 1e3);
var limiteOubliEmail = makeLimiter(3, 60 * 60 * 1e3);
async function pousserEmpreintes(cibles, seulement) {
  const parEleve = /* @__PURE__ */ new Map();
  const erreurs = [];
  if (!cibles.size) return { parEleve, erreurs };
  const ens = seulement ? [await db.doc(`enseignants/${seulement.uid}`).get()] : (await db.collection("enseignants").get()).docs;
  for (const doc of ens) {
    const f = doc.data() || {};
    for (const a of APPLICATIONS) {
      const email = f.apps?.[a.id]?.email;
      if (!a.eleves || a.parents === false || !parPorte(a) || !email || !cleDe(a) || seulement && seulement.app !== a.id) continue;
      try {
        const d = await donnees(a, email);
        const { provisoire, resultat } = await rapprocher([{ app: a, d }]);
        if (provisoire) continue;
        for (const r of resultat) {
          const voulu = r.refId ? cibles.get(r.refId) : void 0;
          if (!voulu) continue;
          for (const [n, emp] of Object.entries(voulu)) await porte(a, "/api/suivi/mot-de-passe-parent", { email, studentId: r.studentId, parent: Number(n), empreinte: emp });
          (parEleve.get(r.refId) || parEleve.set(r.refId, /* @__PURE__ */ new Set()).get(r.refId)).add(a.nom);
        }
      } catch (err) {
        erreurs.push(`${a.nom} (${email}) : ${String(err?.message || err)}`);
      }
    }
  }
  return { parEleve, erreurs };
}
var texteMail = (prenomEnfant, nomEnfant, mdp, apps) => `Bonjour,

Voici votre mot de passe de parent pour suivre ${prenomEnfant} ${nomEnfant} dans les applications Je peux apprendre :

    ${mdp}

Il est personnel : l'autre parent re\xE7oit le sien.
` + (apps.length ? `Il sert dans : ${apps.join(", ")}.
` : "") + `Dans chaque application, choisissez \xAB Parent \xBB, puis votre enfant, et \xE9crivez ce mot de passe.

Les r\xE9sultats et le bulletin publi\xE9s par les enseignants : ${ADRESSE}/famille (votre adresse e-mail et ce mot de passe).

Mot de passe perdu ? Demandez-en un nouveau ici : ${ADRESSE}/parents

Bonne journ\xE9e.`;
async function nouveauxMotsDePasse(liste) {
  const mdp = /* @__PURE__ */ new Map();
  const cibles = /* @__PURE__ */ new Map();
  for (const x of liste) {
    const m = genererMotDePasse();
    const emp = empreinte(m);
    mdp.set(`${x.ref.id}__${x.n}`, m);
    cibles.set(x.ref.id, { ...cibles.get(x.ref.id) || {}, [x.n]: emp });
  }
  const { parEleve, erreurs } = await pousserEmpreintes(cibles);
  let envoyes = 0;
  for (const x of liste) {
    const cle = `${x.ref.id}__${x.n}`;
    await envoyerMail(x.email, `Mot de passe parent : ${x.ref.prenom} ${x.ref.nom}`, texteMail(x.ref.prenom, x.ref.nom, mdp.get(cle), Array.from(parEleve.get(x.ref.id) || [])));
    await db.doc(`parents/${cle}`).set({ refId: x.ref.id, n: x.n, email: x.email, empreinte: cibles.get(x.ref.id)[x.n], envoyeLe: (/* @__PURE__ */ new Date()).toISOString() });
    envoyes++;
  }
  return { envoyes, erreurs };
}
async function peutGererClasse(e, classe) {
  if (e.isAdmin) return true;
  const c = (await db.doc(`classes/${classe}`).get()).data();
  return !!c && Array.isArray(c.pp) && c.pp.includes(e.email);
}
async function elevesAvecParents(classe) {
  const snap = await db.collection("eleves").get();
  return snap.docs.filter((d) => cleClasse(String(d.get("classe") || "")) === classe).map((d) => ({
    id: d.id,
    classe: String(d.get("classe") || ""),
    nom: String(d.get("nom") || ""),
    prenom: String(d.get("prenom") || ""),
    email1: String(d.get("email1") || ""),
    email2: String(d.get("email2") || "")
  })).sort(parNom);
}
app.get("/api/parents", exigerEnseignant(), route(async (req, res) => {
  const classe = cleClasse(String(req.query.classe || ""));
  if (!classe || !await peutGererClasse(ensDe(req), classe)) throw httpError(403, "R\xE9serv\xE9 au professeur principal de la classe et \xE0 l'administrateur.");
  const eleves = await elevesAvecParents(classe);
  const envois = eleves.length ? await db.getAll(...eleves.flatMap((x) => [1, 2].map((n) => db.doc(`parents/${x.id}__${n}`)))) : [];
  const envoi = new Map(envois.filter((d) => d.exists).map((d) => [d.id, d.data()]));
  res.json({
    eleves: eleves.map((x) => ({
      id: x.id,
      nom: x.nom,
      prenom: x.prenom,
      parents: [1, 2].map((n) => {
        const p = envoi.get(`${x.id}__${n}`);
        const email = n === 1 ? x.email1 : x.email2;
        return { n, email, envoyeLe: p && p.email === email ? p.envoyeLe : null };
      })
    }))
  });
}));
app.post("/api/parents/envoyer", exigerEnseignant(), route(async (req, res) => {
  const classe = cleClasse(String(req.body?.classe || ""));
  if (!classe || !await peutGererClasse(ensDe(req), classe)) throw httpError(403, "R\xE9serv\xE9 au professeur principal de la classe et \xE0 l'administrateur.");
  if (!mailer) throw httpError(503, "L'envoi d'e-mails n'est pas encore r\xE9gl\xE9 sur le serveur.");
  const voulus = new Set(Array.isArray(req.body?.refIds) ? req.body.refIds.map(String) : []);
  const liste = (await elevesAvecParents(classe)).filter((x) => voulus.has(x.id)).flatMap((x) => [1, 2].map((n) => ({ ref: x, n, email: n === 1 ? x.email1 : x.email2 }))).filter((x) => x.email);
  if (!liste.length) throw httpError(400, "Aucune adresse de parent pour ces \xE9l\xE8ves.");
  res.json(await nouveauxMotsDePasse(liste));
}));
app.post("/api/parents/oubli", route(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!emailValide(email)) throw httpError(400, "Adresse e-mail incorrecte.");
  if (!limiteOubliIp(String(req.ip)) || !limiteOubliEmail(email)) throw httpError(429, "Trop de demandes. R\xE9essayez dans une heure.");
  const [s1, s2] = await Promise.all([db.collection("eleves").where("email1", "==", email).get(), db.collection("eleves").where("email2", "==", email).get()]);
  const liste = [...s1.docs.map((d) => ({ d, n: 1 })), ...s2.docs.map((d) => ({ d, n: 2 }))].map(({ d, n }) => ({ ref: { id: d.id, classe: String(d.get("classe")), nom: String(d.get("nom")), prenom: String(d.get("prenom")) }, n, email }));
  if (liste.length) {
    try {
      await nouveauxMotsDePasse(liste);
    } catch (e) {
      console.error("Mot de passe parent perdu :", e);
    }
  }
  res.json({ ok: true });
}));
var secretFamille = process.env.SUIVI_SECRET || null;
async function secret() {
  if (secretFamille) return secretFamille;
  const ref = db.doc("reglages/secretFamille");
  const s = await db.runTransaction(async (tx) => {
    const d = await tx.get(ref);
    if (d.exists && d.get("s")) return String(d.get("s"));
    const nouveau = import_crypto3.default.randomBytes(32).toString("hex");
    tx.set(ref, { s: nouveau });
    return nouveau;
  });
  return secretFamille = s;
}
function elevesSuivis(t, classe) {
  return elevesDeClasse(t, classe).filter((r) => t.presents.has(r.id));
}
var nomEnseignant = async (e) => {
  const f = await fiche(e);
  const nomAppli = Object.values(f.apps || {}).map((a) => a?.nomDansAppli).find(Boolean);
  return (e.nom.includes("@") || e.nom === e.email.split("@")[0]) && nomAppli ? String(nomAppli) : e.nom;
};
var lireEleveSeul = (body) => {
  const id = body?.refId === void 0 || body?.refId === null ? "" : String(body.refId).slice(0, 200);
  if (id.includes("/")) throw httpError(400, "\xC9l\xE8ve incorrect.");
  return id;
};
function plusRecentes(docs) {
  const garde = /* @__PURE__ */ new Map();
  for (const d of docs) {
    const k = `${d.type}|${d.uid}|${d.classe}|${d.trimestre || ""}`;
    if (!garde.has(k) || String(d.publieLe) > String(garde.get(k).publieLe)) garde.set(k, d);
  }
  return Array.from(garde.values());
}
app.post("/api/publier/tableau", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const classe = cleClasse(String(req.body?.classe || ""));
  if (!classe || classe.length > 40) throw httpError(400, "Choisissez d'abord une classe.");
  const seul = lireEleveSeul(req.body);
  const ref = db.doc(`publications/${e.uid}__tableau__${classe}${seul ? `__eleve__${seul}` : ""}`);
  if (req.body?.retirer) {
    await ref.delete();
    return res.json({ ok: true });
  }
  const t = await calculerTableau(e, true);
  const eleves = elevesSuivis(t, classe).filter((r) => !seul || r.id === seul);
  if (!eleves.length) throw httpError(404, seul ? "Cet \xE9l\xE8ve n'est pas suivi dans cette classe." : "Aucun \xE9l\xE8ve suivi dans cette classe.");
  const colonnes = t.applications.flatMap((a) => a.exercices.map((x) => ({ cle: `${a.id}:${x.id}`, app: a.nom, titre: x.titre }))).filter((c) => !t.masquees.includes(c.cle) && eleves.some((r) => t.essais.get(r.id)?.[c.cle]?.length));
  const lignes = {};
  for (const r of eleves) {
    const ess = t.essais.get(r.id) || {};
    lignes[r.id] = Object.fromEntries(colonnes.filter((c) => ess[c.cle]?.length).map((c) => {
      const x = t.plusRecent(ess[c.cle]);
      return [c.cle, { percent: Math.round(x.percent), score: x.score, ...x.manuelle ? { manuelle: true } : {} }];
    }));
  }
  const publieLe = (/* @__PURE__ */ new Date()).toISOString();
  await ref.set({
    type: "tableau",
    uid: e.uid,
    enseignant: await nomEnseignant(e),
    classe,
    classeNom: eleves[0].classe,
    publieLe,
    ...seul ? { eleve: seul } : {},
    colonnes,
    lignes,
    refIds: eleves.map((r) => r.id),
    noms: Object.fromEntries(eleves.map((r) => [r.id, { nom: r.nom, prenom: r.prenom, classe: r.classe }]))
  });
  const absents = seul ? [] : t.refs.filter((r) => cleClasse(r.classe) === classe && !t.presents.has(r.id)).sort(parNom).map((r) => `${r.prenom} ${r.nom}`.trim());
  res.json({ ok: true, publieLe, eleves: eleves.length, colonnes: colonnes.length, noms: eleves.map((r) => `${r.prenom} ${r.nom}`.trim()), absents });
}));
app.post("/api/publier/bulletin", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const { trimestre, classe } = lireTrimestreClasse(req.body);
  const seul = lireEleveSeul(req.body);
  const ref = db.doc(`publications/${e.uid}__bulletin__${trimestre}__${classe}${seul ? `__eleve__${seul}` : ""}`);
  if (req.body?.retirer) {
    await ref.delete();
    return res.json({ ok: true });
  }
  const b = (await db.doc(`bulletins/${idBulletin(e.uid, trimestre, classe)}`).get()).data();
  if (!b?.colonnes?.length) throw httpError(409, "Choisissez d'abord les notes \xE0 reprendre.");
  const per = await periodes();
  const t = await calculerTableau(e, true);
  const refs = elevesDeClasse(t, classe).filter((r) => !seul || r.id === seul);
  if (seul && !refs.length) throw httpError(404, "Cet \xE9l\xE8ve n'est pas dans cette classe.");
  const colonnes = b.colonnes.map((c) => ({ cle: String(c.cle), titre: String(c.titre || ""), coef: lireCoef(c.coef) }));
  const externes = Array.isArray(b.externes) ? b.externes : [];
  const eleves = {};
  for (const r of refs) {
    const n = b.eleves?.[r.id] || {};
    const ess = t.essais.get(r.id) || {};
    const calculee = noteSur20(ess, colonnes, per[trimestre]);
    eleves[r.id] = {
      notes: Object.fromEntries(colonnes.map((c) => [c.cle, noteColonne(ess[c.cle], per[trimestre])])),
      manuelles: colonnesManuelles(ess, colonnes, per[trimestre]),
      moyenne: typeof n.finale === "number" ? n.finale : calculee,
      definitive: typeof n.finale === "number",
      externes: Object.fromEntries(externes.map((x) => [x.id, n.externes?.[x.id] ?? null])),
      appreciation: appreciationDe(n, b.studioProf?.[r.id]),
      autoEval: String(b.autoEval?.[r.id] || "")
    };
  }
  const publieLe = (/* @__PURE__ */ new Date()).toISOString();
  await ref.set({
    type: "bulletin",
    uid: e.uid,
    enseignant: await nomEnseignant(e),
    trimestre,
    classe,
    classeNom: refs[0]?.classe || classe,
    publieLe,
    ...seul ? { eleve: seul } : {},
    colonnes,
    externes,
    eleves,
    refIds: refs.map((r) => r.id),
    noms: Object.fromEntries(refs.map((r) => [r.id, { nom: r.nom, prenom: r.prenom, classe: r.classe }]))
  });
  res.json({ ok: true, publieLe, eleves: refs.length });
}));
var identifiantDe = (r) => normaliserCode(`${r.prenom} ${r.nom} ${cleClasse(r.classe)}`).replace(/-/g, ".");
var annuaireEcrit = /* @__PURE__ */ new Map();
async function synchroAnnuaire(e, t) {
  const nom = await nomEnseignant(e);
  const parClasse = /* @__PURE__ */ new Map();
  for (const r of t.refs.filter((r2) => t.presents.has(r2.id))) {
    const c = cleClasse(r.classe);
    if (c && c.length <= 40) parClasse.set(c, [...parClasse.get(c) || [], r]);
  }
  const contenu = Array.from(parClasse.entries()).map(([classe, eleves]) => ({
    id: `${e.uid}__${classe}`,
    uid: e.uid,
    enseignant: nom,
    classe,
    classeNom: eleves[0].classe,
    eleves: Object.fromEntries(eleves.sort(parNom).map((r) => [r.id, { prenom: r.prenom, nom: r.nom }]))
  }));
  const empreinte2 = JSON.stringify(contenu);
  if (annuaireEcrit.get(e.uid) === empreinte2) return;
  const avant = await db.collection("annuaire").where("uid", "==", e.uid).get();
  const lot = db.batch();
  const gardes = new Set(contenu.map((c) => c.id));
  for (const d of avant.docs) if (!gardes.has(d.id)) lot.delete(d.ref);
  for (const { id, ...c } of contenu) lot.set(db.doc(`annuaire/${id}`), { ...c, majLe: (/* @__PURE__ */ new Date()).toISOString() });
  await lot.commit();
  annuaireEcrit.set(e.uid, empreinte2);
}
app.get("/api/famille/codes", exigerEnseignant(), route(async (req, res) => {
  const classe = cleClasse(String(req.query.classe || ""));
  const t = await calculerTableau(ensDe(req));
  const eleves = elevesSuivis(t, classe);
  const docs = eleves.length ? await db.getAll(...eleves.map((r) => db.doc(`codesEleves/${r.id}`))) : [];
  await synchroAnnuaire(ensDe(req), t);
  res.json({ eleves: eleves.map((r, i) => ({
    id: r.id,
    nom: r.nom,
    prenom: r.prenom,
    classe: r.classe,
    codeLe: docs[i]?.get("le") || null,
    identifiant: docs[i]?.get("identifiant") || null,
    personnalise: !!docs[i]?.get("mdp")
  })) });
}));
app.post("/api/famille/codes", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const classe = cleClasse(String(req.body?.classe || ""));
  const t = await calculerTableau(e);
  const voulus = Array.isArray(req.body?.refIds) ? new Set(req.body.refIds.map(String)) : null;
  const eleves = elevesSuivis(t, classe).filter((r) => !voulus || voulus.has(r.id));
  const sec = await secret();
  const existants = eleves.length ? await db.getAll(...eleves.map((r) => db.doc(`codesEleves/${r.id}`))) : [];
  const codes = [];
  const le = (/* @__PURE__ */ new Date()).toISOString();
  const deClasse = String(req.body?.motDeClasse ?? "").trim();
  if (deClasse && (deClasse.length < 6 || deClasse.length > 60)) throw httpError(400, "Le mot de passe de classe doit avoir de 6 \xE0 60 caract\xE8res.");
  const codeCommun = voulus && voulus.size === 1 && !deClasse ? null : deClasse || genererCode();
  for (const [i, r] of eleves.entries()) {
    if (!voulus && existants[i]?.exists) continue;
    let identifiant = existants[i]?.get("identifiant") || "";
    if (!identifiant) {
      const base = identifiantDe(r) || r.id.toLowerCase();
      for (let n = 1; ; n++) {
        const essai = n === 1 ? base : `${base}.${n}`;
        const d = await db.doc(`identifiants/${essai}`).get();
        if (!d.exists || d.get("refId") === r.id) {
          identifiant = essai;
          break;
        }
      }
    }
    const code = codeCommun || genererCode();
    const lot = db.batch();
    lot.set(db.doc(`identifiants/${identifiant}`), { refId: r.id });
    lot.set(db.doc(`codesEleves/${r.id}`), { identifiant, nom: r.nom, prenom: r.prenom, h: empreinteCode(code, sec), mdp: import_firestore.FieldValue.delete(), par: e.email, le }, { merge: true });
    await lot.commit();
    codes.push({ id: r.id, nom: r.nom, prenom: r.prenom, classe: r.classe, identifiant, code });
  }
  res.json({ codes, adresse: `${ADRESSE}/famille`, motDeClasse: codes.length && codeCommun ? codeCommun : null });
}));
var limiteFamille = makeLimiter(10, 15 * 60 * 1e3);
var limiteFamilleIp = makeLimiter(300, 15 * 60 * 1e3);
var essaiFamille = (ip, qui) => {
  if (!limiteFamilleIp(ip) || !limiteFamille(`${ip}|${String(qui ?? "").slice(0, 200).toLowerCase()}`)) throw httpError(429, "Trop d'essais. R\xE9essayez dans un quart d'heure.");
};
function nomsAffiches(eleves) {
  const court = (x) => `${x.prenom} ${x.nom.trim().charAt(0).toUpperCase()}.`.trim();
  const compte = /* @__PURE__ */ new Map();
  for (const x of eleves) compte.set(court(x), (compte.get(court(x)) || 0) + 1);
  return eleves.map((x) => ({ id: x.id, nom: compte.get(court(x)) > 1 ? `${x.prenom} ${x.nom}`.trim() : court(x) })).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}
var limiteAnnuaire = makeLimiter(300, 15 * 60 * 1e3);
app.get("/api/famille/annuaire", route(async (req, res) => {
  if (!limiteAnnuaire(String(req.ip))) throw httpError(429, "Trop de demandes. R\xE9essayez dans un quart d'heure.");
  const snap = await db.collection("annuaire").get();
  const parEns = /* @__PURE__ */ new Map();
  for (const d of snap.docs) {
    const x = d.data();
    const ens = parEns.get(x.uid) || { uid: String(x.uid), nom: String(x.enseignant || ""), classes: [] };
    ens.classes.push({ cle: String(x.classe), nom: String(x.classeNom || x.classe) });
    parEns.set(x.uid, ens);
  }
  const enseignants = Array.from(parEns.values()).map((e) => ({ ...e, classes: e.classes.sort((a, b) => a.nom.localeCompare(b.nom, "fr")) })).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  res.json({ enseignants });
}));
app.get("/api/famille/annuaire/eleves", route(async (req, res) => {
  if (!limiteAnnuaire(String(req.ip))) throw httpError(429, "Trop de demandes. R\xE9essayez dans un quart d'heure.");
  const uid = String(req.query.enseignant || "").replace(/[^A-Za-z0-9_-]/g, "");
  const classe = cleClasse(String(req.query.classe || ""));
  const d = uid && classe ? (await db.doc(`annuaire/${uid}__${classe}`).get()).data() : null;
  if (!d) throw httpError(404, "Classe introuvable.");
  res.json({ eleves: nomsAffiches(Object.entries(d.eleves || {}).map(([id, x]) => ({ id, prenom: String(x?.prenom || ""), nom: String(x?.nom || "") }))) });
}));
var enfantPour = async (refId, sec) => {
  const r = (await elevesReference()).find((x) => x.id === refId) || (await db.doc(`codesEleves/${refId}`).get()).data();
  return { jeton: signerJeton(refId, sec), prenom: String(r?.prenom || ""), nom: String(r?.nom || "") };
};
var MDP_MIN = 8;
var APPS_MDP_ELEVE = (process.env.SUIVI_MDP_APPS || "sequenceur").split(",").map((x) => x.trim()).filter(Boolean);
async function verifierParApplication(refId, mdp, uid) {
  if (!mdp) return false;
  const ens = uid ? [await db.doc(`enseignants/${uid}`).get()] : (await db.collection("enseignants").get()).docs;
  for (const doc of ens) {
    const f = doc.data() || {};
    for (const id of APPS_MDP_ELEVE) {
      const a = appParId(id);
      const email = a ? f.apps?.[a.id]?.email : null;
      if (!a || !email || !parPorte(a) || !cleDe(a)) continue;
      try {
        const { resultat } = await rapprocher([{ app: a, d: await donnees(a, email) }]);
        for (const studentId of new Set(resultat.filter((r) => r.refId === refId).map((r) => r.studentId))) {
          const r = await porte(a, "/api/suivi/verifier-eleve", { email, studentId, code: mdp });
          if (r?.ok === true) return true;
        }
      } catch (err) {
        console.error(`V\xE9rification du mot de passe dans ${a.nom} :`, err?.message || err);
      }
    }
  }
  return false;
}
app.post("/api/famille/connexion", route(async (req, res) => {
  essaiFamille(String(req.ip), req.body?.refId ?? req.body?.identifiant ?? req.body?.email);
  const sec = await secret();
  if (req.body?.refId !== void 0 || req.body?.identifiant !== void 0) {
    const choisi = req.body?.refId !== void 0 ? String(req.body.refId).slice(0, 200) : "";
    const id = choisi ? "" : normaliserCode(req.body.identifiant).replace(/-/g, ".");
    const mdp2 = String(req.body?.motDePasse || "").trim();
    const refId = choisi && !choisi.includes("/") ? choisi : id ? (await db.doc(`identifiants/${id}`).get()).get("refId") : null;
    const c = refId ? (await db.doc(`codesEleves/${refId}`).get()).data() : null;
    if (c?.mdp && correspond(mdp2, c.mdp)) return res.json({ enfants: [await enfantPour(refId, sec)] });
    const uid = String(req.body?.enseignant || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128);
    if (refId && await verifierParApplication(refId, mdp2, uid)) return res.json({ enfants: [await enfantPour(refId, sec)] });
    if (c && !c.mdp && c.h === empreinteCode(mdp2, sec)) {
      return res.json({ doitChanger: true, jeton: signerJeton(`changer:${refId}`, sec, 30 * 6e4), prenom: (await enfantPour(refId, sec)).prenom });
    }
    throw httpError(401, "Mot de passe incorrect. C'est le m\xEAme mot de passe que dans le S\xE9quenceur.");
  }
  const email = String(req.body?.email || "").trim().toLowerCase();
  const mdp = String(req.body?.motDePasse || "").trim();
  let refIds = [];
  if (emailValide(email) && mdp) {
    const snap = await db.collection("parents").where("email", "==", email).get();
    refIds = Array.from(new Set(snap.docs.filter((d) => correspond(mdp, String(d.get("empreinte")))).map((d) => String(d.get("refId")))));
  }
  if (!refIds.length) throw httpError(401, "Adresse ou mot de passe incorrect.");
  res.json({ enfants: await Promise.all(refIds.map((id) => enfantPour(id, sec))) });
}));
app.post("/api/famille/mot-de-passe", route(async (req, res) => {
  essaiFamille(String(req.ip), String(req.body?.jeton || "").slice(0, 60));
  const sec = await secret();
  const lu = lireJeton(String(req.body?.jeton || ""), sec);
  const refId = lu?.startsWith("changer:") ? lu.slice(8) : lu;
  if (!refId) throw httpError(401, "Reconnectez-vous avec votre code.");
  const nouveau = String(req.body?.nouveau || "").trim();
  if (nouveau.length < MDP_MIN || nouveau.length > 100) throw httpError(400, `Le mot de passe doit avoir au moins ${MDP_MIN} caract\xE8res.`);
  const ref = db.doc(`codesEleves/${refId}`);
  if (!(await ref.get()).exists) throw httpError(404, "Acc\xE8s introuvable : demandez un nouveau code \xE0 votre enseignant.");
  await ref.set({ mdp: empreinte(nouveau), mdpLe: (/* @__PURE__ */ new Date()).toISOString() }, { merge: true });
  res.json({ enfants: [await enfantPour(refId, sec)] });
}));
app.get("/api/famille", route(async (req, res) => {
  const h = String(req.headers.authorization || "");
  const lu = h.startsWith("Famille ") ? lireJeton(h.slice(8).trim(), await secret()) : null;
  const refId = lu && !lu.startsWith("changer:") ? lu : null;
  if (!refId) throw httpError(401, "Connectez-vous avec votre identifiant.");
  const snap = await db.collection("publications").where("refIds", "array-contains", refId).get();
  const docs = plusRecentes(snap.docs.map((d) => d.data()));
  const nom = docs.map((d) => d.noms?.[refId]).find(Boolean) || null;
  const tableaux = docs.filter((d) => d.type === "tableau").map((d) => ({
    enseignant: d.enseignant,
    classe: d.classeNom,
    publieLe: d.publieLe,
    colonnes: (d.colonnes || []).map((c) => ({ cle: c.cle, app: c.app, titre: c.titre })),
    resultats: d.lignes?.[refId] || {}
  })).sort((a, b) => String(a.enseignant).localeCompare(String(b.enseignant), "fr"));
  const bulletins = docs.filter((d) => d.type === "bulletin").map((d) => ({
    enseignant: d.enseignant,
    classe: d.classeNom,
    trimestre: d.trimestre,
    publieLe: d.publieLe,
    colonnes: d.colonnes || [],
    externes: d.externes || [],
    notes: d.eleves?.[refId]?.notes || {},
    manuelles: d.eleves?.[refId]?.manuelles || [],
    moyenne: d.eleves?.[refId]?.moyenne ?? null,
    definitive: !!d.eleves?.[refId]?.definitive,
    externesNotes: d.eleves?.[refId]?.externes || {},
    appreciation: d.eleves?.[refId]?.appreciation || "",
    autoEval: d.eleves?.[refId]?.autoEval || ""
  })).sort((a, b) => String(b.trimestre).localeCompare(String(a.trimestre)) || String(a.enseignant).localeCompare(String(b.enseignant), "fr"));
  res.json({ eleve: nom, tableaux, bulletins });
}));
app.get("/api/admin/reglages", exigerEnseignant(), route(async (req, res) => {
  if (!ensDe(req).isAdmin) throw httpError(403, "R\xE9serv\xE9 \xE0 l'administrateur.");
  const snap = await db.collection("classes").get();
  res.json({ periodes: await periodes(), classes: snap.docs.map((d) => ({ cle: d.id, nom: String(d.get("nom") || d.id), pp: d.get("pp") || [] })) });
}));
app.post("/api/admin/pp", exigerEnseignant(), route(async (req, res) => {
  if (!ensDe(req).isAdmin) throw httpError(403, "R\xE9serv\xE9 \xE0 l'administrateur.");
  const nom = texteCourt(req.body?.classe, 40).trim();
  const cle = cleClasse(nom);
  if (!cle) throw httpError(400, "Classe incorrecte.");
  const emails = String(req.body?.emails ?? "").split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (emails.some((x) => !emailValide(x))) throw httpError(400, "Adresse e-mail incorrecte.");
  if (!emails.length) await db.doc(`classes/${cle}`).delete();
  else await db.doc(`classes/${cle}`).set({ nom, pp: emails.slice(0, 5) });
  res.json({ ok: true });
}));
app.post("/api/admin/trimestres", exigerEnseignant(), route(async (req, res) => {
  if (!ensDe(req).isAdmin) throw httpError(403, "R\xE9serv\xE9 \xE0 l'administrateur.");
  const p = {};
  for (const t of TRIMESTRES) {
    const x = req.body?.[t];
    if (!dateValide(x?.debut) || !dateValide(x?.fin) || x.debut > x.fin) throw httpError(400, `${t} : dates incorrectes.`);
    p[t] = { debut: x.debut, fin: x.fin };
  }
  await db.doc("reglages/trimestres").set(p);
  res.json({ ok: true });
}));
var seuilsConso = lireSeuils(process.env);
seuilsConso.tauxSource = process.env.EURO_PAR_DOLLAR ? "r\xE9gl\xE9 dans cPanel" : "par d\xE9faut";
async function actualiserTaux() {
  if (process.env.EURO_PAR_DOLLAR) return;
  const ref = db.doc("reglages/tauxChange");
  try {
    const t = (await ref.get()).data();
    if (t && Date.now() - Number(t.lu || 0) < 30 * 864e5 && t.euroParDollar > 0) {
      seuilsConso.euroParDollar = t.euroParDollar;
      seuilsConso.tauxSource = `BCE du ${t.jour}`;
      return;
    }
    const r = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", { signal: AbortSignal.timeout(15e3) });
    const taux = r.ok ? lireTauxBce(await r.text()) : null;
    if (!taux) throw new Error(`r\xE9ponse ${r.status} illisible`);
    seuilsConso.euroParDollar = taux.euroParDollar;
    seuilsConso.tauxSource = `BCE du ${taux.jour}`;
    cacheConso = null;
    cacheEns.clear();
    await ref.set({ ...taux, lu: Date.now() });
  } catch (e) {
    console.error("Taux de change BCE non lu :", e?.message || e);
  }
}
actualiserTaux();
setInterval(actualiserTaux, 864e5).unref();
var cacheConso = null;
var lectureConso = null;
var cleConso = (a) => parPorte(a) && cleDe(a) || varApp("SUIVI_CONSO", a);
async function lireCompteurs(a, chemin) {
  const essai = (ms) => fetch(urlDe(a) + chemin, { headers: { "X-Suivi-Cle": cleConso(a) }, signal: AbortSignal.timeout(ms) });
  try {
    return await essai(8e3);
  } catch {
    return await essai(3e4);
  }
}
async function lireConsommation() {
  const lignes = await Promise.all(APPLICATIONS.map(async (a) => {
    if (!cleConso(a)) return { id: a.id, nom: a.nom, etat: "absent", message: `pas encore reli\xE9s (variable SUIVI_CONSO_${a.id.toUpperCase()} dans Suivi)` };
    try {
      const r = await lireCompteurs(a, "/api/suivi/consommation");
      let d = null;
      try {
        d = await r.json();
      } catch {
      }
      if (r.ok && estRapport(d)) return { id: a.id, nom: a.nom, etat: "ok", rapport: d };
      if (r.status === 401) return { id: a.id, nom: a.nom, etat: "erreur", message: "cl\xE9 de liaison refus\xE9e" };
      if (r.ok || r.status === 404) return { id: a.id, nom: a.nom, etat: "absent" };
      return { id: a.id, nom: a.nom, etat: "erreur", message: `erreur ${r.status}` };
    } catch (e) {
      return { id: a.id, nom: a.nom, etat: "erreur", message: e?.name === "TimeoutError" ? "pas de r\xE9ponse en 40 secondes, m\xEAme apr\xE8s une seconde tentative (application arr\xEAt\xE9e ou bloqu\xE9e ?)" : "injoignable (application arr\xEAt\xE9e ?)" };
    }
  }));
  const s = synthese(lignes, seuilsConso);
  return { lu: Date.now(), seuils: seuilsConso, ...s, applications: lignes };
}
app.get("/api/admin/consommation", exigerEnseignant(), route(async (req, res) => {
  if (!ensDe(req).isAdmin) throw httpError(403, "R\xE9serv\xE9 \xE0 l'administrateur.");
  if (!cacheConso || Date.now() - cacheConso.at > 2e4) {
    lectureConso ||= lireConsommation().finally(() => {
      lectureConso = null;
    });
    cacheConso = { at: Date.now(), data: await lectureConso };
  }
  res.json(cacheConso.data);
}));
var cacheEns = /* @__PURE__ */ new Map();
var jourParis = (t = Date.now()) => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
async function lireConsoEnseignants(periode) {
  const n = PERIODES_ENS.find((p) => p.id === periode).jours;
  const depuis = jourMoins(jourParis(), n - 1);
  const sansDonnees = [];
  const parApp = (await Promise.all(APPLICATIONS.map(async (a) => {
    if (!cleConso(a)) return null;
    try {
      const r = await lireCompteurs(a, `/api/suivi/consommation?enseignants=${depuis}`);
      const d = r.ok ? await r.json().catch(() => null) : null;
      if (!d || !Array.isArray(d.parEnseignant)) {
        sansDonnees.push(a.nom);
        return null;
      }
      return { id: a.id, nom: a.nom, liste: d.parEnseignant, premier: Array.isArray(d.jours) && d.jours[0]?.jour };
    } catch {
      sansDonnees.push(a.nom);
      return null;
    }
  }))).filter((x) => !!x);
  const fiches = /* @__PURE__ */ new Map();
  for (const doc of (await db.collection("enseignants").get()).docs) {
    const f = doc.data() || {};
    const email = String(f.email || "").toLowerCase();
    if (!email) continue;
    const fiche2 = { cle: email, nom: String(f.nom || email) };
    fiches.set(email, fiche2);
    for (const [app2, v] of Object.entries(f.apps || {})) if (v?.email) fiches.set(`${app2}/${String(v.email).toLowerCase()}`, fiche2);
  }
  const enseignants = regrouperEnseignants(parApp, seuilsConso, (app2, cle) => fiches.get(`${app2}/${cle}`) || fiches.get(cle));
  const premiers = parApp.map((a) => a.premier).filter(Boolean).sort();
  return { lu: Date.now(), periode, depuis, historiqueDepuis: premiers[0] || null, seuils: seuilsConso, enseignants, applis: parApp.map((a) => a.nom), sansDonnees };
}
app.get("/api/admin/consommation/enseignants", exigerEnseignant(), route(async (req, res) => {
  if (!ensDe(req).isAdmin) throw httpError(403, "R\xE9serv\xE9 \xE0 l'administrateur.");
  const periode = estPeriodeEns(req.query.periode) ? req.query.periode : "30j";
  const c = cacheEns.get(periode);
  if (c && Date.now() - c.at < 6e4) return res.json(c.data);
  const data = await lireConsoEnseignants(periode);
  cacheEns.set(periode, { at: Date.now(), data });
  res.json(data);
}));
var limiteSequenceur = makeLimiter(30, 15 * 60 * 1e3);
function exigerSequenceur() {
  return (req, res, next) => {
    const cle = cleDe(appParId("sequenceur"));
    if (!cle) return res.status(404).json({ error: "Le S\xE9quenceur n'est pas encore reli\xE9 \xE0 Suivi." });
    const recue = import_crypto3.default.createHash("sha256").update(String(req.headers["x-suivi-cle"] || "")).digest();
    if (import_crypto3.default.timingSafeEqual(recue, import_crypto3.default.createHash("sha256").update(cle).digest())) return next();
    if (!limiteSequenceur(String(req.ip))) return res.status(429).json({ error: "Trop d'essais." });
    res.status(401).json({ error: "Cl\xE9 de liaison incorrecte." });
  };
}
async function enseignantsDuSequenceur(req) {
  const email = String(req.query.email || "").trim().toLowerCase();
  if (!emailValide(email)) throw httpError(400, "Adresse e-mail incorrecte.");
  const snap = await db.collection("enseignants").where("apps.sequenceur.email", "==", email).get();
  if (snap.empty) throw Object.assign(httpError(404, "Aucun compte Suivi n'a reli\xE9 le S\xE9quenceur avec votre adresse : ouvrez Suivi et reliez le S\xE9quenceur."), { code: "SUIVI_NON_RELIE" });
  return snap.docs.map((d) => {
    const f = d.data();
    const mail = String(f.email || "").toLowerCase();
    return { e: { uid: d.id, email: mail, nom: String(f.nom || mail.split("@")[0]), isAdmin: ADMIN_EMAILS.includes(mail) }, f };
  });
}
var applisPourSequenceur = (f) => APPLICATIONS.filter((a) => a.eleves && a.id !== "sequenceur" && parPorte(a) && estPrete(a) && f.apps?.[a.id]?.email);
app.get("/api/sequenceur/exercices", exigerSequenceur(), route(async (req, res) => {
  const comptes = await enseignantsDuSequenceur(req);
  const vus = /* @__PURE__ */ new Set();
  const applis = [];
  for (const { f } of comptes) {
    for (const a of applisPourSequenceur(f)) {
      if (vus.has(a.id)) continue;
      vus.add(a.id);
      try {
        const d = await donnees(a, f.apps[a.id].email);
        applis.push({ id: a.id, nom: a.nom, exercices: d.exercises.map((x) => ({ id: String(x.id), titre: String(x.title || x.id) })) });
      } catch (err) {
        applis.push({ id: a.id, nom: a.nom, exercices: [], erreur: String(err?.message || err) });
      }
    }
  }
  res.json({ applis });
}));
app.get("/api/sequenceur/notes", exigerSequenceur(), route(async (req, res) => {
  const a = appParId(req.query.appli);
  const exercice = String(req.query.exercice || "");
  const comptes = await enseignantsDuSequenceur(req);
  const compte = a && comptes.find((c) => applisPourSequenceur(c.f).some((x) => x.id === a.id));
  if (!a || !compte) throw httpError(404, `${a?.nom || "Cette application"} n'est pas reli\xE9e \xE0 votre compte Suivi.`);
  const d = await donnees(a, compte.f.apps[a.id].email, true);
  const exo = d.exercises.find((x) => String(x.id) === exercice);
  if (!exo) throw httpError(404, "Exercice introuvable.");
  const t = await calculerTableau(compte.e);
  const refDe = new Map(t.resultat.filter((r) => r.refId).map((r) => [`${r.app}:${r.studentId}`, r.refId]));
  const seqDe = /* @__PURE__ */ new Map();
  for (const r of t.resultat) if (r.app === "sequenceur" && r.refId) seqDe.set(r.refId, [...seqDe.get(r.refId) || [], r.studentId]);
  const eleveDe = new Map(d.students.map((s) => [s.id, s]));
  const classeDe = new Map(d.classes.map((c) => [c.id, c.name]));
  const notes = d.results.filter((r) => String(r.exerciseId) === exercice).flatMap((r) => {
    const n = noteDeResultat(r.score, r.percent);
    const s = eleveDe.get(r.studentId);
    if (!n || !s) return [];
    const refId = refDe.get(`${a.id}:${r.studentId}`);
    return [{
      eleve: s.name,
      classe: s.className || classeDe.get(s.classId) || "",
      note: n.note,
      sur: n.sur,
      date: r.completedAt ? new Date(r.completedAt).toISOString() : void 0,
      sequenceur: refId && seqDe.get(refId) || []
    }];
  });
  res.json({ exercice: { id: String(exo.id), titre: String(exo.title || exo.id) }, notes });
}));
app.get("/api/sequenceur/eleve", exigerSequenceur(), route(async (req, res) => {
  const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10);
  if (!ids.length) throw httpError(400, "\xC9l\xE8ve manquant.");
  const comptes = await enseignantsDuSequenceur(req);
  const per = await periodes();
  const trimestres = trimestresCommences(per);
  const bulletins = [];
  const codes = [];
  let eleve = null;
  let chemin = "";
  for (const { e } of comptes) {
    const t = await calculerTableau(e);
    const refId = t.resultat.find((r) => r.app === "sequenceur" && r.refId && ids.includes(r.studentId))?.refId;
    const ref = refId ? t.refs.find((r) => r.id === refId) : void 0;
    if (!ref) continue;
    eleve ||= { prenom: ref.prenom, nom: ref.nom, classe: ref.classe };
    if (!chemin) {
      const q = new URLSearchParams({ qui: "eleve", ens: e.uid, classe: cleClasse(ref.classe), classeNom: ref.classe, eleve: ref.id, nom: `${ref.prenom} ${ref.nom.trim().charAt(0).toUpperCase()}.`.trim() });
      chemin = `/famille?${q.toString()}`;
    }
    for (const c of codesDeLEleve(ref.id, t.resultat, t.lus.map((l) => ({ app: l.app, d: l.d })))) {
      if (!codes.some((x) => x.appli === c.appli && x.code === c.code)) codes.push(c);
    }
    const classe = cleClasse(ref.classe);
    const essais = t.essais.get(ref.id) || {};
    const docs = await db.getAll(...trimestres.flatMap((tr) => [
      db.doc(`bulletins/${idBulletin(e.uid, tr, classe)}`),
      db.doc(`publications/${e.uid}__bulletin__${tr}__${classe}`),
      db.doc(`publications/${e.uid}__bulletin__${tr}__${classe}__eleve__${ref.id}`)
    ]));
    trimestres.forEach((tr, i) => {
      const b = docs[3 * i].data();
      if (!b?.colonnes?.length) return;
      const pub = plusRecentes([docs[3 * i + 1].data(), docs[3 * i + 2].data()].filter(Boolean))[0];
      const colonnes = b.colonnes.map((c) => ({ cle: String(c.cle), app: String(c.app || ""), titre: String(c.titre || ""), coef: lireCoef(c.coef) }));
      const finale = b.eleves?.[ref.id]?.finale;
      bulletins.push({
        trimestre: tr,
        enseignant: String(b.nom || ""),
        periode: per[tr],
        colonnes: colonnes.map((c) => ({ ...c, note: noteColonne(essais[c.cle], per[tr]) })),
        moyenne: typeof finale === "number" ? finale : noteSur20(essais, colonnes, per[tr]),
        definitive: typeof finale === "number",
        appreciation: pub ? String(pub.eleves?.[ref.id]?.appreciation || "") : "",
        publieLe: pub ? String(pub.publieLe || "") : null
      });
    });
  }
  if (!eleve) throw Object.assign(httpError(404, "\xC9l\xE8ve pas encore rattach\xE9 dans Suivi."), { code: "ELEVE_INCONNU" });
  res.json({ eleve, bulletins, codes, chemin });
}));
async function startServer() {
  const webConfig = { apiKey: appletConfig.apiKey, authDomain: appletConfig.authDomain, projectId, appId: appletConfig.appId };
  if (process.env.USE_FIREBASE_EMULATORS === "1") webConfig.emulators = { authPort: 9099 };
  const configScript = `<script>window.__FIREBASE_CONFIG__=${JSON.stringify(webConfig).replace(/</g, "\\u003c")};</script>`;
  const isProduction = process.env.NODE_ENV === "production" || /server\.cjs$/.test(process.argv[1] || "");
  if (!isProduction) {
    const { createServer } = await import("vite");
    const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      try {
        const raw = import_fs.default.readFileSync(import_path.default.join(process.cwd(), "index.html"), "utf8");
        res.status(200).type("html").end(await vite.transformIndexHtml(req.originalUrl, raw.replace("<head>", `<head>${configScript}`)));
      } catch (e) {
        next(e);
      }
    });
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    const indexHtml = import_fs.default.readFileSync(import_path.default.join(distPath, "index.html"), "utf8").replace("<head>", `<head>${configScript}`);
    const sendIndex = (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.type("html").send(indexHtml);
    };
    app.get(["/", "/index.html"], sendIndex);
    app.use((req, res, next) => /^\/server\.cjs/.test(req.path) ? res.status(404).end() : next());
    app.use(import_express.default.static(distPath, { index: false }));
    app.get("*", sendIndex);
  }
  app.listen(PORT, "0.0.0.0", () => console.log(`Suivi : serveur sur le port ${PORT} (projet ${projectId}, base ${databaseId})`));
}
startServer();
//# sourceMappingURL=server.cjs.map
