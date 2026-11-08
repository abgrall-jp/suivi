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
var import_crypto = __toESM(require("crypto"), 1);
var import_genai = require("@google/genai");
var import_app = require("firebase-admin/app");
var import_auth = require("firebase-admin/auth");
var import_firestore = require("firebase-admin/firestore");
var import_stripe = __toESM(require("stripe"), 1);

// lib/billing.ts
var DEFAULT_BILLING_CONFIG = {
  enabled: false,
  pricePerCorrectionEur: 0.01,
  freeCredits: 100,
  packsEur: [1, 2, 5, 10, 20],
  stripeFixedEur: 0.25,
  stripePercent: 1.5,
  adminsExempt: true
};
var round2 = (n) => Math.round(n * 100) / 100;
function packBreakdown(eur, cfg) {
  const stripeFeeEur = round2(cfg.stripeFixedEur + eur * cfg.stripePercent / 100);
  const netEur = round2(Math.max(0, eur - stripeFeeEur));
  const corrections = cfg.pricePerCorrectionEur > 0 ? Math.floor(netEur / cfg.pricePerCorrectionEur + 1e-9) : 0;
  return { eur, stripeFeeEur, netEur, corrections };
}
function sanitizeBillingConfig(raw) {
  const d = DEFAULT_BILLING_CONFIG;
  const num = (v, def, min, max) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
    return isNaN(n) ? def : Math.min(max, Math.max(min, n));
  };
  const packs = Array.isArray(raw?.packsEur) ? Array.from(new Set(raw.packsEur.map((p) => num(p, 0, 0, 500)).filter((p) => p >= 1))).sort((a, b) => a - b).slice(0, 8) : d.packsEur;
  return {
    enabled: typeof raw?.enabled === "boolean" ? raw.enabled : d.enabled,
    pricePerCorrectionEur: num(raw?.pricePerCorrectionEur, d.pricePerCorrectionEur, 1e-3, 1),
    freeCredits: Math.round(num(raw?.freeCredits, d.freeCredits, 0, 1e5)),
    packsEur: packs.length > 0 ? packs : d.packsEur,
    stripeFixedEur: num(raw?.stripeFixedEur, d.stripeFixedEur, 0, 5),
    stripePercent: num(raw?.stripePercent, d.stripePercent, 0, 20),
    adminsExempt: typeof raw?.adminsExempt === "boolean" ? raw.adminsExempt : d.adminsExempt
  };
}

// server.ts
var PORT = Number(process.env.PORT) || 3e3;
function readJsonFile(fileName) {
  try {
    const filePath = import_path.default.join(process.cwd(), fileName);
    if (import_fs.default.existsSync(filePath)) return JSON.parse(import_fs.default.readFileSync(filePath, "utf8"));
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
var adminApp = (0, import_app.getApps)()[0] || (0, import_app.initializeApp)({
  projectId,
  ...serviceAccount ? { credential: (0, import_app.cert)(serviceAccount) } : {}
});
var adminAuth = (0, import_auth.getAuth)(adminApp);
var adminDb = databaseId === "(default)" ? (0, import_firestore.getFirestore)(adminApp) : (0, import_firestore.getFirestore)(adminApp, databaseId);
var ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || "alimatlea@gmail.com,jeanphilippe.2p@gmail.com").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
var AI_MODEL = process.env.AI_MODEL || "gemini-3.8-flash";
var AI_FALLBACK_MODEL = process.env.AI_FALLBACK_MODEL || "gemini-3.1-flash-lite";
var ALLOWED_CONFIG_KEYS = ["systemInstruction", "responseMimeType", "responseSchema", "thinkingConfig", "temperature", "topP", "topK", "maxOutputTokens"];
var aiClient = null;
function getAI() {
  if (!aiClient && process.env.GEMINI_API_KEY) {
    aiClient = new import_genai.GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      // GEMINI_BASE_URL sert uniquement aux tests (faux service Gemini local).
      ...process.env.GEMINI_BASE_URL ? { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } } : {}
    });
  }
  return aiClient;
}
function isOverload(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const status = Number(err?.status || err?.code || 0);
  return [429, 500, 503, 504].includes(status) || msg.includes("overloaded") || msg.includes("unavailable") || msg.includes("resource_exhausted") || msg.includes("quota");
}
function isSafeId(v) {
  return typeof v === "string" && v.length > 0 && v.length <= 200 && !v.includes("/") && v !== "." && v !== "..";
}
function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket.remoteAddress || "?";
}
function makeLimiter(max, windowMs) {
  const hits = /* @__PURE__ */ new Map();
  return (key) => {
    const now = Date.now();
    if (hits.size > 5e4) {
      for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    }
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    h.count++;
    return h.count <= max;
  };
}
var loginLimiter = makeLimiter(10, 15 * 60 * 1e3);
var publicLimiter = makeLimiter(120, 60 * 1e3);
var aiTeacherLimiter = makeLimiter(Number(process.env.AI_MAX_PER_TEACHER_15MIN) || 60, 15 * 60 * 1e3);
var ADMIN_UIDS = String(process.env.ADMIN_UIDS || "").split(",").map((s) => s.trim()).filter(Boolean);
async function readCaller(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return null;
  try {
    return await adminAuth.verifyIdToken(h.slice(7).trim());
  } catch {
    return null;
  }
}
function isAdminEmail(t) {
  if (t.role) return false;
  return !!t.email && t.email_verified === true && ADMIN_EMAILS.includes(t.email.toLowerCase()) || ADMIN_UIDS.includes(t.uid);
}
var profileCache = /* @__PURE__ */ new Map();
async function userProfile(uid) {
  const hit = profileCache.get(uid);
  if (hit && Date.now() - hit.at < 60 * 1e3) return hit;
  const u = (await adminDb.doc(`users/${uid}`).get()).data() || {};
  const p = { role: String(u.role || ""), email: String(u.email || ""), at: Date.now() };
  profileCache.set(uid, p);
  return p;
}
async function isTeacher(t) {
  if (t.role || !t.email) return false;
  if (isAdminEmail(t)) return true;
  const p = await userProfile(t.uid);
  return p.role === "teacher" || p.role === "admin";
}
function requireAdmin() {
  return async (req, res, next) => {
    const t = await readCaller(req);
    if (!t) return res.status(401).json({ error: "Connexion requise." });
    if (!isAdminEmail(t)) return res.status(403).json({ error: "R\xE9serv\xE9 \xE0 l'administrateur." });
    req.caller = t;
    next();
  };
}
function requireTeacher() {
  return async (req, res, next) => {
    const t = await readCaller(req);
    if (!t) return res.status(401).json({ error: "Connexion requise. Reconnectez-vous puis r\xE9essayez." });
    if (!await isTeacher(t)) return res.status(403).json({ error: "R\xE9serv\xE9 aux enseignants." });
    req.caller = t;
    next();
  };
}
async function teacherDefaultPin(teacherId) {
  if (!isSafeId(teacherId)) return "";
  const t = (await adminDb.doc(`users/${teacherId}`).get()).data();
  return String(t?.defaultStudentPin || "").trim();
}
function publicStudent(id, s) {
  return {
    id,
    name: String(s?.name || ""),
    classId: String(s?.classId || ""),
    teacherId: String(s?.teacherId || ""),
    ...s?.schoolName ? { schoolName: String(s.schoolName) } : {},
    isPinChanged: s?.isPinChanged === true
  };
}
var app = (0, import_express.default)();
app.set("trust proxy", true);
var STRIPE_APP = "motsmeles";
var STRIPE_KIND = "motsmeles_credits";
var isAppPayment = (meta) => meta?.app === STRIPE_APP && meta?.kind === STRIPE_KIND;
var stripeClient = null;
function getStripe() {
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) return null;
  if (!stripeClient) {
    const testHost = process.env.STRIPE_API_HOST;
    stripeClient = testHost ? new import_stripe.default(key, { host: testHost.split(":")[0], port: Number(testHost.split(":")[1] || 80), protocol: "http" }) : new import_stripe.default(key);
  }
  return stripeClient;
}
app.post("/api/stripe/webhook", import_express.default.raw({ type: "application/json" }), async (req, res) => {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return res.status(503).json({ error: "Webhook Stripe non configur\xE9." });
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, String(req.headers["stripe-signature"] || ""), secret);
  } catch {
    return res.status(400).json({ error: "Signature Stripe invalide." });
  }
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (isAppPayment(session.metadata)) {
      try {
        await applyCreditPayment(session);
      } catch (err) {
        console.error("Stripe webhook credit error:", err);
        return res.status(500).json({ error: "Erreur d'enregistrement du cr\xE9dit." });
      }
    }
  }
  return res.json({ received: true });
});
app.use(import_express.default.json({ limit: "2mb" }));
app.get("/api/health", async (req, res) => {
  if (req.query.db === void 0) return res.json({ status: "ok" });
  try {
    await adminDb.doc("appConfig/billing").get();
    res.json({ status: "ok", acces: "ok", base: databaseId, projetCle: serviceAccount?.project_id || null, projet: projectId });
  } catch (e) {
    res.status(500).json({ status: "erreur", acces: String(e?.message || e).slice(0, 300), base: databaseId, projetCle: serviceAccount?.project_id || null, projet: projectId });
  }
});
app.get("/api/public/directory", async (req, res) => {
  if (!publicLimiter(clientIp(req))) return res.status(429).json({ error: "Trop de demandes, patientez une minute." });
  try {
    const [teachersSnap, classesSnap] = await Promise.all([
      adminDb.collection("users").where("role", "==", "teacher").get(),
      adminDb.collection("classes").get()
    ]);
    const teachers = teachersSnap.docs.map((d) => {
      const u = d.data();
      return { uid: String(u.uid || d.id), name: String(u.name || ""), role: "teacher", email: "", ...u.schoolName ? { schoolName: String(u.schoolName) } : {} };
    });
    const classes = classesSnap.docs.map((d) => {
      const c = d.data();
      return { id: String(c.id || d.id), name: String(c.name || "Classe"), teacherId: String(c.teacherId || ""), ...c.schoolName ? { schoolName: String(c.schoolName) } : {} };
    });
    res.json({ teachers, classes });
  } catch (e) {
    console.error("public/directory", e);
    res.status(500).json({ error: "Erreur lors du chargement des classes." });
  }
});
app.get("/api/public/class-students", async (req, res) => {
  if (!publicLimiter(clientIp(req))) return res.status(429).json({ error: "Trop de demandes, patientez une minute." });
  const classId = String(req.query.classId || "");
  if (!isSafeId(classId)) return res.json({ students: [] });
  try {
    const snap = await adminDb.collection("students").where("classId", "==", classId).get();
    res.json({ students: snap.docs.map((d) => publicStudent(d.id, d.data())) });
  } catch (e) {
    console.error("public/class-students", e);
    res.status(500).json({ error: "Erreur lors du chargement des \xE9l\xE8ves." });
  }
});
app.post("/api/auth/student-login", async (req, res) => {
  const studentId = String(req.body?.studentId || "");
  const pin = String(req.body?.pin ?? "").trim();
  const newPin = String(req.body?.newPin ?? "").trim();
  if (!isSafeId(studentId)) return res.status(400).json({ error: "Veuillez s\xE9lectionner votre nom dans la liste." });
  if (!loginLimiter(`student:${clientIp(req)}:${studentId}`)) return res.status(429).json({ error: "Trop d'essais. R\xE9essaie dans 15 minutes." });
  try {
    const ref = adminDb.doc(`students/${studentId}`);
    const st = (await ref.get()).data();
    if (!st) return res.status(404).json({ error: "\xC9l\xE8ve introuvable. Demande \xE0 ton enseignant." });
    const teacherPin = await teacherDefaultPin(st.teacherId) || "0000";
    const currentPin = String(st.parentPin || "").trim() || teacherPin;
    if (!pin || pin !== currentPin) {
      return res.status(403).json({ error: "Mot de passe incorrect. Pour la premi\xE8re connexion, utilisez le mot de passe initial fourni par votre enseignant." });
    }
    const firstLogin = currentPin === teacherPin || currentPin === "0000" || st.isPinChanged !== true;
    if (firstLogin) {
      if (!newPin) return res.json({ needsNewPin: true });
      if (newPin.length < 4) return res.status(400).json({ error: "Le mot de passe doit comporter au moins 4 caract\xE8res." });
      if (newPin === "0000") return res.status(400).json({ error: 'Choisissez un mot de passe personnel diff\xE9rent de "0000".' });
      if (newPin === currentPin || newPin === teacherPin) {
        return res.status(400).json({ error: "Choisissez un mot de passe personnel diff\xE9rent de votre mot de passe initial." });
      }
      await ref.set({ parentPin: newPin, isPinChanged: true }, { merge: true });
    }
    const token = await adminAuth.createCustomToken(`eleve_${import_crypto.default.createHash("sha256").update(studentId).digest("hex").slice(0, 40)}`, {
      role: "student",
      studentId,
      classId: String(st.classId || ""),
      teacherId: String(st.teacherId || "")
    });
    res.json({ token, student: publicStudent(studentId, st) });
  } catch (e) {
    console.error("student-login", e);
    res.status(500).json({ error: "Erreur de connexion. R\xE9essaie." });
  }
});
app.post("/api/parent/link", async (req, res) => {
  const studentId = String(req.body?.studentId || "");
  const pin = String(req.body?.pin ?? "").trim();
  const newPin = String(req.body?.newPin ?? "").trim();
  if (!isSafeId(studentId)) return res.status(400).json({ error: "Veuillez choisir l'\xE9l\xE8ve dans la liste." });
  if (!loginLimiter(`parent:${clientIp(req)}:${studentId}`)) return res.status(429).json({ error: "Trop d'essais. R\xE9essayez dans 15 minutes." });
  try {
    const caller = await readCaller(req);
    const ref = adminDb.doc(`students/${studentId}`);
    const st = (await ref.get()).data();
    if (!st) return res.status(404).json({ error: "\xC9l\xE8ve introuvable." });
    const suivi = await empreintesSuivi(studentId);
    const currentPin = String(st.parentPin || "").trim() || "0000";
    if (suivi.length) {
      if (!pin || !suivi.some((e) => verifierEmpreinteSuivi(pin, e))) {
        return res.status(403).json({ error: "Mot de passe incorrect. Utilisez le mot de passe parent re\xE7u par e-mail de l'\xE9tablissement." });
      }
    } else if (!pin || pin !== currentPin) {
      return res.status(403).json({ error: "Mot de passe incorrect. Pour une premi\xE8re connexion, le mot de passe est '0000'." });
    }
    let finalPin = currentPin;
    if (!suivi.length && currentPin === "0000") {
      if (!newPin) return res.json({ needsNewPin: true });
      if (newPin.length < 4) return res.status(400).json({ error: "Le mot de passe doit contenir au moins 4 caract\xE8res." });
      if (newPin === "0000") return res.status(400).json({ error: 'Veuillez choisir un mot de passe diff\xE9rent de "0000".' });
      finalPin = newPin;
    }
    const emailParent = caller && !caller.role && caller.email ? caller.email : "";
    if (suivi.length) {
      if (emailParent) await ref.set({ parentEmail: emailParent }, { merge: true });
    } else await ref.set({ parentPin: finalPin, isPinChanged: true, ...emailParent ? { parentEmail: emailParent } : {} }, { merge: true });
    if (emailParent) return res.json({ linked: true });
    const previous = caller?.role === "parent" && Array.isArray(caller.parentOf) ? caller.parentOf.filter(isSafeId) : [];
    const parentOf = Array.from(/* @__PURE__ */ new Set([...previous.filter((id) => id !== studentId), studentId])).slice(-10);
    const uid = caller?.role === "parent" ? caller.uid : `parent_${import_crypto.default.randomBytes(12).toString("hex")}`;
    const token = await adminAuth.createCustomToken(uid, { role: "parent", parentOf });
    res.json({ linked: true, token });
  } catch (e) {
    console.error("parent/link", e);
    res.status(500).json({ error: "Erreur lors du rattachement. R\xE9essayez." });
  }
});
function isParentOf(t, st, studentId) {
  if (t.role === "parent") return Array.isArray(t.parentOf) && t.parentOf.includes(studentId);
  return !t.role && !!t.email && String(st?.parentEmail || "").toLowerCase() === t.email.toLowerCase();
}
app.post("/api/parent/child-pin", async (req, res) => {
  const t = await readCaller(req);
  if (!t) return res.status(401).json({ error: "Rattachez d'abord votre enfant." });
  const studentId = String(req.body?.studentId || "");
  const newPin = String(req.body?.newPin ?? "").trim();
  if (!isSafeId(studentId)) return res.status(400).json({ error: "\xC9l\xE8ve introuvable." });
  if (newPin.length < 4) return res.status(400).json({ error: "Le mot de passe doit comporter au moins 4 caract\xE8res." });
  try {
    const ref = adminDb.doc(`students/${studentId}`);
    const st = (await ref.get()).data();
    if (!st || !isParentOf(t, st, studentId)) return res.status(403).json({ error: "Cet \xE9l\xE8ve n'est pas rattach\xE9 \xE0 votre espace." });
    await ref.set({ parentPin: newPin, isPinChanged: true }, { merge: true });
    res.json({ success: true });
  } catch (e) {
    console.error("parent/child-pin", e);
    res.status(500).json({ error: "Erreur d'enregistrement." });
  }
});
app.post("/api/teacher/default-pin", requireTeacher(), async (req, res) => {
  const t = req.caller;
  try {
    const ref = adminDb.doc(`users/${t.uid}`);
    const existing = String((await ref.get()).data()?.defaultStudentPin || "").trim();
    if (existing) return res.json({ pin: existing });
    const all = await adminDb.collection("users").get();
    const used = new Set(all.docs.map((d) => String(d.data()?.defaultStudentPin || "")).filter(Boolean));
    let pin = "";
    for (let i = 0; i < 1e3 && !pin; i++) {
      const p = String(import_crypto.default.randomInt(1e3, 1e4));
      if (p !== "0000" && !used.has(p)) pin = p;
    }
    if (!pin) pin = String(import_crypto.default.randomInt(1e3, 1e4));
    await ref.set({ defaultStudentPin: pin }, { merge: true });
    res.json({ pin });
  } catch (e) {
    console.error("teacher/default-pin", e);
    res.status(500).json({ error: "Erreur lors de la cr\xE9ation du code." });
  }
});
app.post("/api/ai/generate", requireTeacher(), async (req, res) => {
  const t = req.caller;
  const limiterOk = aiTeacherLimiter(`t:${t.uid}`);
  if (!limiterOk) return res.status(429).json({ code: "QUOTA_EXCEEDED", error: "Trop de demandes \xE0 l'IA en peu de temps. Patiente quelques minutes." });
  const genAI = getAI();
  if (!genAI) return res.status(500).json({ error: "Cl\xE9 GEMINI_API_KEY non configur\xE9e sur le serveur." });
  const { contents, config } = req.body || {};
  if (!contents) return res.status(400).json({ error: "Demande vide." });
  if (JSON.stringify(contents).length > 4e4) return res.status(400).json({ error: "Texte trop long : limitez-le \xE0 30 000 caract\xE8res environ." });
  const credit = await reserveCredit(t);
  if (!credit) {
    return res.status(402).json({
      code: "NO_CREDIT",
      error: "Votre cr\xE9dit IA est \xE9puis\xE9. Rechargez-le depuis le bouton \xAB Cr\xE9dits IA \xBB de l'Espace Enseignant."
    });
  }
  res.on("finish", () => {
    if (res.statusCode >= 400) credit.refund();
  });
  const finalConfig = {};
  if (config && typeof config === "object") {
    for (const k of ALLOWED_CONFIG_KEYS) if (k in config) finalConfig[k] = config[k];
  }
  const chain = Array.from(/* @__PURE__ */ new Set([AI_MODEL, AI_FALLBACK_MODEL]));
  let lastError = null;
  for (const candidate of chain) {
    try {
      const r = await genAI.models.generateContent({
        model: candidate,
        contents,
        config: Object.keys(finalConfig).length > 0 ? finalConfig : void 0
      });
      if (typeof r?.text === "string") return res.json({ text: r.text, modelUsed: candidate });
    } catch (err) {
      lastError = err;
      console.warn(`[IA] \xE9chec avec ${candidate} : ${err?.message || err}`);
      if (!isOverload(err)) break;
    }
  }
  const msg = String(lastError?.message || lastError || "");
  if (msg.includes("prepayment credits") || lastError?.status === 402) {
    return res.status(402).json({ code: "CREDITS_DEPLETED", error: "Cr\xE9dits Google \xE9puis\xE9s : pr\xE9venez l'administrateur." });
  }
  if (isOverload(lastError)) {
    return res.status(429).json({ code: "QUOTA_EXCEEDED", error: "L'IA est tr\xE8s demand\xE9e en ce moment. R\xE9essayez dans une minute." });
  }
  res.status(500).json({ error: "Erreur lors de la g\xE9n\xE9ration IA." });
});
var billingConfigCache = null;
async function getBillingConfig() {
  if (billingConfigCache && Date.now() - billingConfigCache.at < 3e4) return billingConfigCache.cfg;
  const snap = await adminDb.doc("appConfig/billing").get();
  const cfg = snap.exists ? sanitizeBillingConfig(snap.data()) : DEFAULT_BILLING_CONFIG;
  billingConfigCache = { cfg, at: Date.now() };
  return cfg;
}
function payingTeacherId(t) {
  return t.role ? null : t.uid;
}
var adminTeacherCache = /* @__PURE__ */ new Map();
async function isAdminTeacher(teacherId) {
  const hit = adminTeacherCache.get(teacherId);
  if (hit && Date.now() - hit.at < 10 * 60 * 1e3) return hit.admin;
  const u = (await adminDb.doc(`users/${teacherId}`).get()).data() || {};
  const admin = ADMIN_UIDS.includes(teacherId) || !!u.email && ADMIN_EMAILS.includes(String(u.email).toLowerCase());
  adminTeacherCache.set(teacherId, { admin, at: Date.now() });
  return admin;
}
async function applyCreditPayment(session) {
  const meta = session.metadata || {};
  const teacherId = String(meta.teacherId || "");
  const credits = parseInt(String(meta.credits || "0"), 10);
  if (!isAppPayment(meta) || !isSafeId(teacherId) || !(credits > 0)) {
    throw new Error("Ce paiement n'est pas une recharge de cr\xE9dits des Mots M\xEAl\xE9s IA.");
  }
  if (session.payment_status !== "paid") return { applied: false, credits: 0, teacherId };
  const cfg = await getBillingConfig();
  const ref = adminDb.doc(`billing/${teacherId}`);
  const payRef = adminDb.doc(`billing/${teacherId}/payments/${session.id}`);
  const applied = await adminDb.runTransaction(async (tx) => {
    const pay = await tx.get(payRef);
    if (pay.exists) return false;
    const snap = await tx.get(ref);
    const current = snap.exists ? Number(snap.data()?.credits || 0) : cfg.freeCredits;
    tx.set(ref, {
      credits: current + credits,
      purchased: import_firestore.FieldValue.increment(credits),
      updatedAt: Date.now(),
      ...snap.exists ? {} : { freeCreditsGranted: cfg.freeCredits, createdAt: Date.now() }
    }, { merge: true });
    tx.set(payRef, { credits, amountEur: (session.amount_total || 0) / 100, at: Date.now() });
    return true;
  });
  return { applied, credits, teacherId };
}
var lastStripeSync = /* @__PURE__ */ new Map();
async function syncStripePayments(teacherId) {
  const stripe = getStripe();
  if (!stripe) return;
  const key = teacherId || "*";
  const now = Date.now();
  if (now - (lastStripeSync.get(key) || 0) < 2e4) return;
  lastStripeSync.set(key, now);
  try {
    const since = Math.floor(now / 1e3) - 30 * 24 * 3600;
    for await (const session of stripe.checkout.sessions.list({ created: { gte: since }, status: "complete", limit: 100 })) {
      const meta = session.metadata || {};
      if (!isAppPayment(meta) || session.payment_status !== "paid") continue;
      if (teacherId && meta.teacherId !== teacherId) continue;
      await applyCreditPayment(session).catch((err) => console.error("Credit sync error:", err?.message));
    }
  } catch (err) {
    console.error("Stripe payments sync error:", err?.message);
  }
}
async function reserveCredit(t) {
  const noop = { refund: () => {
  } };
  try {
    const cfg = await getBillingConfig();
    if (!cfg.enabled) return noop;
    if (cfg.adminsExempt && isAdminEmail(t)) return noop;
    const teacherId = payingTeacherId(t);
    if (!teacherId) return noop;
    if (cfg.adminsExempt && await isAdminTeacher(teacherId)) return noop;
    const ref = adminDb.doc(`billing/${teacherId}`);
    const reserved = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const credits = snap.exists ? Number(snap.data()?.credits || 0) : cfg.freeCredits;
      if (credits < 1) return false;
      tx.set(ref, {
        credits: credits - 1,
        used: import_firestore.FieldValue.increment(1),
        updatedAt: Date.now(),
        ...snap.exists ? {} : { freeCreditsGranted: cfg.freeCredits, createdAt: Date.now() }
      }, { merge: true });
      return true;
    });
    if (!reserved) return null;
    return {
      refund: () => {
        ref.set({ credits: import_firestore.FieldValue.increment(1), used: import_firestore.FieldValue.increment(-1) }, { merge: true }).catch((err) => console.error("AI credit refund error:", err));
      }
    };
  } catch (err) {
    console.error("AI credit check error:", err);
    return noop;
  }
}
// Porte de liaison avec Suivi (comme les Mots crois\xE9s) : SUIVI_CLE dans cPanel = SUIVI_CLE_MOTSMELES dans Suivi.
async function classesDeEnseignants(ids) {
  const snaps = await Promise.all(ids.map((id) => adminDb.collection("classes").where("teacherId", "==", id).get()));
  return new Map(snaps.flatMap((s) => s.docs).map((d) => [d.id, String(d.data().name || "")]));
}
var SUIVI_CLE = String(process.env.SUIVI_CLE || "").trim();
var EMPREINTE_SUIVI = /^scrypt:[0-9a-f]{32}:[0-9a-f]{64}$/;
var suiviLimiter = makeLimiter(30, 15 * 60 * 1e3);
async function empreintesSuivi(studentId) {
  if (!isSafeId(studentId)) return [];
  const p = (await adminDb.doc(`suivi_parents/${studentId}`).get()).data();
  return [p?.p1?.empreinte, p?.p2?.empreinte].filter((e) => typeof e === "string" && EMPREINTE_SUIVI.test(e));
}
function verifierEmpreinteSuivi(motDePasse, e) {
  const [, sel, attendue] = e.split(":");
  return import_crypto.default.timingSafeEqual(import_crypto.default.scryptSync(motDePasse, Buffer.from(sel, "hex"), 32), Buffer.from(attendue, "hex"));
}
async function exigerSuivi(req, res) {
  if (!SUIVI_CLE) {
    res.status(404).json({ error: "Liaison avec Suivi non configur\xE9e." });
    return null;
  }
  const recue = import_crypto.default.createHash("sha256").update(String(req.headers["x-suivi-cle"] || "")).digest();
  const attendue = import_crypto.default.createHash("sha256").update(SUIVI_CLE).digest();
  if (!import_crypto.default.timingSafeEqual(recue, attendue)) {
    res.status(suiviLimiter(`suivi:${clientIp(req)}`) ? 401 : 429).json({ error: "Cl\xE9 de liaison incorrecte." });
    return null;
  }
  const email = String(req.query.email ?? req.body?.email ?? "").trim().toLowerCase().slice(0, 200);
  if (!email) return [];
  const snap = await adminDb.collection("users").where("email", "==", email).get();
  return snap.docs.filter((d) => ["teacher", "admin"].includes(d.data().role)).map((d) => ({ id: d.id, data: d.data() }));
}
var nomEnseignant = (u) => String(u?.name || u?.displayName || [u?.firstName, u?.lastName].filter(Boolean).join(" ") || "");
app.get("/api/suivi/enseignant", async (req, res) => {
  try {
    const comptes = await exigerSuivi(req, res);
    if (!comptes) return;
    res.json({ teacher: comptes[0] ? { id: comptes[0].id, name: nomEnseignant(comptes[0].data) } : null });
  } catch (e) {
    console.error("suivi/enseignant", e);
    res.status(500).json({ error: "Erreur de lecture." });
  }
});
app.get("/api/suivi/donnees", async (req, res) => {
  try {
    const comptes = await exigerSuivi(req, res);
    if (!comptes) return;
    if (!comptes.length) return res.status(404).json({ error: "Aucun enseignant avec cette adresse." });
    const ids = comptes.map((c) => c.id);
    const classes = await classesDeEnseignants(ids);
    const cles = [...classes.keys()];
    const morceaux = (l) => Array.from({ length: Math.ceil(l.length / 30) }, (_, i) => l.slice(i * 30, i * 30 + 30));
    const [eleves, grilles, scores] = await Promise.all([
      Promise.all(ids.map((id) => adminDb.collection("students").where("teacherId", "==", id).get())).then((l) => l.flatMap((s) => s.docs)),
      Promise.all([
        ...ids.map((id) => adminDb.collection("crosswords").where("teacherId", "==", id).get()),
        ...morceaux(cles).map((m) => adminDb.collection("crosswords").where("assignedClasses", "array-contains-any", m).get())
      ]).then((l) => l.flatMap((s) => s.docs)),
      Promise.all(morceaux(cles).map((m) => adminDb.collection("scores").where("classId", "in", m).get())).then((l) => l.flatMap((s) => s.docs))
    ]);
    const parents = /* @__PURE__ */ new Map();
    for (const m of Array.from({ length: Math.ceil(eleves.length / 100) }, (_, i) => eleves.slice(i * 100, i * 100 + 100))) {
      for (const d of await adminDb.getAll(...m.map((e) => adminDb.doc(`suivi_parents/${e.id}`)))) if (d.exists) parents.set(d.id, d.data());
    }
    const titres = new Map(grilles.map((d) => [d.id, String(d.data().title || "Grille sans titre")]));
    const ms = (t) => t?.toMillis ? t.toMillis() : null;
    const codesInitiaux = /* @__PURE__ */ new Map();
    for (const id of new Set(eleves.map((d) => String(d.data().teacherId || "")))) codesInitiaux.set(id, await teacherDefaultPin(id));
    res.json({
      app: "motsmeles",
      teacher: { id: comptes[0].id, name: nomEnseignant(comptes[0].data) },
      classes: [...classes.entries()].map(([id, name]) => ({ id, name })),
      students: eleves.map((d) => {
        const s = d.data(), p = parents.get(d.id);
        return {
          id: d.id,
          name: String(s.name || ""),
          classId: String(s.classId || ""),
          className: classes.get(String(s.classId || "")) || "",
          provisionalPassword: s.isPinChanged !== true,
          parentPasswords: [p?.p1 ? 1 : 0, p?.p2 ? 2 : 0].filter(Boolean),
          // Tant que l'élève n'a pas choisi son mot de passe : son mot de passe initial (même calcul qu'à la connexion),
          // rappelé par le Séquenceur (par Suivi).
          ...s.isPinChanged === true ? {} : { code: String(s.parentPin || "").trim() || codesInitiaux.get(String(s.teacherId || "")) || "0000", codeLibelle: "Mot de passe initial (premi\xE8re connexion)" }
        };
      }).filter((s) => s.name),
      exercises: [...titres.entries()].map(([id, title]) => ({ id, title })),
      // Score cumulé des quatre niveaux, sur 20.
      results: scores.map((d) => ({ id: d.id, ...d.data() })).filter((sc) => sc.studentId && sc.crosswordId).map((sc) => {
        const note = Math.max(0, Math.min(20, Number(sc.cumulative) || 0));
        return {
          id: sc.id,
          studentId: String(sc.studentId),
          exerciseId: String(sc.crosswordId),
          exerciseTitle: titres.get(sc.crosswordId) || "",
          percent: note * 5,
          score: `${note}/20`,
          completedAt: ms(sc.updatedAt) ?? ms(sc.createdAt)
        };
      }),
      serverTime: Date.now()
    });
  } catch (e) {
    console.error("suivi/donnees", e);
    res.status(500).json({ error: "Erreur de lecture." });
  }
});
app.post("/api/suivi/mot-de-passe-parent", async (req, res) => {
  try {
    const comptes = await exigerSuivi(req, res);
    if (!comptes) return;
    if (!comptes.length) return res.status(404).json({ error: "Aucun enseignant avec cette adresse." });
    const studentId = String(req.body?.studentId || "");
    const parent = Number(req.body?.parent);
    const empreinte = req.body?.empreinte === null ? null : String(req.body?.empreinte || "");
    if (!isSafeId(studentId) || parent !== 1 && parent !== 2) return res.status(400).json({ error: "\xC9l\xE8ve ou parent incorrect." });
    if (empreinte !== null && !EMPREINTE_SUIVI.test(empreinte)) return res.status(400).json({ error: "Empreinte incorrecte." });
    const st = (await adminDb.doc(`students/${studentId}`).get()).data();
    if (!st || !comptes.some((c) => c.id === st.teacherId)) return res.status(404).json({ error: "\xC9l\xE8ve introuvable chez cet enseignant." });
    await adminDb.doc(`suivi_parents/${studentId}`).set({
      teacherId: String(st.teacherId),
      [`p${parent}`]: empreinte === null ? import_firestore.FieldValue.delete() : { empreinte, at: import_firestore.FieldValue.serverTimestamp() }
    }, { merge: true });
    res.json({ ok: true });
  } catch (e) {
    console.error("suivi/mot-de-passe-parent", e);
    res.status(500).json({ error: "Erreur d'enregistrement." });
  }
});
app.get("/api/billing/me", requireTeacher(), async (req, res) => {
  const t = req.caller;
  try {
    const cfg = await getBillingConfig();
    const teacherId = t.uid;
    if (cfg.enabled) await syncStripePayments(teacherId);
    let credits = cfg.freeCredits, used = 0;
    const snap = await adminDb.doc(`billing/${teacherId}`).get();
    if (snap.exists) {
      credits = Number(snap.data()?.credits || 0);
      used = Number(snap.data()?.used || 0);
    }
    res.json({
      enabled: cfg.enabled,
      exempt: cfg.adminsExempt && (isAdminEmail(t) || await isAdminTeacher(teacherId)),
      credits,
      used,
      pricePerCorrectionEur: cfg.pricePerCorrectionEur,
      stripeFixedEur: cfg.stripeFixedEur,
      stripePercent: cfg.stripePercent,
      packs: cfg.packsEur.map((eur) => packBreakdown(eur, cfg)),
      paymentConfigured: !!getStripe()
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Erreur de lecture du cr\xE9dit." });
  }
});
app.post("/api/billing/checkout", requireTeacher(), async (req, res) => {
  const t = req.caller;
  const cfg = await getBillingConfig();
  const eur = Number(req.body?.eur);
  if (!cfg.packsEur.includes(eur)) return res.status(400).json({ error: "Montant de recharge inconnu." });
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: "Le paiement en ligne n'est pas encore configur\xE9." });
  const pack = packBreakdown(eur, cfg);
  try {
    const origin = process.env.APP_URL || req.headers.origin || `http://localhost:${PORT}`;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "eur",
          product_data: {
            name: `Mots M\xEAl\xE9s IA : ${pack.corrections} cr\xE9dits IA`,
            description: `Recharge de ${eur} \u20AC (dont ${pack.stripeFeeEur.toFixed(2)} \u20AC de frais de paiement)`
          },
          unit_amount: Math.round(eur * 100)
        },
        quantity: 1
      }],
      customer_email: t.email || void 0,
      success_url: `${origin}/?credits_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?credits_cancelled=true`,
      metadata: { app: STRIPE_APP, kind: STRIPE_KIND, teacherId: t.uid, credits: String(pack.corrections), eur: String(eur) }
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe credits checkout error:", err);
    res.status(500).json({ error: err.message || "Erreur lors de la cr\xE9ation du paiement." });
  }
});
app.post("/api/billing/confirm", requireTeacher(), async (req, res) => {
  const t = req.caller;
  const sessionId = String(req.body?.sessionId || "");
  const stripe = getStripe();
  if (!stripe || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return res.status(400).json({ error: "Paiement introuvable." });
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.teacherId !== t.uid && !isAdminEmail(t)) {
      return res.status(403).json({ error: "Ce paiement appartient \xE0 un autre compte." });
    }
    const result = await applyCreditPayment(session);
    res.json({ success: true, paid: session.payment_status === "paid", ...result });
  } catch (err) {
    res.status(500).json({ error: err.message || "Erreur de v\xE9rification du paiement." });
  }
});
app.get("/api/admin/billing", requireAdmin(), async (_req, res) => {
  try {
    billingConfigCache = null;
    const cfg = await getBillingConfig();
    await syncStripePayments(null);
    const [usersSnap, billingSnap] = await Promise.all([
      adminDb.collection("users").where("role", "in", ["teacher", "admin"]).get(),
      adminDb.collection("billing").get()
    ]);
    const balances = new Map(billingSnap.docs.map((d) => [d.id, d.data()]));
    const teachers = usersSnap.docs.map((d) => {
      const b = balances.get(d.id);
      return {
        teacherId: d.id,
        name: d.data()?.name || d.data()?.email || d.id,
        email: d.data()?.email || "",
        credits: b ? Number(b.credits || 0) : null,
        used: b ? Number(b.used || 0) : 0,
        purchased: b ? Number(b.purchased || 0) : 0
      };
    }).sort((a, b) => b.used - a.used || String(a.name).localeCompare(String(b.name)));
    res.json({ config: cfg, teachers, paymentConfigured: !!getStripe() });
  } catch (err) {
    res.status(500).json({ error: err.message || "Erreur de lecture." });
  }
});
app.post("/api/admin/billing/config", requireAdmin(), async (req, res) => {
  try {
    const cfg = sanitizeBillingConfig(req.body?.config);
    await adminDb.doc("appConfig/billing").set({ ...cfg, updatedAt: Date.now() });
    billingConfigCache = { cfg, at: Date.now() };
    res.json({ success: true, config: cfg });
  } catch (err) {
    res.status(500).json({ error: err.message || "Erreur d'enregistrement." });
  }
});
app.post("/api/admin/billing/grant", requireAdmin(), async (req, res) => {
  const teacherId = String(req.body?.teacherId || "");
  const credits = Math.round(Number(req.body?.credits));
  if (!isSafeId(teacherId) || !Number.isFinite(credits) || credits === 0 || Math.abs(credits) > 1e5) {
    return res.status(400).json({ error: "Nombre de cr\xE9dits invalide." });
  }
  try {
    const cfg = await getBillingConfig();
    const ref = adminDb.doc(`billing/${teacherId}`);
    const total = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? Number(snap.data()?.credits || 0) : cfg.freeCredits;
      const next = Math.max(0, current + credits);
      tx.set(ref, { credits: next, updatedAt: Date.now(), ...snap.exists ? {} : { freeCreditsGranted: cfg.freeCredits, createdAt: Date.now() } }, { merge: true });
      return next;
    });
    res.json({ success: true, credits: total });
  } catch (err) {
    res.status(500).json({ error: err.message || "Erreur d'enregistrement." });
  }
});
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Route inconnue." });
});
async function startServer() {
  const webConfig = { ...appletConfig, ...readJsonFile("firebase-web-config.json") || {}, firestoreDatabaseId: databaseId };
  delete webConfig.recaptchaSiteKey;
  if (process.env.USE_FIREBASE_EMULATORS === "1") {
    webConfig.emulators = { host: "127.0.0.1", firestorePort: 8080, authPort: 9099 };
    webConfig.projectId = projectId;
  }
  const configScript = `<script>window.__FIREBASE_CONFIG__=${JSON.stringify(webConfig).replace(/</g, "\\u003c")};</script>`;
  const isProduction = process.env.NODE_ENV === "production" || /server\.cjs$/.test(process.argv[1] || "");
  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "custom" });
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      try {
        const raw = import_fs.default.readFileSync(import_path.default.join(process.cwd(), "index.html"), "utf8");
        const html = await vite.transformIndexHtml(req.originalUrl, raw.replace("<head>", `<head>${configScript}`));
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
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
    app.get(["/server.cjs", "/server.cjs.map"], (_req, res) => {
      res.status(404).end();
    });
    app.use(import_express.default.static(distPath, { index: false }));
    app.get("*", sendIndex);
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Mots M\xEAl\xE9s IA : serveur sur le port ${PORT} (projet ${projectId}, base ${databaseId})`);
  });
}
startServer();
