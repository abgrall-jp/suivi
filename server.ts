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
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM  envoi des e-mails (codes de confirmation)
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

const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS ?? "alimatlea@gmail.com").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

// --- Applications du site ------------------------------------------------------------
const varApp = (prefixe: string, a: Application) => process.env[`${prefixe}_${a.id.toUpperCase()}`] || "";
const cleDe = (a: Application) => varApp("SUIVI_CLE", a);
const urlDe = (a: Application) => (varApp("SUIVI_URL", a) || a.url).replace(/\/+$/, "");
const appParId = (id: unknown) => APPLICATIONS.find(a => a.id === id);

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
const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 465, secure: (Number(process.env.SMTP_PORT) || 465) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  })
  : null;

async function envoyerMail(a: string, sujet: string, texte: string) {
  if (!mailer) throw httpError(503, "L'envoi d'e-mails n'est pas encore réglé sur le serveur.");
  await mailer.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: a, subject: sujet, text: texte });
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
    out.applications = APPLICATIONS.filter(a => a.eleves).map(a => ({ id: a.id, reliee: !!cleDe(a) }));
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
    catalogue: APPLICATIONS.map(a => ({ id: a.id, code: a.code, nom: a.nom, url: urlDe(a), eleves: a.eleves, prete: !!cleDe(a) })),
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
  const r = await porte(a, `/api/suivi/enseignant?email=${encodeURIComponent(email)}`);
  if (!r.teacher) throw httpError(404, `Aucun compte enseignant avec l'adresse ${email} dans ${a.nom}.`);
  await fiche(e);
  await db.doc(`enseignants/${e.uid}`).set({
    apps: { [a.id]: { email, nomDansAppli: String(r.teacher.name || ""), relieeLe: new Date().toISOString() } },
    choisies: FieldValue.arrayUnion(a.id),
  }, { merge: true });
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
  const reliees = APPLICATIONS.filter(a => a.eleves && f.apps?.[a.id]?.email && (!choisies || choisies.includes(a.id)));
  const lus = await Promise.all(reliees.map(async a => {
    try { return { app: a, d: await donnees(a, f.apps[a.id].email), erreur: null as string | null }; } catch (err: any) { return { app: a, d: null, erreur: String(err?.message || err) }; }
  }));
  return lus;
}

// Tableau en direct : une ligne par élève, un bloc par application.
app.get("/api/tableau", exigerEnseignant(), route(async (req, res) => {
  const lus = await lireApplications(ensDe(req));
  const ok = lus.filter((l): l is { app: Application; d: Donnees; erreur: null } => !!l.d);
  const { refs, provisoire, resultat } = await rapprocher(ok);
  const refDe = new Map(resultat.filter(r => r.refId).map(r => [`${r.app}:${r.studentId}`, r.refId as string]));
  const lignes = new Map<string, { refId: string; resultats: Record<string, { percent: number; score: string; at: number | null }> }>();
  for (const { app: a, d } of ok) {
    for (const r of d.results) {
      const refId = refDe.get(`${a.id}:${r.studentId}`);
      if (!refId) continue;
      const l = lignes.get(refId) || { refId, resultats: {} };
      const cle = `${a.id}:${r.exerciseId}`;
      const avant = l.resultats[cle];
      // Plusieurs essais au même exercice : le plus récent.
      if (!avant || (r.completedAt || 0) >= (avant.at || 0)) l.resultats[cle] = { percent: Number(r.percent) || 0, score: String(r.score || ""), at: r.completedAt };
      lignes.set(refId, l);
    }
  }
  const presents = new Set(resultat.map(r => r.refId).filter(Boolean));
  res.json({
    provisoire,
    applications: lus.map(l => ({
      id: l.app.id, code: l.app.code, nom: l.app.nom, erreur: l.erreur,
      exercices: (l.d?.exercises || []).filter(x => l.d!.results.some(r => r.exerciseId === x.id)).map(x => ({ id: x.id, titre: x.title })),
    })),
    eleves: refs.filter(r => presents.has(r.id))
      .sort((a, b) => a.classe.localeCompare(b.classe, "fr") || a.nom.localeCompare(b.nom, "fr") || a.prenom.localeCompare(b.prenom, "fr"))
      .map(r => ({ id: r.id, classe: r.classe, nom: r.nom, prenom: r.prenom, resultats: lignes.get(r.id)?.resultats || {} })),
    aVerifier: resultat.filter(r => r.statut === "a_verifier" || r.statut === "aucun").length,
    lu: Date.now(),
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
  for (const x of eleves) w.set(db.doc(`eleves/${x.id}`), { classe: x.classe, nom: x.nom, prenom: x.prenom });
  await w.close();
  cacheRefs = null;
  res.json({ ok: true, nombre: eleves.length, retires: avant.docs.filter(d => !garder.has(d.id)).length });
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
