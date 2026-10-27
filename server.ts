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
import { correspond, empreinte, genererMotDePasse } from "./lib/parents.ts";
import { empreinteCode as empreinteCodeFamille, genererCode, lireJeton, normaliserCode, signerJeton } from "./lib/famille.ts";
import { textesParEleve, type TextesStudio } from "./lib/studio.ts";
import { plansDe, remarquesParEleve, type PlanPublie, type RemarqueEleve } from "./lib/planclasse.ts";
import { colonnesManuelles, dateDansTrimestre, dateValide, essaiRetenu, estTrimestre, lireCoef, lireNote, moyenne, noteColonne, noteSur20, periodesParDefaut, TRIMESTRES, type Periodes, type Trimestre } from "./lib/bulletin.ts";

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
//   FIREBASE_SERVICE_ACCOUNT_PLANCLASSE  clé JSON d'un compte de service du projet du Plan de classe IA (gen-lang-client-0301284188)
//                             (sinon fichier service-account-planclasse.json)
//   PLANCLASSE_DATABASE_ID    base du Plan de classe IA (sinon plan-classe-eu, celle de la version o2switch)
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

// Le Plan de classe IA est dans un autre projet Google : un compte de service à part, en lecture seulement.
const comptePdc = process.env.FIREBASE_SERVICE_ACCOUNT_PLANCLASSE
  ? (() => { try { return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_PLANCLASSE!); } catch { console.error("FIREBASE_SERVICE_ACCOUNT_PLANCLASSE n'est pas un JSON valide"); return null; } })()
  : readJsonFile("service-account-planclasse.json");
const projetPdc = comptePdc?.project_id || process.env.PLANCLASSE_PROJECT_ID; // PLANCLASSE_PROJECT_ID : essais avec les émulateurs
const pdcDb = projetPdc
  ? getFirestore(initializeApp({ projectId: projetPdc, ...(comptePdc ? { credential: cert(comptePdc) } : {}) }, "planclasse"),
    process.env.PLANCLASSE_DATABASE_ID || "plan-classe-eu")
  : null;
let cachePlans: { at: number; plans: PlanPublie[] } | null = null;
async function plansPublies(): Promise<PlanPublie[]> {
  if (!pdcDb) return [];
  if (cachePlans && Date.now() - cachePlans.at < 20000) return cachePlans.plans;
  // Sans les placements ni les photos, qui peuvent être lourds. Dans la version o2switch du Plan de classe,
  // les remarques sont rangées à part (planSecrets) et le plan ne garde parfois que le compte de l'enseignant (teacherId).
  const [plans, secrets, profs] = await Promise.all([
    pdcDb.collection("publishedPlans").select("teacherEmail", "teacherId", "teacherName", "className", "studentRemarks").get(),
    pdcDb.collection("planSecrets").select("studentRemarks").get(),
    pdcDb.collection("teachers").select("email").get(),
  ]);
  const remarques = new Map(secrets.docs.map(d => [d.id, d.get("studentRemarks")]));
  const emails = new Map(profs.docs.map(d => [d.id, String(d.get("email") || "")]));
  cachePlans = {
    at: Date.now(),
    plans: plans.docs.map(d => {
      const p = d.data();
      return {
        teacherEmail: p.teacherEmail || emails.get(String(p.teacherId || "")) || "",
        teacherName: p.teacherName, className: p.className,
        studentRemarks: remarques.get(d.id) || p.studentRemarks,
      } as PlanPublie;
    }),
  };
  return cachePlans.plans;
}

const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS ?? "alimatlea@gmail.com").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

// --- Applications du site ------------------------------------------------------------
const varApp = (prefixe: string, a: Application) => process.env[`${prefixe}_${a.id.toUpperCase()}`] || "";
const cleDe = (a: Application) => varApp("SUIVI_CLE", a);
const urlDe = (a: Application) => (varApp("SUIVI_URL", a) || a.url).replace(/\/+$/, "");
const appParId = (id: unknown) => APPLICATIONS.find(a => a.id === id);
const parPorte = (a: Application) => (a.lecture || "porte") === "porte";
const estPrete = (a: Application) => (parPorte(a) ? !!cleDe(a) : a.lecture === "planclasse" ? !!pdcDb : true);

/** Appel de la porte de liaison d'une application. */
async function porte(a: Application, chemin: string, body?: any): Promise<any> {
  const cle = cleDe(a);
  if (!cle) throw httpError(409, `${a.nom} n'est pas encore reliée à Suivi.`);
  // Une lecture qui échoue (application en train de redémarrer, erreur passagère de l'hébergeur) est refaite une fois.
  for (let essai = 1; ; essai++) {
    let r: globalThis.Response;
    try {
      r = await fetch(urlDe(a) + chemin, {
        method: body ? "POST" : "GET",
        headers: { "X-Suivi-Cle": cle, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      if (!body && essai === 1) { await new Promise(ok => setTimeout(ok, 1500)); continue; }
      throw httpError(502, `${a.nom} ne répond pas pour le moment.`);
    }
    let data: any = {};
    try { data = await r.json(); } catch {}
    if (r.ok) return data;
    if (!body && essai === 1 && r.status >= 500) { await new Promise(ok => setTimeout(ok, 1500)); continue; }
    throw httpError(r.status === 404 ? 404 : 502, data?.error || `${a.nom} a refusé la demande (erreur ${r.status}). Réessayez dans un instant ; si cela continue, redémarrez ${a.nom} dans cPanel.`);
  }
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
async function donnees(a: Application, email: string, frais = false): Promise<Donnees> {
  const cle = `${a.id}:${email}`;
  const hit = cacheDonnees.get(cle);
  // Gardées 2 minutes (le bouton Actualiser relit tout de suite) : chaque page n'interroge plus toutes les applications.
  if (hit && Date.now() - hit.at < (frais ? 5000 : 120000)) return hit.data;
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
  let r: any;
  if (parPorte(a)) r = await porte(a, `/api/suivi/enseignant?email=${encodeURIComponent(email)}`);
  else if (a.lecture === "planclasse") {
    if (!pdcDb) throw httpError(409, `${a.nom} n'est pas encore reliée à Suivi.`);
    const plan = plansDe(await plansPublies(), email)[0] as any;
    r = { teacher: plan ? { name: plan.teacherName || "" } : null };
    if (!plan) throw httpError(404, `Aucun plan de classe publié avec l'adresse ${email} dans ${a.nom}.`);
  } else r = { teacher: { name: e.nom } };
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
async function lireApplications(e: Enseignant, frais = false) {
  const f = await fiche(e);
  const choisies: string[] | null = Array.isArray(f.choisies) ? f.choisies : null;
  const reliees = APPLICATIONS.filter(a => a.eleves && parPorte(a) && f.apps?.[a.id]?.email && (!choisies || choisies.includes(a.id)));
  const lus = await Promise.all(reliees.map(async a => {
    try { return { app: a, d: await donnees(a, f.apps[a.id].email, frais) as Donnees | null, erreur: null as string | null }; } catch (err: any) {
      // Application momentanément injoignable : on garde ses derniers résultats lus (moins de 12 heures).
      const ancien = cacheDonnees.get(`${a.id}:${f.apps[a.id].email}`);
      if (ancien && Date.now() - ancien.at < 12 * 3600e3) {
        const heure = new Date(ancien.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
        return { app: a, d: ancien.data as Donnees | null, erreur: `${String(err?.message || err)} Résultats lus à ${heure} affichés.` };
      }
      return { app: a, d: null, erreur: String(err?.message || err) };
    }
  }));
  return lus;
}

type Resultat = { percent: number; score: string; at: number | null; manuelle?: boolean };

/** Appréciation retenue : celle écrite par l'enseignant dans Suivi, sinon celle de la partie prof du Studio. */
const appreciationDe = (n: any, studioProf: unknown) => (typeof n?.appreciation === "string" ? n.appreciation : String(studioProf || ""));

/** Pour une colonne : l'autre note que celle retenue (note de l'application si la retenue est saisie à la main, et inversement). */
function autreNote(essais: Resultat[] | undefined, periode: { debut: string; fin: string }) {
  const retenu = essaiRetenu(essais, periode);
  if (!retenu) return null;
  const autre = essaiRetenu((essais || []).filter(e => !!e.manuelle !== !!retenu.manuelle), periode);
  return autre ? { note: noteColonne([autre], periode), manuelle: !!autre.manuelle } : null;
}

// Notes saisies à la main par l'enseignant (résultat perdu ou absent des applications).
// notesManuelles/{uid}__{refId} : uid, refId, notes { [colonne]: { note (sur 20), at (date retenue), le } }.
const idNotesManuelles = (uid: string, refId: string) => `${uid}__${refId.replace(/\//g, "_")}`;
async function notesManuelles(uid: string) {
  const snap = await db.collection("notesManuelles").where("uid", "==", uid).get();
  return snap.docs.map(d => d.data()).filter(d => d.refId && d.notes && typeof d.notes === "object");
}

/** Résultats de l'enseignant rangés par élève de référence (le plus récent essai pour chaque exercice). */
async function calculerTableau(e: Enseignant, frais = false) {
  const lus = await lireApplications(e, frais);
  const ok = lus.filter((l): l is { app: Application; d: Donnees; erreur: null } => !!l.d);
  const rap = await rapprocher(ok);
  const { provisoire, resultat } = rap;
  // Élèves et classes que l'enseignant ne suit pas (comptes de test, anciens élèves…) : absents du tableau et du bulletin.
  const fe = await fiche(e);
  const exclu = estExclu(fe);
  const refs = rap.refs.filter(r => !exclu(r));
  const gardes = new Set(refs.map(r => r.id));
  const refDe = new Map(resultat.filter(r => r.refId && gardes.has(r.refId)).map(r => [`${r.app}:${r.studentId}`, r.refId as string]));
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
  // Les notes saisies à la main comptent comme un essai de plus, à la date retenue.
  for (const m of await notesManuelles(e.uid)) {
    if (!gardes.has(m.refId)) continue;
    const parExo = essais.get(m.refId) || {};
    for (const [cle, n] of Object.entries<any>(m.notes)) {
      if (typeof n?.note !== "number") continue;
      (parExo[cle] ||= []).push({ percent: n.note * 5, score: `${String(n.note).replace(".", ",")}/20`, at: typeof n.at === "number" ? n.at : null, manuelle: true });
    }
    essais.set(m.refId, parExo);
  }
  const plusRecent = (liste: Resultat[]) => liste.reduce((m, x) => ((x.at || 0) >= (m.at || 0) ? x : m));
  const presents = new Set(resultat.map(r => r.refId).filter((id): id is string => !!id && gardes.has(id)));
  return {
    provisoire, refs, presents, essais, plusRecent,
    applications: lus.map(l => ({
      id: l.app.id, code: l.app.code, nom: l.app.nom, erreur: l.erreur,
      exercices: (l.d?.exercises || []).filter(x => l.d!.results.some(r => r.exerciseId === x.id)).map(x => ({ id: x.id, titre: x.title })),
    })),
    aVerifier: resultat.filter(r => (r.statut === "a_verifier" || r.statut === "aucun") && !exclu({ id: "", nom: r.nom, prenom: "", classe: r.classe })).length,
    masquees: Array.isArray(fe.colonnesMasquees) ? fe.colonnesMasquees.map(String) as string[] : [],
  };
}

/** Exclusions de l'enseignant : identifiants d'élèves et classes (clé « 5b »). */
function lireExclus(f: any): { eleves: string[]; classes: string[] } {
  const x = f?.exclus || {};
  return { eleves: Array.isArray(x.eleves) ? x.eleves.map(String) : [], classes: Array.isArray(x.classes) ? x.classes.map(String) : [] };
}
/** Comptes de test (« Test Prof », « Élève test », classe « classe-test ») : jamais suivis. */
const estTest = (...textes: string[]) => textes.some(t => /(^| )tests?( |$)/.test(normaliser(t)));
function estExclu(f: any) {
  const x = lireExclus(f);
  const eleves = new Set(x.eleves), classes = new Set(x.classes);
  return (r: EleveRef) => eleves.has(r.id) || classes.has(cleClasse(r.classe)) || estTest(r.nom, r.prenom, r.classe);
}

const parNom = (a: EleveRef, b: EleveRef) => a.classe.localeCompare(b.classe, "fr") || a.nom.localeCompare(b.nom, "fr") || a.prenom.localeCompare(b.prenom, "fr");

// Tableau en direct : une ligne par élève, un bloc par application.
app.get("/api/tableau", exigerEnseignant(), route(async (req, res) => {
  const t = await calculerTableau(ensDe(req), req.query.frais === "1");
  // L'accueil élève/parent propose cet enseignant, ses classes et ses élèves suivis.
  await synchroAnnuaire(ensDe(req), t).catch(err => console.error("Annuaire de l'accueil :", err));
  res.json({
    provisoire: t.provisoire,
    applications: t.applications,
    eleves: t.refs.filter(r => t.presents.has(r.id)).sort(parNom).map(r => ({
      id: r.id, classe: r.classe, nom: r.nom, prenom: r.prenom,
      resultats: Object.fromEntries(Object.entries(t.essais.get(r.id) || {}).map(([k, v]) => [k, t.plusRecent(v)])),
      // Note de l'application et note saisie à la main pour la même colonne : la plus récente compte, l'autre est montrée à côté.
      autres: Object.fromEntries(Object.entries(t.essais.get(r.id) || {}).flatMap(([k, v]) => {
        const retenu = t.plusRecent(v);
        const autres = v.filter(x => !!x.manuelle !== !!retenu.manuelle);
        return autres.length ? [[k, t.plusRecent(autres)]] : [];
      })),
    })),
    aVerifier: t.aVerifier,
    masquees: t.masquees,
    publiees: Object.fromEntries((await db.collection("publications").where("uid", "==", ensDe(req).uid).get()).docs
      .filter(d => d.get("type") === "tableau").map(d => [String(d.get("classe")), String(d.get("publieLe"))])),
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
  const toutes = t.applications.flatMap(a => a.exercices.map(x => ({ cle: `${a.id}:${x.id}`, app: a.nom, titre: x.titre })));
  if (!req.query.trimestre || !req.query.classe) return res.json({ periodes: per, classes, colonnesDispo: toutes });
  const { trimestre, classe } = lireTrimestreClasse(req.query);
  const ref = db.doc(`bulletins/${idBulletin(e.uid, trimestre, classe)}`);
  const b = (await ref.get()).data() || {};
  const refsClasse = elevesDeClasse(t, classe);
  // Seuls les exercices faits par des élèves de cette classe sont proposés (pas ceux des autres niveaux).
  const colonnesDispo = toutes.filter(c => refsClasse.some(r => t.essais.get(r.id)?.[c.cle]?.length));
  const titreDe = new Map(toutes.map(c => [c.cle, c.titre]));
  const colonnes: { cle: string; app: string; titre: string; coef: number }[] = (Array.isArray(b.colonnes) ? b.colonnes : [])
    .map((c: any) => ({ cle: String(c.cle), app: String(c.app || ""), titre: titreDe.get(c.cle) || String(c.titre || ""), coef: lireCoef(c.coef) }));
  const externes: { id: string; titre: string }[] = Array.isArray(b.externes) ? b.externes : [];
  const notes: Record<string, any> = b.eleves || {};
  const f = await fiche(e);
  let studio = new Map<string, TextesStudio>();
  if (f.apps?.appreciations) {
    try {
      const snap = await studioDb.collection("appreciations").where("teacherId", "==", e.uid).get();
      studio = textesParEleve(snap.docs.map(d => d.data()), trimestre, refsClasse);
    } catch (err) { console.error("Lecture du Studio d'Appréciations :", err); }
  }
  let remarques = new Map<string, RemarqueEleve[]>();
  if (f.apps?.planclasse?.email && pdcDb) {
    try { remarques = remarquesParEleve(plansDe(await plansPublies(), f.apps.planclasse.email), per[trimestre], refsClasse); } catch (err) { console.error("Lecture du Plan de classe IA :", err); }
  }
  const eleves = refsClasse.map(r => {
    const n = notes[r.id] || {};
    const essais = t.essais.get(r.id) || {};
    const calculee = colonnes.length ? noteSur20(essais, colonnes, per[trimestre]) : null;
    return {
      id: r.id, nom: r.nom, prenom: r.prenom, calculee,
      notes: Object.fromEntries(colonnes.map(c => [c.cle, noteColonne(essais[c.cle], per[trimestre])])),
      manuelles: colonnesManuelles(essais, colonnes, per[trimestre]),
      autres: Object.fromEntries(colonnes.flatMap(c => { const a = autreNote(essais[c.cle], per[trimestre]); return a ? [[c.cle, a]] : []; })),
      finale: typeof n.finale === "number" ? n.finale : null, figeeLe: n.figeeLe || null,
      externes: n.externes || {}, appreciation: appreciationDe(n, studio.get(r.id)?.prof?.texte), appreciationEcrite: typeof n.appreciation === "string",
      studio: { eleve: studio.get(r.id)?.eleve?.texte || "", prof: studio.get(r.id)?.prof?.texte || "" },
      remarques: remarques.get(r.id) || [],
    };
  });
  // Copie des notes calculées, pour que le prof principal les voie sans accès aux applications de ce collègue.
  const copie = Object.fromEntries(eleves.map(x => [x.id, x.calculee]));
  const noms = Object.fromEntries(eleves.map(x => [x.id, `${x.nom} ${x.prenom}`.trim()]));
  // L'appréciation que l'élève a écrite lui-même, montrée aussi au prof principal.
  const autoEval = Object.fromEntries(eleves.filter(x => x.studio.eleve).map(x => [x.id, x.studio.eleve]));
  // Et l'appréciation de la partie prof du Studio, reprise quand l'enseignant n'en a pas écrit dans Suivi.
  const studioProf = Object.fromEntries(eleves.filter(x => x.studio.prof).map(x => [x.id, x.studio.prof]));
  if (b.classeNom && JSON.stringify([b.calculees || {}, b.noms || {}, b.autoEval || {}, b.studioProf || {}]) !== JSON.stringify([copie, noms, autoEval, studioProf])) {
    await ref.set({ calculees: copie, noms, autoEval, studioProf, calculeesLe: new Date().toISOString() }, { merge: true });
  }
  res.json({
    periodes: per, classes, colonnesDispo, trimestre, classe,
    colonnes, externes, eleves, studioRelie: !!f.apps?.appreciations,
    publieLe: (await db.doc(`publications/${e.uid}__bulletin__${trimestre}__${classe}`).get()).get("publieLe") || null,
  });
}));

app.post("/api/bulletin/colonnes", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const { trimestre, classe } = lireTrimestreClasse(req.body);
  const colonnes = (Array.isArray(req.body?.colonnes) ? req.body.colonnes : []).slice(0, 100)
    .map((c: any) => ({ cle: texteCourt(c?.cle, 300), app: texteCourt(c?.app, 80), titre: texteCourt(c?.titre, 200), coef: lireCoef(c?.coef) })).filter((c: any) => c.cle);
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
    const n = noteSur20(t.essais.get(r.id) || {}, b.colonnes, per[trimestre]);
    if (n !== null) maj[r.id] = { finale: n, figeeLe: le };
  }
  await ref.set({ eleves: maj, majLe: le }, { merge: true });
  res.json({ ok: true, figees: Object.keys(maj).length });
}));

// Note saisie à la main dans une colonne (tableau ou bulletin) : note sur 20, ou vide pour l'effacer.
// Depuis le bulletin, la note est datée dans le trimestre affiché, pour y compter même saisie après coup.
app.post("/api/notes-manuelles", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const refId = texteCourt(req.body?.refId, 200);
  const cle = texteCourt(req.body?.cle, 300);
  const n = lireNote(req.body?.note);
  if (n === undefined) throw httpError(400, "La note doit être entre 0 et 20.");
  const t = await calculerTableau(e);
  if (!t.refs.some(r => r.id === refId)) throw httpError(404, "Élève introuvable.");
  if (!t.applications.some(a => a.exercices.some(x => `${a.id}:${x.id}` === cle))) throw httpError(404, "Colonne introuvable.");
  let at = Date.now();
  if (req.body?.trimestre !== undefined) {
    if (!estTrimestre(req.body.trimestre)) throw httpError(400, "Trimestre incorrect.");
    at = dateDansTrimestre((await periodes())[req.body.trimestre as Trimestre]);
  }
  await db.doc(`notesManuelles/${idNotesManuelles(e.uid, refId)}`).set({
    uid: e.uid, refId, notes: { [cle]: n === null ? FieldValue.delete() : { note: n, at, le: new Date().toISOString() } },
  }, { merge: true });
  res.json({ ok: true });
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
      return [id, { note: typeof n.finale === "number" ? n.finale : (b.calculees?.[id] ?? null), definitive: typeof n.finale === "number", externes: n.externes || {}, appreciation: appreciationDe(n, b.studioProf?.[id]) }];
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
  const f = await fiche(ensDe(req));
  const exclu = estExclu(f);
  res.json({
    provisoire,
    exclus: lireExclus(f),
    references: refs.map(r => ({ id: r.id, classe: r.classe, nom: r.nom, prenom: r.prenom })),
    eleves: resultat.map(r => ({ ...r, appNom: appParId(r.app)?.nom || r.app, exclu: exclu({ id: r.refId || "", nom: r.nom, prenom: "", classe: r.classe }) })),
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

// Colonnes du tableau que l'enseignant a masquées (« app:exercice »).
app.post("/api/colonnes-masquees", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const masquees = Array.from(new Set((Array.isArray(req.body?.masquees) ? req.body.masquees : []).map((x: unknown) => String(x ?? "").slice(0, 300)).filter(Boolean))).slice(0, 2000);
  await fiche(e);
  await db.doc(`enseignants/${e.uid}`).set({ colonnesMasquees: masquees }, { merge: true });
  res.json({ ok: true, masquees });
}));

// Élèves et classes que l'enseignant ne suit pas : la liste complète remplace la précédente.
app.post("/api/exclus", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const liste = (v: unknown, max: number, f: (x: string) => string) =>
    Array.from(new Set((Array.isArray(v) ? v : []).map(x => f(String(x ?? "")).slice(0, 200)).filter(Boolean))).slice(0, max);
  const exclus = { eleves: liste(req.body?.eleves, 3000, x => x), classes: liste(req.body?.classes, 200, cleClasse) };
  await fiche(e);
  await db.doc(`enseignants/${e.uid}`).set({ exclus }, { merge: true });
  res.json({ ok: true, exclus });
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
      if (!a.eleves || a.parents === false || !parPorte(a) || !email || !cleDe(a) || (seulement && seulement.app !== a.id)) continue;
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
  `Les résultats et le bulletin publiés par les enseignants : ${ADRESSE}/famille (votre adresse e-mail et ce mot de passe).\n\n` +
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

// --- Espace des familles ------------------------------------------------------------------------
// L'élève et ses parents voient seulement ce que les enseignants ont publié pour lui : une copie du tableau de sa classe
// (colonnes non masquées) et le bulletin validé. publications/{uid}__tableau__{classe} et {uid}__bulletin__{trimestre}__{classe}
// gardent une ligne par élève ; la famille ne reçoit que la sienne. Accès par identifiant et mot de passe de l'élève (codesEleves)
// ou par le mot de passe parent (collection parents).
let secretFamille: string | null = process.env.SUIVI_SECRET || null;
async function secret(): Promise<string> {
  if (secretFamille) return secretFamille;
  const ref = db.doc("reglages/secretFamille");
  const s = await db.runTransaction(async tx => {
    const d = await tx.get(ref);
    if (d.exists && d.get("s")) return String(d.get("s"));
    const nouveau = crypto.randomBytes(32).toString("hex");
    tx.set(ref, { s: nouveau });
    return nouveau;
  });
  return (secretFamille = s);
}

/** Élèves suivis de cette classe chez cet enseignant (ceux qui ont un compte dans ses applications). */
function elevesSuivis(t: Awaited<ReturnType<typeof calculerTableau>>, classe: string) {
  return elevesDeClasse(t, classe).filter(r => t.presents.has(r.id));
}
const nomEnseignant = async (e: Enseignant) => {
  const f = await fiche(e);
  const nomAppli = Object.values<any>(f.apps || {}).map(a => a?.nomDansAppli).find(Boolean);
  return (e.nom.includes("@") || e.nom === e.email.split("@")[0]) && nomAppli ? String(nomAppli) : e.nom;
};

app.post("/api/publier/tableau", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const classe = cleClasse(String(req.body?.classe || ""));
  if (!classe || classe.length > 40) throw httpError(400, "Choisissez d'abord une classe.");
  const ref = db.doc(`publications/${e.uid}__tableau__${classe}`);
  if (req.body?.retirer) { await ref.delete(); return res.json({ ok: true }); }
  const t = await calculerTableau(e, true);
  const eleves = elevesSuivis(t, classe);
  if (!eleves.length) throw httpError(404, "Aucun élève suivi dans cette classe.");
  const colonnes = t.applications.flatMap(a => a.exercices.map(x => ({ cle: `${a.id}:${x.id}`, app: a.nom, titre: x.titre })))
    .filter(c => !t.masquees.includes(c.cle) && eleves.some(r => t.essais.get(r.id)?.[c.cle]?.length));
  const lignes: Record<string, Record<string, { percent: number; score: string; manuelle?: boolean }>> = {};
  for (const r of eleves) {
    const ess = t.essais.get(r.id) || {};
    lignes[r.id] = Object.fromEntries(colonnes.filter(c => ess[c.cle]?.length).map(c => {
      const x = t.plusRecent(ess[c.cle]);
      return [c.cle, { percent: Math.round(x.percent), score: x.score, ...(x.manuelle ? { manuelle: true } : {}) }];
    }));
  }
  const publieLe = new Date().toISOString();
  await ref.set({
    type: "tableau", uid: e.uid, enseignant: await nomEnseignant(e), classe, classeNom: eleves[0].classe, publieLe,
    colonnes, lignes, refIds: eleves.map(r => r.id), noms: Object.fromEntries(eleves.map(r => [r.id, { nom: r.nom, prenom: r.prenom, classe: r.classe }])),
  });
  res.json({ ok: true, publieLe, eleves: eleves.length, colonnes: colonnes.length });
}));

app.post("/api/publier/bulletin", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const { trimestre, classe } = lireTrimestreClasse(req.body);
  const ref = db.doc(`publications/${e.uid}__bulletin__${trimestre}__${classe}`);
  if (req.body?.retirer) { await ref.delete(); return res.json({ ok: true }); }
  const b = (await db.doc(`bulletins/${idBulletin(e.uid, trimestre, classe)}`).get()).data();
  if (!b?.colonnes?.length) throw httpError(409, "Choisissez d'abord les notes à reprendre.");
  const per = await periodes();
  const t = await calculerTableau(e, true);
  const refs = elevesDeClasse(t, classe);
  const colonnes = (b.colonnes as any[]).map(c => ({ cle: String(c.cle), titre: String(c.titre || ""), coef: lireCoef(c.coef) }));
  const externes: { id: string; titre: string }[] = Array.isArray(b.externes) ? b.externes : [];
  const eleves: Record<string, any> = {};
  for (const r of refs) {
    const n = b.eleves?.[r.id] || {};
    const ess = t.essais.get(r.id) || {};
    const calculee = noteSur20(ess, colonnes, per[trimestre]);
    eleves[r.id] = {
      notes: Object.fromEntries(colonnes.map(c => [c.cle, noteColonne(ess[c.cle], per[trimestre])])),
      manuelles: colonnesManuelles(ess, colonnes, per[trimestre]),
      moyenne: typeof n.finale === "number" ? n.finale : calculee, definitive: typeof n.finale === "number",
      externes: Object.fromEntries(externes.map(x => [x.id, n.externes?.[x.id] ?? null])), appreciation: appreciationDe(n, b.studioProf?.[r.id]), autoEval: String(b.autoEval?.[r.id] || ""),
    };
  }
  const publieLe = new Date().toISOString();
  await ref.set({
    type: "bulletin", uid: e.uid, enseignant: await nomEnseignant(e), trimestre, classe, classeNom: refs[0]?.classe || classe, publieLe,
    colonnes, externes, eleves, refIds: refs.map(r => r.id), noms: Object.fromEntries(refs.map(r => [r.id, { nom: r.nom, prenom: r.prenom, classe: r.classe }])),
  });
  res.json({ ok: true, publieLe, eleves: refs.length });
}));

// Accès des élèves (et de leurs parents, avec le même mot de passe) : un identifiant (« alice.durand.5b ») et un mot de passe
// de départ commun à la classe, donnés par l'enseignant. À la première connexion, l'élève choisit son mot de passe ; le code de départ ne sert plus.
// codesEleves/{refId} : identifiant, h (empreinte du code de départ), mdp (empreinte scrypt du mot de passe choisi).
// identifiants/{identifiant} : refId. « Nouveau code » (mot de passe oublié) efface le mot de passe choisi.
const identifiantDe = (r: EleveRef) => normaliserCode(`${r.prenom} ${r.nom} ${cleClasse(r.classe)}`).replace(/-/g, ".");

// Annuaire de l'accueil élève/parent : on choisit son enseignant, sa classe, puis son nom, avant le mot de passe.
// annuaire/{uid}__{classe} : uid, enseignant, classe, classeNom, eleves { refId: { prenom, nom } } — tous les élèves suivis de la classe.
// Mis à jour chaque fois que l'enseignant ouvre son tableau (écrit seulement quand quelque chose a changé).
const annuaireEcrit = new Map<string, string>();
async function synchroAnnuaire(e: Enseignant, t: Awaited<ReturnType<typeof calculerTableau>>) {
  const nom = await nomEnseignant(e);
  const parClasse = new Map<string, EleveRef[]>();
  for (const r of t.refs.filter(r => t.presents.has(r.id))) {
    const c = cleClasse(r.classe);
    if (c && c.length <= 40) parClasse.set(c, [...(parClasse.get(c) || []), r]);
  }
  const contenu = Array.from(parClasse.entries()).map(([classe, eleves]) => ({
    id: `${e.uid}__${classe}`, uid: e.uid, enseignant: nom, classe, classeNom: eleves[0].classe,
    eleves: Object.fromEntries(eleves.sort(parNom).map(r => [r.id, { prenom: r.prenom, nom: r.nom }])),
  }));
  const empreinte = JSON.stringify(contenu);
  if (annuaireEcrit.get(e.uid) === empreinte) return;
  const avant = await db.collection("annuaire").where("uid", "==", e.uid).get();
  const lot = db.batch();
  const gardes = new Set(contenu.map(c => c.id));
  for (const d of avant.docs) if (!gardes.has(d.id)) lot.delete(d.ref);
  for (const { id, ...c } of contenu) lot.set(db.doc(`annuaire/${id}`), { ...c, majLe: new Date().toISOString() });
  await lot.commit();
  annuaireEcrit.set(e.uid, empreinte);
}

app.get("/api/famille/codes", exigerEnseignant(), route(async (req, res) => {
  const classe = cleClasse(String(req.query.classe || ""));
  const t = await calculerTableau(ensDe(req));
  const eleves = elevesSuivis(t, classe);
  const docs = eleves.length ? await db.getAll(...eleves.map(r => db.doc(`codesEleves/${r.id}`))) : [];
  await synchroAnnuaire(ensDe(req), t);
  res.json({ eleves: eleves.map((r, i) => ({
    id: r.id, nom: r.nom, prenom: r.prenom, classe: r.classe, codeLe: docs[i]?.get("le") || null,
    identifiant: docs[i]?.get("identifiant") || null, personnalise: !!docs[i]?.get("mdp"),
  })) });
}));

app.post("/api/famille/codes", exigerEnseignant(), route(async (req, res) => {
  const e = ensDe(req);
  const classe = cleClasse(String(req.body?.classe || ""));
  const t = await calculerTableau(e);
  const voulus = Array.isArray(req.body?.refIds) ? new Set(req.body.refIds.map(String)) : null;
  const eleves = elevesSuivis(t, classe).filter(r => !voulus || voulus.has(r.id));
  const sec = await secret();
  const existants = eleves.length ? await db.getAll(...eleves.map(r => db.doc(`codesEleves/${r.id}`))) : [];
  const codes: { id: string; nom: string; prenom: string; classe: string; identifiant: string; code: string }[] = [];
  const le = new Date().toISOString();
  // Mot de passe de départ commun à la classe (choisi par l'enseignant, ou tiré au hasard) ; un élève seul (« Nouveau code ») en reçoit un à lui.
  const deClasse = String(req.body?.motDeClasse ?? "").trim();
  if (deClasse && (deClasse.length < 6 || deClasse.length > 60)) throw httpError(400, "Le mot de passe de classe doit avoir de 6 à 60 caractères.");
  const codeCommun = voulus && voulus.size === 1 && !deClasse ? null : deClasse || genererCode();
  for (const [i, r] of eleves.entries()) {
    // Sans demande précise, seuls les élèves sans code en reçoivent un (les fiches déjà distribuées restent valables).
    if (!voulus && existants[i]?.exists) continue;
    let identifiant = existants[i]?.get("identifiant") || "";
    if (!identifiant) {
      // Deux homonymes dans la même classe : « alice.durand.5b.2 ».
      const base = identifiantDe(r) || r.id.toLowerCase();
      for (let n = 1; ; n++) {
        const essai = n === 1 ? base : `${base}.${n}`;
        const d = await db.doc(`identifiants/${essai}`).get();
        if (!d.exists || d.get("refId") === r.id) { identifiant = essai; break; }
      }
    }
    const code = codeCommun || genererCode();
    const lot = db.batch();
    lot.set(db.doc(`identifiants/${identifiant}`), { refId: r.id });
    lot.set(db.doc(`codesEleves/${r.id}`), { identifiant, nom: r.nom, prenom: r.prenom, h: empreinteCodeFamille(code, sec), mdp: FieldValue.delete(), par: e.email, le }, { merge: true });
    await lot.commit();
    codes.push({ id: r.id, nom: r.nom, prenom: r.prenom, classe: r.classe, identifiant, code });
  }
  res.json({ codes, adresse: `${ADRESSE}/famille`, motDeClasse: codes.length && codeCommun ? codeCommun : null });
}));

// Essais de mot de passe : 10 par quart d'heure pour un même élève depuis une même adresse (toute une classe
// partage souvent la même adresse au collège), et 300 au total par adresse.
const limiteFamille = makeLimiter(10, 15 * 60 * 1000);
const limiteFamilleIp = makeLimiter(300, 15 * 60 * 1000);
const essaiFamille = (ip: string, qui: unknown) => {
  if (!limiteFamilleIp(ip) || !limiteFamille(`${ip}|${String(qui ?? "").slice(0, 200).toLowerCase()}`)) throw httpError(429, "Trop d'essais. Réessayez dans un quart d'heure.");
};

// Prénom et initiale du nom (« Alice D. ») ; le nom entier seulement si deux élèves de la classe s'appelleraient pareil.
function nomsAffiches(eleves: { id: string; prenom: string; nom: string }[]) {
  const court = (x: { prenom: string; nom: string }) => `${x.prenom} ${x.nom.trim().charAt(0).toUpperCase()}.`.trim();
  const compte = new Map<string, number>();
  for (const x of eleves) compte.set(court(x), (compte.get(court(x)) || 0) + 1);
  return eleves.map(x => ({ id: x.id, nom: compte.get(court(x))! > 1 ? `${x.prenom} ${x.nom}`.trim() : court(x) }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}
const limiteAnnuaire = makeLimiter(300, 15 * 60 * 1000);

app.get("/api/famille/annuaire", route(async (req, res) => {
  if (!limiteAnnuaire(String(req.ip))) throw httpError(429, "Trop de demandes. Réessayez dans un quart d'heure.");
  const snap = await db.collection("annuaire").get();
  const parEns = new Map<string, { uid: string; nom: string; classes: { cle: string; nom: string }[] }>();
  for (const d of snap.docs) {
    const x = d.data();
    const ens = parEns.get(x.uid) || { uid: String(x.uid), nom: String(x.enseignant || ""), classes: [] };
    ens.classes.push({ cle: String(x.classe), nom: String(x.classeNom || x.classe) });
    parEns.set(x.uid, ens);
  }
  const enseignants = Array.from(parEns.values()).map(e => ({ ...e, classes: e.classes.sort((a, b) => a.nom.localeCompare(b.nom, "fr")) }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  res.json({ enseignants });
}));

app.get("/api/famille/annuaire/eleves", route(async (req, res) => {
  if (!limiteAnnuaire(String(req.ip))) throw httpError(429, "Trop de demandes. Réessayez dans un quart d'heure.");
  const uid = String(req.query.enseignant || "").replace(/[^A-Za-z0-9_-]/g, "");
  const classe = cleClasse(String(req.query.classe || ""));
  const d = uid && classe ? (await db.doc(`annuaire/${uid}__${classe}`).get()).data() : null;
  if (!d) throw httpError(404, "Classe introuvable.");
  res.json({ eleves: nomsAffiches(Object.entries<any>(d.eleves || {}).map(([id, x]) => ({ id, prenom: String(x?.prenom || ""), nom: String(x?.nom || "") }))) });
}));

const enfantPour = async (refId: string, sec: string) => {
  const r = (await elevesReference()).find(x => x.id === refId) || (await db.doc(`codesEleves/${refId}`).get()).data();
  return { jeton: signerJeton(refId, sec), prenom: String(r?.prenom || ""), nom: String(r?.nom || "") };
};
const MDP_MIN = 8;

app.post("/api/famille/connexion", route(async (req, res) => {
  essaiFamille(String(req.ip), req.body?.refId ?? req.body?.identifiant ?? req.body?.email);
  const sec = await secret();
  // Élève (ou parent) choisi dans l'accueil (enseignant, classe, nom) ou, comme avant, avec l'identifiant de sa fiche.
  if (req.body?.refId !== undefined || req.body?.identifiant !== undefined) {
    const choisi = req.body?.refId !== undefined ? String(req.body.refId).slice(0, 200) : "";
    const id = choisi ? "" : normaliserCode(req.body.identifiant).replace(/-/g, ".");
    const mdp = String(req.body?.motDePasse || "").trim();
    const refId = choisi && !choisi.includes("/") ? choisi : id ? (await db.doc(`identifiants/${id}`).get()).get("refId") : null;
    const c = refId ? (await db.doc(`codesEleves/${refId}`).get()).data() : null;
    if (choisi && !c) throw httpError(401, "Pas encore de mot de passe pour cet élève : demandez-le à l'enseignant (onglet « Familles »).");
    if (c?.mdp && correspond(mdp, c.mdp)) return res.json({ enfants: [await enfantPour(refId, sec)] });
    // Code de départ : accepté seulement tant que l'élève n'a pas choisi son mot de passe.
    if (c && !c.mdp && c.h === empreinteCodeFamille(mdp, sec)) {
      return res.json({ doitChanger: true, jeton: signerJeton(`changer:${refId}`, sec, 30 * 60e3), prenom: (await enfantPour(refId, sec)).prenom });
    }
    throw httpError(401, "Mot de passe incorrect.");
  }
  const email = String(req.body?.email || "").trim().toLowerCase();
  const mdp = String(req.body?.motDePasse || "").trim();
  let refIds: string[] = [];
  if (emailValide(email) && mdp) {
    const snap = await db.collection("parents").where("email", "==", email).get();
    refIds = Array.from(new Set(snap.docs.filter(d => correspond(mdp, String(d.get("empreinte")))).map(d => String(d.get("refId")))));
  }
  if (!refIds.length) throw httpError(401, "Adresse ou mot de passe incorrect.");
  res.json({ enfants: await Promise.all(refIds.map(id => enfantPour(id, sec))) });
}));

// Mot de passe choisi par l'élève : à la première connexion (jeton « changer: »), ou plus tard depuis son espace.
app.post("/api/famille/mot-de-passe", route(async (req, res) => {
  essaiFamille(String(req.ip), String(req.body?.jeton || "").slice(0, 60));
  const sec = await secret();
  const lu = lireJeton(String(req.body?.jeton || ""), sec);
  const refId = lu?.startsWith("changer:") ? lu.slice(8) : lu;
  if (!refId) throw httpError(401, "Reconnectez-vous avec votre code.");
  const nouveau = String(req.body?.nouveau || "").trim();
  if (nouveau.length < MDP_MIN || nouveau.length > 100) throw httpError(400, `Le mot de passe doit avoir au moins ${MDP_MIN} caractères.`);
  const ref = db.doc(`codesEleves/${refId}`);
  if (!(await ref.get()).exists) throw httpError(404, "Accès introuvable : demandez un nouveau code à votre enseignant.");
  await ref.set({ mdp: empreinte(nouveau), mdpLe: new Date().toISOString() }, { merge: true });
  res.json({ enfants: [await enfantPour(refId, sec)] });
}));

app.get("/api/famille", route(async (req, res) => {
  const h = String(req.headers.authorization || "");
  const lu = h.startsWith("Famille ") ? lireJeton(h.slice(8).trim(), await secret()) : null;
  const refId = lu && !lu.startsWith("changer:") ? lu : null;
  if (!refId) throw httpError(401, "Connectez-vous avec votre identifiant.");
  const snap = await db.collection("publications").where("refIds", "array-contains", refId).get();
  const docs = snap.docs.map(d => d.data());
  const nom = docs.map(d => d.noms?.[refId]).find(Boolean) || null;
  const tableaux = docs.filter(d => d.type === "tableau").map(d => ({
    enseignant: d.enseignant, classe: d.classeNom, publieLe: d.publieLe,
    colonnes: (d.colonnes || []).map((c: any) => ({ cle: c.cle, app: c.app, titre: c.titre })), resultats: d.lignes?.[refId] || {},
  })).sort((a, b) => String(a.enseignant).localeCompare(String(b.enseignant), "fr"));
  const bulletins = docs.filter(d => d.type === "bulletin").map(d => ({
    enseignant: d.enseignant, classe: d.classeNom, trimestre: d.trimestre, publieLe: d.publieLe,
    colonnes: d.colonnes || [], externes: d.externes || [], notes: d.eleves?.[refId]?.notes || {}, manuelles: d.eleves?.[refId]?.manuelles || [], moyenne: d.eleves?.[refId]?.moyenne ?? null,
    definitive: !!d.eleves?.[refId]?.definitive, externesNotes: d.eleves?.[refId]?.externes || {}, appreciation: d.eleves?.[refId]?.appreciation || "", autoEval: d.eleves?.[refId]?.autoEval || "",
  })).sort((a, b) => String(b.trimestre).localeCompare(String(a.trimestre)) || String(a.enseignant).localeCompare(String(b.enseignant), "fr"));
  res.json({ eleve: nom, tableaux, bulletins });
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
