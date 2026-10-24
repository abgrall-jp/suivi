import express, { type NextFunction, type Request, type Response } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { cleClasse, decider, lireListe, normaliser, type EleveRef } from "./lib/correspondance.ts";
import { APPLICATIONS, type Application } from "./lib/applications.ts";
import { empreinte, genererMotDePasse } from "./lib/parents.ts";
import { textesParEleve, type TextesStudio } from "./lib/studio.ts";
import { dateValide, estTrimestre, lireNote, moyenne, noteSur20, periodesParDefaut, TRIMESTRES, type Periodes, type Trimestre } from "./lib/bulletin.ts";

// ---------------------------------------------------------------------------
// Serveur de Suivi, le suivi global des applications Je peux apprendre (hébergement o2switch).
// Le navigateur ne lit ni n'écrit jamais la base : tout passe par ce serveur.
// Les résultats sont lus dans chaque application par sa « porte de liaison » (/api/suivi/*), avec une clé propre à l'application.
// Réglages (variables d'environnement, dans cPanel > Setup Node.js App)
//   FIREBASE_SERVICE_ACCOUNT  clé JSON d'un compte de service (sinon fichier service-account.json)
//   FIRESTORE_DATABASE_ID     base Firestore (sinon celle de firebase-applet-config.json : suivi-eu)
//   ADMIN_EMAILS              administrateurs, séparés par des virgules (alimatlea@gmail.com)
//   SUIVI_CLE_<APPLI>         clé de liaison d'une application, la même que SUIVI_CLE dans cette application
//                             (SUIVI_CLE_TEXTETROUS, SUIVI_CLE_MEMORISER…) ; sans clé, l'application est « bientôt »
//   SUIVI_URL_<APPLI>         adresse d'une application, si elle diffère de l'adresse prévue
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM  envoi des e-mails (codes de confirmation, mots de passe des parents)
//   STUDIO_FIRESTORE_DATABASE_ID  base du Studio d'Appréciations (même projet Google que Suivi)
//   ADRESSE_PUBLIQUE          adresse de Suivi dans les e-mails (sinon https://suivi.jepeuxapprendre.fr)
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3000;
const APP_VERSION = "2026-10-24.1";

function readJsonFile(fileName: string): any {
  try {
    const p = path.join(process.cwd(), fileName);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`Lecture impossible de ${fileName} :`, e);
  }
  return null;
}

const appletConfig = readJsonFile("firebase-applet-config.json") || {};
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? (() => { try { return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!); } catch { console.error("FIREBASE_SERVICE_ACCOUNT n'est pas un JSON valide"); return null; } })()
  : readJsonFile("service-account.json");
const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount?.project_id || appletConfig.projectId;
const databaseId = process.env.FIRESTORE_DATABASE_ID || appletConfig.firestoreDatabaseId || "(default)";
const adminApp = getApps()[0] || initializeApp({ projectId, ...(serviceAccount ? { credential: cert(serviceAccount) } : {}) });
const adminAuth = getAuth(adminApp);
const db = databaseId === "(default)" ? getFirestore(adminApp) : getFirestore(adminApp, databaseId);
db.settings({ ignoreUndefinedProperties: true });

// Le Studio d'Appréciations partage le projet Google de Suivi : ses appréciations sont lues directement dans sa base.
const studioDb = getFirestore(adminApp, process.env.STUDIO_FIRESTORE_DATABASE_ID || "ai-studio-f415485f-4d6c-4b39-a9de-42a310ca2292");

const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS ?? "alimatlea@gmail.com").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

// --- Applications du site ------------------------------------------------------------
const varApp = (prefixe: string, a: Application) => process.env[`${prefixe}_${a.id.toUpperCase()}`] || "";
const cleDe = (a: Application) => varApp("SUIVI_CLE", a);
const urlDe = (a: Application) => (varApp("SUIVI_URL", a) || a.url).replace(/\/+$/, "");
const appParId = (id: unknown) => APPLICATIONS.find(a => a.id === id);
const parPorte = (a: Application) => (a.lecture || "porte") === "porte";
const estPrete = (a: Application) => (parPorte(a) ? !!cleDe(a) : true);

/** Appel de la porte de liaison d'une application. */
async function porte(a: Application, chemin: string, body?: any): Promise<any> {
  const cle = cleDe(a);
  if (!cle) throw httpError(409, `${a.nom} n'est pas encore reliée à Suivi.`);
  let r: globalThis.Response;
  try {
    r = await fetch(urlDe(a) + chemin, {
      method: body ? "POST" : "GET",
      headers: { "X-Suivi-Cle": cle, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw httpError(502, `${a.nom} ne répond pas pour le moment.`);
  }
  let data: any = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) throw httpError(r.status === 404 ? 404 : 502, data?.error || `${a.nom} a refusé la demande (${r.status}).`);
  return data;
}

// --- Petits outils ---------------------------------------------------------------------
function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function route(fn: (req: Request, res: Response) => Promise<any>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e: any) {
      const status = Number(e?.status) || 500;
      if (status >= 500 && status !== 502) console.error(`${req.method} ${req.path}`, e);
      if (!res.headersSent) res.status(status).json({ error: status >= 500 && status !== 502 ? "Erreur du serveur. Réessayez." : e.message });
    }
  };
}

function makeLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    if (hits.size > 20000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    const h = hits.get(key);
    if (!h || h.reset < now) { hits.set(key, { count: 1, reset: now + windowMs }); return true; }
    return ++h.count <= max;
  };
}
const limiteCodes = makeLimiter(5, 60 * 60 * 1000);
const limiteEssais = makeLimiter(10, 15 * 60 * 1000);

const emailValide = (e: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(e);
const empreinteCode = (code: string) => crypto.createHash("sha256").update(code).digest("hex");

// --- Identité : enseignants connectés avec Google ou e-mail (adresse vérifiée) ----------
type Enseignant = { uid: string; email: string; nom: string; isAdmin: boolean };

function exigerEnseignant() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const h = req.headers.authorization || "";
    let t: DecodedIdToken | null = null;
    if (h.startsWith("Bearer ")) { try { t = await adminAuth.verifyIdToken(h.slice(7).trim()); } catch {} }
    if (!t?.email) return res.status(401).json({ error: "Connexion requise." });
    if (t.email_verified !== true) return res.status(403).json({ error: "Confirmez d'abord votre adresse avec le lien reçu par e-mail, puis reconnectez-vous." });
    const email = t.email.toLowerCase();
    (req as any).ens = { uid: t.uid, email, nom: String(t.name || email.split("@")[0]), isAdmin: ADMIN_EMAILS.includes(email) } as Enseignant;
    next();
  };
}
const ensDe = (req: Request) => (req as any).ens as Enseignant;

async function fiche(e: Enseignant): Promise<any> {
  const ref = db.doc(`enseignants/${e.uid}`);
  const snap = await ref.get();
  if (snap.exists) return snap.data();
  const data = { uid: e.uid, email: e.email, nom: e.nom, apps: {}, creeLe: new Date().toISOString() };
  await ref.set(data);
  return data;
}

// --- Envoi des e-mails ---------------------------------------------------------------------
// MAIL_FICHIER (essais seulement) : les e-mails sont écrits dans ce fichier au lieu d'être envoyés.
const mailer = process.env.MAIL_FICHIER
  ? nodemailer.createTransport({ jsonTransport: true })
  : process.env.SMTP_HOST
  ? nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 465, secure: (Number(process.env.SMTP_PORT) || 465) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  })
  : null;

async function envoyerMail(a: string, sujet: string, texte: string) {
  if (!mailer) throw httpError(503, "L'envoi d'e-mails n'est pas encore réglé sur le serveur.");
  const info: any = await mailer.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER || "suivi@jepeuxapprendre.fr", to: a, subject: sujet, text: texte });
  if (process.env.MAIL_FICHIER) fs.appendFileSync(process.env.MAIL_FICHIER, String(info.message) + "\n");
}

// --- Données lues dans les applications (gardées 20 secondes) ------------------------------
type Donnees = {
  classes: { id: string; name: string }[];
  students: { id: string; name: string; classId: string; className: string; provisionalPassword?: boolean; parentPasswords?: number[] }[];
  exercises: { id: string; title: string }[];
  results: { id: string; studentId: string; exerciseId: string; exerciseTitle: string; percent: number; score: string; completedAt: number | null }[];
};
const cacheDonnees = new Map<string, { at: number; data: Donnees }>();
async function donnees(a: Application, email: string): Promise<Donnees> {
  const cle = `${a.id}:${email}`;
  const hit = cacheDonnees.get(cle);
  if (hit && Date.now() - hit.at < 20000) return hit.data;
  const d = await porte(a, `/api/suivi/donnees?email=${encodeURIComponent(email)}`);
  const data: Donnees = {
    classes: Array.isArray(d.classes) ? d.classes : [],
    students: Array.isArray(d.students) ? d.students : [],
    exercises: Array.isArray(d.exercises) ? d.exercises : [],
    results: Array.isArray(d.results) ? d.results : [],
  };
  cacheDonnees.set(cle, { at: Date.now(), data });
  return data;
}

// --- Liste de référence des élèves et correspondances -----------------------------------
let cacheRefs: { at: number; refs: EleveRef[] } | null = null;
async function elevesReference(): Promise<EleveRef[]> {
  if (cacheRefs && Date.now() - cacheRefs.at < 60000) return cacheRefs.refs;
  const snap = await db.collection("eleves").get();
  const refs = snap.docs.map(d => ({ id: d.id, classe: String(d.get("classe") || ""), nom: String(d.get("nom") || ""), prenom: String(d.get("prenom") || "") }));
  cacheRefs = { at: Date.now(), refs };
  return refs;
}

const cleCorr = (app: string, studentId: string) => `${app}__${studentId}`.slice(0, 400);

/** Pour chaque élève des applications : l'élève de référence retenu (choix de l'enseignant, sinon rapprochement sûr). */
async function rapprocher(lignes: { app: Application; d: Donnees }[]) {
  let refs = await elevesReference();
  const provisoire = refs.length === 0;
  const choix = new Map<string, string | null>();
  const cles = lignes.flatMap(l => l.d.students.map(s => cleCorr(l.app.id, s.id)));
  for (let i = 0; i < cles.length; i += 300) {
    const snaps = cles.length ? await db.getAll(...cles.slice(i, i + 300).map(c => db.doc(`correspondances/${c}`))) : [];
    for (const s of snaps) if (s.exists) choix.set(s.id, (s.get("refId") as string | null) ?? null);
  }
  // Sans liste de l'établissement : la liste se construit à partir des applications, dans l'ordre où elles sont reliées.
  if (provisoire) refs = [];
  const idsRefs = new Set(refs.map(r => r.id));
  const resultat: { app: string; studentId: string; nom: string; classe: string; statut: "confirme" | "auto" | "a_verifier" | "aucun" | "ignore"; refId: string | null; candidats: string[] }[] = [];
  for (const { app, d } of lignes) {
    const classeDe = new Map(d.classes.map(c => [c.id, c.name]));
    for (const s of d.students) {
      const classe = s.className || classeDe.get(s.classId) || "";
      const c = cleCorr(app.id, s.id);
      // Un choix vers un élève de la liste provisoire ne vaut plus une fois la liste de l'établissement importée.
      if (choix.has(c) && (provisoire || choix.get(c) === null || idsRefs.has(choix.get(c) as string))) {
        const refId = choix.get(c) ?? null;
        resultat.push({ app: app.id, studentId: s.id, nom: s.name, classe, statut: refId ? "confirme" : "ignore", refId, candidats: [] });
        continue;
      }
      const dec = decider(s.name, classe, refs);
      if (dec.statut === "auto") resultat.push({ app: app.id, studentId: s.id, nom: s.name, classe, statut: "auto", refId: dec.refId, candidats: [] });
      else if (provisoire && dec.statut === "aucun") {
        const morceaux = s.name.trim().split(/\s+/);
        // Même classe écrite autrement (« 5e B », « 5ème B ») : on garde l'écriture déjà vue.
        const classeVue = refs.find(r => cleClasse(r.classe) === cleClasse(classe))?.classe || classe;
        const ref = { id: `app_${cleClasse(classe)}_${normaliser(s.name).replace(/ /g, "-")}`, classe: classeVue, nom: morceaux.slice(1).join(" ") || morceaux[0], prenom: morceaux.length > 1 ? morceaux[0] : "" };
        refs.push(ref);
        resultat.push({ app: app.id, studentId: s.id, nom: s.name, classe, statut: "auto", refId: ref.id, candidats: [] });
      } else resultat.push({ app: app.id, studentId: s.id, nom: s.name, classe, statut: dec.statut, refId: null, candidats: dec.statut === "a_verifier" ? dec.candidats : [] });
    }
  }
  return { refs, provisoire, resultat };
}

// ---------------------------------------------------------------------------
const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", route(async (req, res) => {
  const out: any = { status: "ok", version: APP_VERSION };
  if (req.query.db !== undefined) {
    out.projet = projectId; out.base = databaseId;
    try { await db.collection("eleves").limit(1).get(); out.acces = "ok"; } catch (e: any) { out.acces = String(e?.message || e).slice(0, 200); }
    out.applications = APPLICATIONS.filter(a => a.eleves).map(a => ({ id: a.id, reliee: estPrete(a) }));
    out.mails = !!mailer;
  }
  res.json(out);
}));

// Profil de l'enseignant connecté et catalogue des applications.
app.get("/api/moi", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const f = await fiche(e);
  res.json({
    email: e.email, nom: f.nom || e.nom, isAdmin: e.isAdmin, choisies: Array.isArray(f.choisies) ? f.choisies : null, apps: f.apps || {},
    catalogue: APPLICATIONS.map(a => ({ id: a.id, code: a.code, nom: a.nom, url: urlDe(a), eleves: a.eleves, prete: estPrete(a) })),
    mails: !!mailer,
  });
}));

// Applications cochées par l'enseignant (première ouverture, puis « Mes applications »).
app.post("/api/choix", exigerEnseignant(), route(async (req, res) => {
  const ids = Array.isArray(req.body?.applications) ? req.body.applications.filter((id: unknown) => !!appParId(id)) : [];
  await fiche(ensDe(req));
  await db.doc(`enseignants/${ensDe(req).uid}`).set({ choisies: Array.from(new Set(ids)) }, { merge: true });
  res.json({ ok: true });
}));

// Code de confirmation pour relier une application avec une autre adresse que celle de connexion.
app.post("/api/apps/code", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const a = appParId(req.body?.app);
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!a) throw httpError(400, "Application inconnue.");
  if (!emailValide(email)) throw httpError(400, "Adresse e-mail incorrecte.");
  if (!limiteCodes(e.uid)) throw httpError(429, "Trop de codes demandés. Réessayez dans une heure.");
  const code = String(crypto.randomInt(100000, 1000000));
  await envoyerMail(email, "Code de confirmation Suivi",
    `Bonjour,\n\n${e.email} veut relier ${a.nom} à Suivi avec cette adresse.\nCode de confirmation : ${code}\nIl est valable 15 minutes.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`);
  await db.doc(`codes/${e.uid}_${a.id}`).set({ email, empreinte: empreinteCode(code), expire: Date.now() + 15 * 60 * 1000 });
  res.json({ ok: true });
}));

// Relier une application : l'adresse de connexion (déjà vérifiée par Google ou par e-mail), ou une autre adresse confirmée par code.
app.post("/api/apps/relier", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const a = appParId(req.body?.app);
  if (!a || !a.eleves) throw httpError(400, "Application inconnue.");
  const email = String(req.body?.email || e.email).trim().toLowerCase();
  if (email !== e.email) {
    if (!limiteEssais(`code:${e.uid}`)) throw httpError(429, "Trop d'essais. Réessayez dans 15 minutes.");
    const ref = db.doc(`codes/${e.uid}_${a.id}`);
    const c = (await ref.get()).data();
    const code = String(req.body?.code || "").trim();
    if (!c || c.email !== email || c.expire < Date.now() || !code || c.empreinte !== empreinteCode(code)) throw httpError(403, "Code incorrect ou expiré.");
    await ref.delete();
  }
  // Studio d'Appréciations : même compte que Suivi, rien à vérifier ailleurs.
  const r = parPorte(a) ? await porte(a, `/api/suivi/enseignant?email=${encodeURIComponent(email)}`) : { teacher: { name: e.nom } };
  if (!r.teacher) throw httpError(404, `Aucun compte enseignant avec l'adresse ${email} dans ${a.nom}.`);
  await fiche(e);
  await db.doc(`enseignants/${e.uid}`).set({
    apps: { [a.id]: { email, nomDansAppli: String(r.teacher.name || ""), relieeLe: new Date().toISOString() } },
    choisies: FieldValue.arrayUnion(a.id),
  }, { merge: true });
  // Les parents qui ont déjà un mot de passe le gardent dans cette application aussi.
  if (parPorte(a)) db.collection("parents").get().then(snap => {
    const cibles = new Map<string, Record<number, string | null>>();
    for (const d of snap.docs) cibles.set(String(d.get("refId")), { ...(cibles.get(String(d.get("refId"))) || {}), [Number(d.get("n"))]: String(d.get("empreinte")) });
    return pousserEmpreintes(cibles, { uid: e.uid, app: a.id });
  }).then(r => { if (r.erreurs.length) console.error("Mots de passe des parents :", r.erreurs); }).catch(err => console.error("Mots de passe des parents :", err));
  res.json({ ok: true, nom: String(r.teacher.name || "") });
}));

app.post("/api/apps/retirer", exigerEnseignant(), route(async (req, res) => {
  const a = appParId(req.body?.app);
  if (!a) throw httpError(400, "Application inconnue.");
  await db.doc(`enseignants/${ensDe(req).uid}`).set({ apps: { [a.id]: FieldValue.delete() } }, { merge: true });
  res.json({ ok: true });
}));

/** Applications reliées et cochées, avec leurs données (une application qui ne répond pas n'empêche pas les autres). */
async function lireApplications(e: Enseignant) {
  const f = await fiche(e);
  const choisies: string[] | null = Array.isArray(f.choisies) ? f.choisies : null;
  const reliees = APPLICATIONS.filter(a => a.eleves && parPorte(a) && f.apps?.[a.id]?.email && (!choisies || choisies.includes(a.id)));
  const lus = await Promise.all(reliees.map(async a => {
    try { return { app: a, d: await donnees(a, f.apps[a.id].email), erreur: null as string | null }; } catch (err: any) { return { app: a, d: null, erreur: String(err?.message || err) }; }
  }));
  return lus;
}

type Resultat = { percent: number; score: string; at: number | null };

/** Résultats de l'enseignant rangés par élève de référence (le plus récent essai pour chaque exercice). */
async function calculerTableau(e: Enseignant) {
  const lus = await lireApplications(e);
  const ok = lus.filter((l): l is { app: Application; d: Donnees; erreur: null } => !!l.d);
  const { refs, provisoire, resultat } = await rapprocher(ok);
  const refDe = new Map(resultat.filter(r => r.refId).map(r => [`${r.app}:${r.studentId}`, r.refId as string]));
  // Tous les essais, pour le bulletin (filtrés par trimestre) ; le plus récent, pour le tableau.
  const essais = new Map<string, Record<string, Resultat[]>>();
  for (const { app: a, d } of ok) {
    for (const r of d.results) {
      const refId = refDe.get(`${a.id}:${r.studentId}`);
      if (!refId) continue;
      const parExo = essais.get(refId) || {};
      (parExo[`${a.id}:${r.exerciseId}`] ||= []).push({ percent: Number(r.percent) || 0, score: String(r.score || ""), at: r.completedAt ?? null });
      essais.set(refId, parExo);
    }
  }
  const plusRecent = (liste: Resultat[]) => liste.reduce((m, x) => ((x.at || 0) >= (m.at || 0) ? x : m));
  const presents = new Set(resultat.map(r => r.refId).filter(Boolean) as string[]);
  return {
    provisoire, refs, presents, essais, plusRecent,
    applications: lus.map(l => ({
      id: l.app.id, code: l.app.code, nom: l.app.nom, erreur: l.erreur,
      exercices: (l.d?.exercises || []).filter(x => l.d!.results.some(r => r.exerciseId === x.id)).map(x => ({ id: x.id, titre: x.title })),
    })),
    aVerifier: resultat.filter(r => r.statut === "a_verifier" || r.statut === "aucun").length,
  };
}

const parNom = (a: EleveRef, b: EleveRef) => a.classe.localeCompare(b.classe, "fr") || a.nom.localeCompare(b.nom, "fr") || a.prenom.localeCompare(b.prenom, "fr");

// Tableau en direct : une ligne par élève, un bloc par application.
app.get("/api/tableau", exigerEnseignant(), route(async (req, res) => {
  const t = await calculerTableau(ensDe(req));
  res.json({
    provisoire: t.provisoire,
    applications: t.applications,
    eleves: t.refs.filter(r => t.presents.has(r.id)).sort(parNom).map(r => ({
      id: r.id, classe: r.classe, nom: r.nom, prenom: r.prenom,
      resultats: Object.fromEntries(Object.entries(t.essais.get(r.id) || {}).map(([k, v]) => [k, t.plusRecent(v)])),
    })),
    aVerifier: t.aVerifier,
    lu: Date.now(),
  });
}));

// --- Bulletin, par trimestre et par classe ---------------------------------------------------
// bulletins/{uid}__{trimestre}__{classe} : colonnes retenues, notes externes, et pour chaque élève la note définitive
// (figée : plus mise à jour par le logiciel), les notes externes et l'appréciation de l'enseignant.
// Le prof principal d'une classe (classes/{classe}.pp) lit les bulletins de ses collègues sans pouvoir les modifier.

async function periodes(): Promise<Periodes> {
  const p = periodesParDefaut();
  const reglage = (await db.doc("reglages/trimestres").get()).data() || {};
  for (const t of TRIMESTRES) if (dateValide(reglage[t]?.debut) && dateValide(reglage[t]?.fin)) p[t] = { debut: reglage[t].debut, fin: reglage[t].fin };
  return p;
}

const idBulletin = (uid: string, t: Trimestre, classe: string) => `${uid}__${t}__${classe}`;
const texteCourt = (v: unknown, max: number) => String(v ?? "").slice(0, max);

function lireTrimestreClasse(src: any) {
  const trimestre = src?.trimestre;
  const classe = cleClasse(String(src?.classe || ""));
  if (!estTrimestre(trimestre)) throw httpError(400, "Trimestre incorrect.");
  if (!classe || classe.length > 40) throw httpError(400, "Classe incorrecte.");
  return { trimestre, classe };
}

/** Élèves d'une classe : toute la liste de l'établissement, ou (liste provisoire) ceux qui ont un compte dans les applications. */
const elevesDeClasse = (t: Awaited<ReturnType<typeof calculerTableau>>, classe: string) =>
  t.refs.filter(r => cleClasse(r.classe) === classe && (!t.provisoire || t.presents.has(r.id))).sort(parNom);

app.get("/api/bulletin", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const per = await periodes();
  const t = await calculerTableau(e);
  const classes = Array.from(new Map(t.refs.filter(r => t.presents.has(r.id)).map(r => [cleClasse(r.classe), r.classe])).entries())
    .map(([cle, nom]) => ({ cle, nom })).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const colonnesDispo = t.applications.flatMap(a => a.exercices.map(x => ({ cle: `${a.id}:${x.id}`, app: a.nom, titre: x.titre })));
  if (!req.query.trimestre || !req.query.classe) return res.json({ periodes: per, classes, colonnesDispo });
  const { trimestre, classe } = lireTrimestreClasse(req.query);
  const ref = db.doc(`bulletins/${idBulletin(e.uid, trimestre, classe)}`);
  const b = (await ref.get()).data() || {};
  const colonnes: { cle: string; app: string; titre: string }[] = Array.isArray(b.colonnes) ? b.colonnes : [];
  const externes: { id: string; titre: string }[] = Array.isArray(b.externes) ? b.externes : [];
  const notes: Record<string, any> = b.eleves || {};
  const refsClasse = elevesDeClasse(t, classe);
  const f = await fiche(e);
  let studio = new Map<string, TextesStudio>();
  if (f.apps?.appreciations) {
    try {
      const snap = await studioDb.collection("appreciations").where("teacherId", "==", e.uid).get();
      studio = textesParEleve(snap.docs.map(d => d.data()), trimestre, refsClasse);
    } catch (err) { console.error("Lecture du Studio d'Appréciations :", err); }
  }
  const eleves = refsClasse.map(r => {
    const n = notes[r.id] || {};
    const calculee = colonnes.length ? noteSur20(t.essais.get(r.id) || {}, colonnes.map(c => c.cle), per[trimestre]) : null;
    return {
      id: r.id, nom: r.nom, prenom: r.prenom, calculee,
      finale: typeof n.finale === "number" ? n.finale : null, figeeLe: n.figeeLe || null,
      externes: n.externes || {}, appreciation: n.appreciation || "",
      studio: { eleve: studio.get(r.id)?.eleve?.texte || "", prof: studio.get(r.id)?.prof?.texte || "" },
    };
  });
  // Copie des notes calculées, pour que le prof principal les voie sans accès aux applications de ce collègue.
  const copie = Object.fromEntries(eleves.map(x => [x.id, x.calculee]));
  const noms = Object.fromEntries(eleves.map(x => [x.id, `${x.nom} ${x.prenom}`.trim()]));
  // L'appréciation que l'élève a écrite lui-même, montrée aussi au prof principal.
  const autoEval = Object.fromEntries(eleves.filter(x => x.studio.eleve).map(x => [x.id, x.studio.eleve]));
  if (b.classeNom && JSON.stringify([b.calculees || {}, b.noms || {}, b.autoEval || {}]) !== JSON.stringify([copie, noms, autoEval])) {
    await ref.set({ calculees: copie, noms, autoEval, calculeesLe: new Date().toISOString() }, { merge: true });
  }
  res.json({
    periodes: per, classes, colonnesDispo, trimestre, classe,
    colonnes, externes, eleves,
  });
}));

app.post("/api/bulletin/colonnes", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const { trimestre, classe } = lireTrimestreClasse(req.body);
  const colonnes = (Array.isArray(req.body?.colonnes) ? req.body.colonnes : []).slice(0, 100)
    .map((c: any) => ({ cle: texteCourt(c?.cle, 300), app: texteCourt(c?.app, 80), titre: texteCourt(c?.titre, 200) })).filter((c: any) => c.cle);
  const externes = (Array.isArray(req.body?.externes) ? req.body.externes : []).slice(0, 20)
    .map((c: any) => ({ id: texteCourt(c?.id, 40).replace(/[^a-z0-9_-]/gi, ""), titre: texteCourt(c?.titre, 80).trim() })).filter((c: any) => c.id && c.titre);
  const t = await calculerTableau(e);
  const classeNom = t.refs.find(r => cleClasse(r.classe) === classe)?.classe || classe;
  // Nom montré au prof principal : celui du compte Google, sinon celui de l'enseignant dans ses applications.
  const f = await fiche(e);
  const nomAppli = Object.values<any>(f.apps || {}).map(a => a?.nomDansAppli).find(Boolean);
  await db.doc(`bulletins/${idBulletin(e.uid, trimestre, classe)}`).set({
    uid: e.uid, email: e.email, nom: (e.nom.includes("@") || e.nom === e.email.split("@")[0]) && nomAppli ? nomAppli : e.nom, trimestre, classe, classeNom, colonnes, externes, majLe: new Date().toISOString(),
  }, { merge: true });
  res.json({ ok: true });
}));

// Une ligne d'élève : note définitive (null = revenir à la note calculée), notes externes, appréciation.
app.post("/api/bulletin/eleve", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const { trimestre, classe } = lireTrimestreClasse(req.body);
  const refId = texteCourt(req.body?.refId, 200);
  const t = await calculerTableau(e);
  if (!elevesDeClasse(t, classe).some(r => r.id === refId)) throw httpError(404, "Cet élève n'est pas dans cette classe.");
  const ref = db.doc(`bulletins/${idBulletin(e.uid, trimestre, classe)}`);
  const b = (await ref.get()).data();
  if (!b) throw httpError(409, "Choisissez d'abord les notes à reprendre.");
  const maj: any = {};
  if ("finale" in (req.body || {})) {
    const n = lireNote(req.body.finale);
    if (n === undefined) throw httpError(400, "La note doit être entre 0 et 20.");
    maj.finale = n; maj.figeeLe = n === null ? null : new Date().toISOString();
  }
  if (req.body?.externes && typeof req.body.externes === "object") {
    maj.externes = {};
    for (const x of b.externes || []) {
      if (!(x.id in req.body.externes)) continue;
      const n = lireNote(req.body.externes[x.id]);
      if (n === undefined) throw httpError(400, `${x.titre} : la note doit être entre 0 et 20.`);
      maj.externes[x.id] = n;
    }
  }
  if ("appreciation" in (req.body || {})) maj.appreciation = texteCourt(req.body.appreciation, 2000);
  await ref.set({ eleves: { [refId]: maj }, majLe: new Date().toISOString() }, { merge: true });
  res.json({ ok: true });
}));

// Figer : la note calculée de chaque élève devient sa note définitive (celles déjà posées ne changent pas).
app.post("/api/bulletin/figer", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const { trimestre, classe } = lireTrimestreClasse(req.body);
  const ref = db.doc(`bulletins/${idBulletin(e.uid, trimestre, classe)}`);
  const b = (await ref.get()).data();
  if (!b?.colonnes?.length) throw httpError(409, "Choisissez d'abord les notes à reprendre.");
  const per = await periodes();
  const t = await calculerTableau(e);
  const maj: Record<string, any> = {};
  const le = new Date().toISOString();
  for (const r of elevesDeClasse(t, classe)) {
    if (typeof b.eleves?.[r.id]?.finale === "number") continue;
    const n = noteSur20(t.essais.get(r.id) || {}, b.colonnes.map((c: any) => c.cle), per[trimestre]);
    if (n !== null) maj[r.id] = { finale: n, figeeLe: le };
  }
  await ref.set({ eleves: maj, majLe: le }, { merge: true });
  res.json({ ok: true, figees: Object.keys(maj).length });
}));

// --- Prof principal ---------------------------------------------------------------------------
app.get("/api/pp", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const snap = await db.collection("classes").where("pp", "array-contains", e.email).get();
  const classes = snap.docs.map(d => ({ cle: d.id, nom: String(d.get("nom") || d.id) })).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  // Classes dont il envoie les mots de passe des parents : les siennes, ou toutes pour l'administrateur.
  const gerees = e.isAdmin
    ? Array.from(new Map((await elevesReference()).map(r => [cleClasse(r.classe), r.classe])).entries()).map(([cle, nom]) => ({ cle, nom })).sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
    : classes;
  res.json({ classes, gerees, periodes: await periodes() });
}));

app.get("/api/pp/bulletin", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const { trimestre, classe } = lireTrimestreClasse(req.query);
  const c = (await db.doc(`classes/${classe}`).get()).data();
  if (!c || !Array.isArray(c.pp) || !c.pp.includes(e.email)) throw httpError(403, "Vous n'êtes pas professeur principal de cette classe.");
  const snap = await db.collection("bulletins").where("classe", "==", classe).where("trimestre", "==", trimestre).get();
  const refs = (await elevesReference()).filter(r => cleClasse(r.classe) === classe).sort(parNom);
  const matieres = snap.docs.map(d => d.data()).sort((a, b) => String(a.nom).localeCompare(String(b.nom), "fr")).map(b => ({
    enseignant: String(b.nom || b.email), email: String(b.email || ""),
    externes: Array.isArray(b.externes) ? b.externes : [],
    notes: Object.fromEntries(Object.entries<any>({ ...(b.calculees || {}), ...(b.eleves || {}) }).map(([id]) => {
      const n = b.eleves?.[id] || {};
      return [id, { note: typeof n.finale === "number" ? n.finale : (b.calculees?.[id] ?? null), definitive: typeof n.finale === "number", externes: n.externes || {}, appreciation: n.appreciation || "" }];
    })),
  }));
  // Élèves : la liste de l'établissement ; à défaut, ceux qui ont une note.
  const nomDe = new Map<string, string>(snap.docs.flatMap(d => Object.entries<string>(d.get("noms") || {})));
  const ids = refs.length ? refs.map(r => ({ id: r.id, nom: r.nom, prenom: r.prenom }))
    : Array.from(new Set(matieres.flatMap(m => Object.keys(m.notes)))).map(id => ({ id, nom: nomDe.get(id) || id, prenom: "" }))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const autoEval = new Map<string, string>(snap.docs.flatMap(d => Object.entries<string>(d.get("autoEval") || {})));
  res.json({
    classe, nom: c.nom || classe, trimestre, matieres,
    eleves: ids.map(x => ({ ...x, moyenne: moyenne(matieres.map(m => m.notes[x.id]?.note)), autoEval: autoEval.get(x.id) || "" })),
  });
}));

// Correspondances : les élèves des applications et l'élève de référence retenu.
app.get("/api/correspondances", exigerEnseignant(), route(async (req, res) => {
  const lus = await lireApplications(ensDe(req));
  const ok = lus.filter((l): l is { app: Application; d: Donnees; erreur: null } => !!l.d);
  const { refs, provisoire, resultat } = await rapprocher(ok);
  res.json({
    provisoire,
    references: refs.map(r => ({ id: r.id, classe: r.classe, nom: r.nom, prenom: r.prenom })),
    eleves: resultat.map(r => ({ ...r, appNom: appParId(r.app)?.nom || r.app })),
  });
}));

app.post("/api/correspondances", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const a = appParId(req.body?.app);
  const studentId = String(req.body?.studentId || "");
  const refId = req.body?.refId === null ? null : String(req.body?.refId || "");
  if (!a || !studentId || studentId.length > 200) throw httpError(400, "Élève incorrect.");
  const f = await fiche(e);
  if (!f.apps?.[a.id]?.email) throw httpError(403, "Reliez d'abord cette application.");
  const d = await donnees(a, f.apps[a.id].email);
  if (!d.students.some(s => s.id === studentId)) throw httpError(404, "Cet élève n'est pas dans vos classes.");
  if (refId !== null) {
    const refs = await elevesReference();
    if (refs.length && !refs.some(r => r.id === refId)) throw httpError(400, "Élève de référence inconnu.");
  }
  await db.doc(`correspondances/${cleCorr(a.id, studentId)}`).set({ refId, par: e.email, le: new Date().toISOString() });
  res.json({ ok: true });
}));

// Liste des élèves de l'établissement (administrateur) : Classe ; Nom ; Prénom, collée depuis un tableur.
app.get("/api/admin/eleves", exigerEnseignant(), route(async (req, res) => {
  if (!ensDe(req).isAdmin) throw httpError(403, "Réservé à l'administrateur.");
  res.json({ eleves: await elevesReference() });
}));

app.post("/api/admin/eleves", exigerEnseignant(), route(async (req, res) => {
  if (!ensDe(req).isAdmin) throw httpError(403, "Réservé à l'administrateur.");
  const { eleves, erreurs } = lireListe(String(req.body?.texte || "").slice(0, 1_000_000));
  if (erreurs.length) return res.status(400).json({ error: erreurs.slice(0, 10).join("\n") });
  if (!eleves.length) throw httpError(400, "Aucun élève dans la liste.");
  const avant = await db.collection("eleves").get();
  const garder = new Set(eleves.map(x => x.id));
  const w = db.bulkWriter();
  for (const d of avant.docs) if (!garder.has(d.id)) w.delete(d.ref);
  for (const x of eleves) w.set(db.doc(`eleves/${x.id}`), { classe: x.classe, nom: x.nom, prenom: x.prenom, email1: x.email1, email2: x.email2 });
  await w.close();
  cacheRefs = null;
  res.json({ ok: true, nombre: eleves.length, retires: avant.docs.filter(d => !garder.has(d.id)).length });
}));

// --- Parents : un mot de passe par parent, le même dans toutes les applications ---------------
// parents/{élève}__{1|2} : adresse, empreinte (jamais le mot de passe), date d'envoi.
// Les adresses viennent de la liste de l'établissement (4e et 5e colonnes).
const ADRESSE = (process.env.ADRESSE_PUBLIQUE || "https://suivi.jepeuxapprendre.fr").replace(/\/+$/, "");
const limiteOubliIp = makeLimiter(10, 60 * 60 * 1000);
const limiteOubliEmail = makeLimiter(3, 60 * 60 * 1000);

/**
 * Envoie les empreintes aux applications de tous les enseignants qui ont ces élèves.
 * cibles : élève de référence → { 1: empreinte, 2: empreinte } (null efface). seulement : une seule application d'un enseignant.
 */
async function pousserEmpreintes(cibles: Map<string, Record<number, string | null>>, seulement?: { uid: string; app: string }) {
  const parEleve = new Map<string, Set<string>>();
  const erreurs: string[] = [];
  if (!cibles.size) return { parEleve, erreurs };
  const ens = seulement ? [await db.doc(`enseignants/${seulement.uid}`).get()] : (await db.collection("enseignants").get()).docs;
  for (const doc of ens) {
    const f = doc.data() || {};
    for (const a of APPLICATIONS) {
      const email = f.apps?.[a.id]?.email;
      if (!a.eleves || !parPorte(a) || !email || !cleDe(a) || (seulement && seulement.app !== a.id)) continue;
      try {
        const d = await donnees(a, email);
        const { provisoire, resultat } = await rapprocher([{ app: a, d }]);
        if (provisoire) continue;
        for (const r of resultat) {
          const voulu = r.refId ? cibles.get(r.refId) : undefined;
          if (!voulu) continue;
          for (const [n, emp] of Object.entries(voulu)) await porte(a, "/api/suivi/mot-de-passe-parent", { email, studentId: r.studentId, parent: Number(n), empreinte: emp });
          (parEleve.get(r.refId!) || parEleve.set(r.refId!, new Set()).get(r.refId!))!.add(a.nom);
        }
      } catch (err: any) {
        erreurs.push(`${a.nom} (${email}) : ${String(err?.message || err)}`);
      }
    }
  }
  return { parEleve, erreurs };
}

const texteMail = (prenomEnfant: string, nomEnfant: string, mdp: string, apps: string[]) =>
  `Bonjour,\n\nVoici votre mot de passe de parent pour suivre ${prenomEnfant} ${nomEnfant} dans les applications Je peux apprendre :\n\n    ${mdp}\n\n` +
  `Il est personnel : l'autre parent reçoit le sien.\n` +
  (apps.length ? `Il sert dans : ${apps.join(", ")}.\n` : "") +
  `Dans chaque application, choisissez « Parent », puis votre enfant, et écrivez ce mot de passe.\n\n` +
  `Mot de passe perdu ? Demandez-en un nouveau ici : ${ADRESSE}/parents\n\nBonne journée.`;

/** Nouveau mot de passe pour ces parents : empreinte envoyée aux applications, puis e-mail. */
async function nouveauxMotsDePasse(liste: { ref: EleveRef; n: 1 | 2; email: string }[]) {
  const mdp = new Map<string, string>();
  const cibles = new Map<string, Record<number, string | null>>();
  for (const x of liste) {
    const m = genererMotDePasse();
    const emp = empreinte(m);
    mdp.set(`${x.ref.id}__${x.n}`, m);
    cibles.set(x.ref.id, { ...(cibles.get(x.ref.id) || {}), [x.n]: emp });
  }
  const { parEleve, erreurs } = await pousserEmpreintes(cibles);
  let envoyes = 0;
  for (const x of liste) {
    const cle = `${x.ref.id}__${x.n}`;
    await envoyerMail(x.email, `Mot de passe parent : ${x.ref.prenom} ${x.ref.nom}`, texteMail(x.ref.prenom, x.ref.nom, mdp.get(cle)!, Array.from(parEleve.get(x.ref.id) || [])));
    await db.doc(`parents/${cle}`).set({ refId: x.ref.id, n: x.n, email: x.email, empreinte: cibles.get(x.ref.id)![x.n], envoyeLe: new Date().toISOString() });
    envoyes++;
  }
  return { envoyes, erreurs };
}

async function peutGererClasse(e: Enseignant, classe: string) {
  if (e.isAdmin) return true;
  const c = (await db.doc(`classes/${classe}`).get()).data();
  return !!c && Array.isArray(c.pp) && c.pp.includes(e.email);
}

async function elevesAvecParents(classe: string) {
  const snap = await db.collection("eleves").get();
  return snap.docs.filter(d => cleClasse(String(d.get("classe") || "")) === classe).map(d => ({
    id: d.id, classe: String(d.get("classe") || ""), nom: String(d.get("nom") || ""), prenom: String(d.get("prenom") || ""),
    email1: String(d.get("email1") || ""), email2: String(d.get("email2") || ""),
  })).sort(parNom);
}

app.get("/api/parents", exigerEnseignant(), route(async (req, res) => {
  const classe = cleClasse(String(req.query.classe || ""));
  if (!classe || !(await peutGererClasse(ensDe(req), classe))) throw httpError(403, "Réservé au professeur principal de la classe et à l'administrateur.");
  const eleves = await elevesAvecParents(classe);
  const envois = eleves.length ? await db.getAll(...eleves.flatMap(x => [1, 2].map(n => db.doc(`parents/${x.id}__${n}`)))) : [];
  const envoi = new Map(envois.filter(d => d.exists).map(d => [d.id, d.data()!]));
  res.json({
    eleves: eleves.map(x => ({
      id: x.id, nom: x.nom, prenom: x.prenom,
      parents: ([1, 2] as const).map(n => {
        const p = envoi.get(`${x.id}__${n}`);
        const email = n === 1 ? x.email1 : x.email2;
        return { n, email, envoyeLe: p && p.email === email ? p.envoyeLe : null };
      }),
    })),
  });
}));

app.post("/api/parents/envoyer", exigerEnseignant(), route(async (req, res) => {
  const classe = cleClasse(String(req.body?.classe || ""));
  if (!classe || !(await peutGererClasse(ensDe(req), classe))) throw httpError(403, "Réservé au professeur principal de la classe et à l'administrateur.");
  if (!mailer) throw httpError(503, "L'envoi d'e-mails n'est pas encore réglé sur le serveur.");
  const voulus = new Set(Array.isArray(req.body?.refIds) ? req.body.refIds.map(String) : []);
  const liste = (await elevesAvecParents(classe)).filter(x => voulus.has(x.id))
    .flatMap(x => ([1, 2] as const).map(n => ({ ref: x, n, email: n === 1 ? x.email1 : x.email2 }))).filter(x => x.email);
  if (!liste.length) throw httpError(400, "Aucune adresse de parent pour ces élèves.");
  res.json(await nouveauxMotsDePasse(liste));
}));

// Mot de passe perdu (page publique /parents) : un nouveau mot de passe est envoyé à l'adresse connue, et seulement à elle.
app.post("/api/parents/oubli", route(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!emailValide(email)) throw httpError(400, "Adresse e-mail incorrecte.");
  if (!limiteOubliIp(String(req.ip)) || !limiteOubliEmail(email)) throw httpError(429, "Trop de demandes. Réessayez dans une heure.");
  const [s1, s2] = await Promise.all([db.collection("eleves").where("email1", "==", email).get(), db.collection("eleves").where("email2", "==", email).get()]);
  const liste = [...s1.docs.map(d => ({ d, n: 1 as const })), ...s2.docs.map(d => ({ d, n: 2 as const }))]
    .map(({ d, n }) => ({ ref: { id: d.id, classe: String(d.get("classe")), nom: String(d.get("nom")), prenom: String(d.get("prenom")) }, n, email }));
  if (liste.length) {
    try { await nouveauxMotsDePasse(liste); } catch (e) { console.error("Mot de passe parent perdu :", e); }
  }
  // Même réponse que l'adresse soit connue ou non.
  res.json({ ok: true });
}));

// Professeurs principaux et dates des trimestres (administrateur).
app.get("/api/admin/reglages", exigerEnseignant(), route(async (req, res) => {
  if (!ensDe(req).isAdmin) throw httpError(403, "Réservé à l'administrateur.");
  const snap = await db.collection("classes").get();
  res.json({ periodes: await periodes(), classes: snap.docs.map(d => ({ cle: d.id, nom: String(d.get("nom") || d.id), pp: d.get("pp") || [] })) });
}));

app.post("/api/admin/pp", exigerEnseignant(), route(async (req, res) => {
  if (!ensDe(req).isAdmin) throw httpError(403, "Réservé à l'administrateur.");
  const nom = texteCourt(req.body?.classe, 40).trim();
  const cle = cleClasse(nom);
  if (!cle) throw httpError(400, "Classe incorrecte.");
  const emails = String(req.body?.emails ?? "").split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
  if (emails.some(x => !emailValide(x))) throw httpError(400, "Adresse e-mail incorrecte.");
  if (!emails.length) await db.doc(`classes/${cle}`).delete();
  else await db.doc(`classes/${cle}`).set({ nom, pp: emails.slice(0, 5) });
  res.json({ ok: true });
}));

app.post("/api/admin/trimestres", exigerEnseignant(), route(async (req, res) => {
  if (!ensDe(req).isAdmin) throw httpError(403, "Réservé à l'administrateur.");
  const p: any = {};
  for (const t of TRIMESTRES) {
    const x = req.body?.[t];
    if (!dateValide(x?.debut) || !dateValide(x?.fin) || x.debut > x.fin) throw httpError(400, `${t} : dates incorrectes.`);
    p[t] = { debut: x.debut, fin: x.fin };
  }
  await db.doc("reglages/trimestres").set(p);
  res.json({ ok: true });
}));

// --- Pages ---------------------------------------------------------------------------------
async function startServer() {
  const webConfig: any = { apiKey: appletConfig.apiKey, authDomain: appletConfig.authDomain, projectId, appId: appletConfig.appId };
  if (process.env.USE_FIREBASE_EMULATORS === "1") webConfig.emulators = { authPort: 9099 };
  const configScript = `<script>window.__FIREBASE_CONFIG__=${JSON.stringify(webConfig).replace(/</g, "\\u003c")};</script>`;
  const isProduction = process.env.NODE_ENV === "production" || /server\.cjs$/.test(process.argv[1] || "");
  if (!isProduction) {
    const { createServer } = await import("vite");
    const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      try {
        const raw = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
        res.status(200).type("html").end(await vite.transformIndexHtml(req.originalUrl, raw.replace("<head>", `<head>${configScript}`)));
      } catch (e) { next(e); }
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    const indexHtml = fs.readFileSync(path.join(distPath, "index.html"), "utf8").replace("<head>", `<head>${configScript}`);
    const sendIndex = (_req: Request, res: Response) => { res.setHeader("Cache-Control", "no-cache"); res.type("html").send(indexHtml); };
    app.get(["/", "/index.html"], sendIndex);
    app.use((req, res, next) => (/^\/server\.cjs/.test(req.path) ? res.status(404).end() : next()));
    app.use(express.static(distPath, { index: false }));
    app.get("*", sendIndex);
  }
  app.listen(PORT, "0.0.0.0", () => console.log(`Suivi : serveur sur le port ${PORT} (projet ${projectId}, base ${databaseId})`));
}

startServer();
