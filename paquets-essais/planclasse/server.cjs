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
var ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || "alimatlea@gmail.com").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
var APP_VERSION = "2026-10-20.5";
var PLANS = "publishedPlans";
var SECRETS = "planSecrets";
var TEACHERS = "teachers";
var PHOTOS = "studentPhotos";
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
  return typeof v === "string" && v.length > 0 && v.length <= 300 && !v.includes("/") && v !== "." && v !== "..";
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
var loginLimiter = makeLimiter(10, 5 * 60 * 1e3);
var publicLimiter = makeLimiter(240, 60 * 1e3);
var seatLimiter = makeLimiter(60, 60 * 1e3);
var aiTeacherLimiter = makeLimiter(Number(process.env.AI_MAX_PER_TEACHER_15MIN) || 300, 15 * 60 * 1e3);
var norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
var planClasses = (className) => String(className || "").split(",").map(norm).filter(Boolean);
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
  return !!t.email && t.email_verified === true && ADMIN_EMAILS.includes(t.email.toLowerCase());
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
    if (!t.email) return res.status(403).json({ error: "R\xE9serv\xE9 aux enseignants." });
    req.caller = t;
    next();
  };
}
var PORTAL_SECRET = process.env.PORTAL_SECRET || import_crypto.default.createHash("sha256").update(`plan-classe:${serviceAccount?.private_key || projectId || "local"}`).digest("hex");
function signPortal(p) {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  const sig = import_crypto.default.createHmac("sha256", PORTAL_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function readPortal(req) {
  const h = String(req.headers.authorization || "");
  const tok = h.startsWith("Portal ") ? h.slice(7).trim() : "";
  const [body, sig] = tok.split(".");
  if (!body || !sig) return null;
  const expected = import_crypto.default.createHmac("sha256", PORTAL_SECRET).update(body).digest("base64url");
  if (sig.length !== expected.length || !import_crypto.default.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}
var planCache = /* @__PURE__ */ new Map();
function watchPlan(planId) {
  const hit = planCache.get(planId);
  if (hit) {
    hit.lastUse = Date.now();
    return hit;
  }
  let resolvePlan, resolveSecret;
  const entry = {
    plan: null,
    secret: null,
    lastUse: Date.now(),
    unsub: () => {
    },
    ready: Promise.all([new Promise((r) => resolvePlan = r), new Promise((r) => resolveSecret = r)]).then(() => {
    })
  };
  const u1 = adminDb.doc(`${PLANS}/${planId}`).onSnapshot(
    (s) => {
      entry.plan = s.exists ? s.data() : null;
      resolvePlan();
    },
    (e) => {
      console.error("plan", planId, e.message);
      resolvePlan();
    }
  );
  const u2 = adminDb.doc(`${SECRETS}/${planId}`).onSnapshot(
    (s) => {
      entry.secret = s.exists ? s.data() : null;
      resolveSecret();
    },
    (e) => {
      console.error("secret", planId, e.message);
      resolveSecret();
    }
  );
  entry.unsub = () => {
    u1();
    u2();
  };
  planCache.set(planId, entry);
  return entry;
}
setInterval(() => {
  const limit = Date.now() - 10 * 60 * 1e3;
  for (const [id, e] of planCache) if (e.lastUse < limit) {
    e.unsub();
    planCache.delete(id);
  }
}, 60 * 1e3).unref();
async function getPlan(planId) {
  const e = watchPlan(planId);
  await e.ready;
  return { plan: e.plan, secret: e.secret };
}
var placementsOf = (plan) => {
  const raw = plan?.placements;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (raw && typeof raw === "object") return Object.values(raw).filter(Boolean);
  return [];
};
var passwordEntry = (secret, plan, studentId) => {
  const fromSecret = secret?.studentPasswords?.[String(studentId)];
  const legacy = plan?.studentPasswords?.[String(studentId)];
  const e = fromSecret || legacy || { password: "0000", isDefault: true };
  return { password: String(e.password || "0000"), isDefault: e.isDefault !== false };
};
function portalStudentIn(tok, plan) {
  if (!plan || String(plan.teacherId || "") !== tok.t) return null;
  if (!planClasses(plan.className).some((c) => tok.c.includes(c))) return null;
  return placementsOf(plan).find((p) => norm(p.name) === tok.n) || null;
}
function remarksFor(secret, plan, student) {
  const all = secret?.studentRemarks || plan?.studentRemarks || {};
  const keys = [String(student.name || "").trim().toLowerCase(), `id_${student.id}`, String(student.id)];
  for (const k of keys) if (Array.isArray(all[k])) return all[k];
  return [];
}
var teacherNames = /* @__PURE__ */ new Map();
async function teacherDisplayName(teacherId, fallback) {
  const hit = teacherNames.get(teacherId);
  if (hit && Date.now() - hit.at < 5 * 60 * 1e3) return hit.name || fallback;
  let name = "";
  try {
    const t = (await adminDb.doc(`${TEACHERS}/${teacherId}`).get()).data();
    name = [t?.firstName, t?.lastName].filter(Boolean).join(" ").trim();
  } catch {
  }
  teacherNames.set(teacherId, { name, at: Date.now() });
  return name || fallback;
}
async function portalView(planId, plan, secret, me) {
  return {
    id: planId,
    teacherId: String(plan.teacherId || ""),
    teacherName: await teacherDisplayName(String(plan.teacherId || ""), String(plan.teacherName || "")),
    className: String(plan.className || ""),
    period: String(plan.period || ""),
    isFrozen: plan.isFrozen === true,
    isPast: plan.isPast === true || plan.isPastPlan === true,
    allowStudentSelfPlacement: plan.allowStudentSelfPlacement === true,
    gridDimensions: plan.gridDimensions || { rows: 5, cols: 6 },
    unavailableCells: Array.isArray(plan.unavailableCells) ? plan.unavailableCells : [],
    cellObstacles: plan.cellObstacles || {},
    placements: placementsOf(plan).map((p) => ({
      id: p.id,
      name: String(p.name || ""),
      ...p.rollNumber ? { rollNumber: String(p.rollNumber) } : {},
      ...p.photoUrl ? { photoUrl: String(p.photoUrl) } : {},
      location: p.location ?? "bank"
    })),
    studentRemarks: { [String(me.name || "").trim().toLowerCase()]: remarksFor(secret, plan, me) },
    myStudentId: me.id,
    updatedAt: String(plan.updatedAt || "")
  };
}
var app = (0, import_express.default)();
app.set("trust proxy", true);
var STRIPE_APP = "planclasse";
var STRIPE_KIND = "planclasse_credits";
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
app.use(import_express.default.json({ limit: "25mb" }));
app.get("/api/health", async (req, res) => {
  if (req.query.db === void 0) return res.json({ status: "ok" });
  const cle = process.env.FIREBASE_SERVICE_ACCOUNT ? "variable FIREBASE_SERVICE_ACCOUNT" : serviceAccount ? "fichier service-account.json" : "introuvable";
  try {
    const [plans, teachers] = await Promise.all([
      adminDb.collection(PLANS).select("teacherId", "className").get(),
      adminDb.collection(TEACHERS).select().get()
    ]);
    const known = new Set(teachers.docs.map((d) => d.id));
    const ids = plans.docs.map((d) => String(d.data().teacherId || ""));
    res.json({
      status: "ok",
      version: APP_VERSION,
      cle,
      base: databaseId,
      acces: "ok",
      plans: plans.size,
      plansSansEnseignant: ids.filter((id) => !id).length,
      plansEnseignantInconnu: ids.filter((id) => id && !known.has(id)).length,
      enseignants: teachers.size
    });
  } catch (e) {
    res.json({ status: "erreur", version: APP_VERSION, cle, base: databaseId, dossier: process.cwd(), acces: String(e?.message || e).slice(0, 300) });
  }
});
var directoryCache = null;
app.get("/api/public/directory", async (req, res) => {
  if (!publicLimiter(clientIp(req))) return res.status(429).json({ error: "Trop de demandes, patientez une minute." });
  try {
    if (!directoryCache || Date.now() - directoryCache.at > 20 * 1e3) {
      const snap = await adminDb.collection(PLANS).select("teacherId", "teacherName", "className", "period", "isFrozen", "isPast", "isPastPlan", "allowStudentSelfPlacement", "updatedAt").get();
      const plans = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.teacherId && p.className);
      const teacherIds = Array.from(new Set(plans.map((p) => String(p.teacherId))));
      const teachers = await Promise.all(teacherIds.map(async (id) => {
        const fallback = String(plans.find((p) => p.teacherId === id)?.teacherName || "Enseignant");
        return { id, name: await teacherDisplayName(id, fallback) };
      }));
      directoryCache = {
        at: Date.now(),
        data: {
          teachers: teachers.sort((a, b) => a.name.localeCompare(b.name, "fr")),
          plans: plans.map((p) => ({
            id: p.id,
            teacherId: String(p.teacherId),
            className: String(p.className),
            period: String(p.period || ""),
            isFrozen: p.isFrozen === true,
            isPast: p.isPast === true || p.isPastPlan === true,
            allowStudentSelfPlacement: p.allowStudentSelfPlacement === true,
            updatedAt: String(p.updatedAt || "")
          }))
        }
      };
    }
    res.json(directoryCache.data);
  } catch (e) {
    console.error("public/directory", e);
    res.status(500).json({ error: "Erreur lors du chargement des classes." });
  }
});
app.get("/api/public/plan-students", async (req, res) => {
  if (!publicLimiter(clientIp(req))) return res.status(429).json({ error: "Trop de demandes, patientez une minute." });
  const planId = String(req.query.planId || "");
  if (!isSafeId(planId)) return res.json({ students: [] });
  try {
    const { plan } = await getPlan(planId);
    const students = placementsOf(plan).map((p) => ({ id: p.id, name: String(p.name || ""), ...p.rollNumber ? { rollNumber: String(p.rollNumber) } : {} })).filter((s) => s.name).sort((a, b) => a.name.localeCompare(b.name, "fr"));
    res.json({ students });
  } catch (e) {
    console.error("public/plan-students", e);
    res.status(500).json({ error: "Erreur lors du chargement des \xE9l\xE8ves." });
  }
});
app.post("/api/portal/login", async (req, res) => {
  const planId = String(req.body?.planId || "");
  const studentId = req.body?.studentId;
  const pin = String(req.body?.pin ?? "").trim();
  const newPin = String(req.body?.newPin ?? "").trim();
  const role = req.body?.role === "parent" ? "parent" : "student";
  if (!isSafeId(planId) || studentId === void 0 || studentId === null) {
    return res.status(400).json({ error: "Choisis d'abord ta classe et ton nom dans la liste." });
  }
  if (!loginLimiter(`login:${clientIp(req)}:${planId}:${studentId}`)) {
    return res.status(429).json({ error: "Trop d'essais. R\xE9essaie dans 5 minutes." });
  }
  try {
    const { plan, secret } = await getPlan(planId);
    const student = placementsOf(plan).find((p) => String(p.id) === String(studentId));
    if (!plan || !student || !plan.teacherId) return res.status(404).json({ error: "\xC9l\xE8ve introuvable. Demande \xE0 ton enseignant." });
    const entry = passwordEntry(secret, plan, student.id);
    if (!pin || pin !== entry.password) {
      return res.status(403).json({
        error: entry.isDefault ? "Mot de passe incorrect. Pour la premi\xE8re connexion, c'est \xAB 0000 \xBB ou celui donn\xE9 par ton enseignant." : "Mot de passe incorrect. En cas d'oubli, ton enseignant peut le remettre \xE0 z\xE9ro."
      });
    }
    if (entry.isDefault || entry.password === "0000") {
      if (!newPin) return res.json({ needsNewPin: true });
      if (newPin.length < 4) return res.status(400).json({ error: "Le mot de passe doit comporter au moins 4 caract\xE8res." });
      if (newPin === "0000" || newPin === entry.password) return res.status(400).json({ error: "Choisis un mot de passe personnel, diff\xE9rent du mot de passe de d\xE9part." });
      await setPasswordEverywhere(String(plan.teacherId), planClasses(plan.className), String(student.name), newPin);
    }
    const token = signPortal({
      r: role,
      t: String(plan.teacherId),
      c: planClasses(plan.className),
      n: norm(student.name),
      exp: Date.now() + (role === "parent" ? 30 : 1) * 24 * 3600 * 1e3
    });
    res.json({ token, student: { id: student.id, name: String(student.name) } });
  } catch (e) {
    console.error("portal/login", e);
    res.status(500).json({ error: "Erreur de connexion. R\xE9essaie." });
  }
});
async function setPasswordEverywhere(teacherId, classes, studentName, newPin) {
  const plans = await adminDb.collection(PLANS).where("teacherId", "==", teacherId).get();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const batch = adminDb.batch();
  for (const d of plans.docs) {
    const p = d.data();
    if (!planClasses(p.className).some((c) => classes.includes(c))) continue;
    const st = placementsOf(p).find((x) => norm(x.name) === norm(studentName));
    if (!st) continue;
    batch.set(adminDb.doc(`${SECRETS}/${d.id}`), {
      teacherId,
      studentPasswords: { [String(st.id)]: { password: newPin, isDefault: false, updatedAt: now } }
    }, { merge: true });
  }
  await batch.commit();
}
app.get("/api/portal/plan", async (req, res) => {
  const tok = readPortal(req);
  if (!tok) return res.status(401).json({ error: "Connexion expir\xE9e : reconnecte-toi." });
  const planId = String(req.query.planId || "");
  if (!isSafeId(planId)) return res.status(400).json({ error: "Plan introuvable." });
  try {
    const { plan, secret } = await getPlan(planId);
    const me = portalStudentIn(tok, plan);
    if (!plan || !me) return res.status(403).json({ error: "Ce plan n'est pas celui de ta classe." });
    if (req.query.since && String(req.query.since) === String(plan.updatedAt || "")) return res.json({ unchanged: true });
    res.json({ plan: await portalView(planId, plan, secret, me), role: tok.r });
  } catch (e) {
    console.error("portal/plan", e);
    res.status(500).json({ error: "Erreur lors du chargement du plan." });
  }
});
app.post("/api/portal/seat", async (req, res) => {
  const tok = readPortal(req);
  if (!tok || tok.r !== "student") return res.status(401).json({ error: "Connexion \xE9l\xE8ve requise." });
  if (!seatLimiter(`seat:${tok.t}:${tok.n}`)) return res.status(429).json({ error: "Trop de changements de place. Patiente une minute." });
  const planId = String(req.body?.planId || "");
  const loc = req.body?.location;
  const newLocation = loc === "bank" ? "bank" : Number(loc);
  if (!isSafeId(planId) || newLocation !== "bank" && (!Number.isInteger(newLocation) || newLocation < 0)) {
    return res.status(400).json({ error: "Place invalide." });
  }
  try {
    const ref = adminDb.doc(`${PLANS}/${planId}`);
    const result = await adminDb.runTransaction(async (tx) => {
      const plan = (await tx.get(ref)).data() || null;
      const me = portalStudentIn(tok, plan);
      if (!plan || !me) return { status: 403, error: "Ce plan n'est pas celui de ta classe." };
      if (plan.isFrozen) return { status: 409, error: "Ce plan est fig\xE9 par l'enseignant : les places ne peuvent plus changer." };
      if (!plan.allowStudentSelfPlacement) return { status: 409, error: "Le choix libre des places est d\xE9sactiv\xE9 par l'enseignant." };
      const rows = Number(plan.gridDimensions?.rows) || 5, cols = Number(plan.gridDimensions?.cols) || 6;
      if (newLocation !== "bank") {
        if (newLocation >= rows * cols) return { status: 400, error: "Place invalide." };
        if ((plan.unavailableCells || []).includes(newLocation)) return { status: 409, error: "Cet emplacement n'est pas une place." };
      }
      const list = placementsOf(plan).map((p) => ({ ...p }));
      const mine = list.find((p) => String(p.id) === String(me.id));
      const previous = mine.location;
      if (newLocation !== "bank") {
        const occupant = list.find((p) => p.location === newLocation && String(p.id) !== String(me.id));
        if (occupant) return { status: 409, error: `Cette place est d\xE9j\xE0 prise par ${occupant.name}.` };
      }
      mine.location = newLocation;
      const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      tx.update(ref, { placements: list, updatedAt });
      return { status: 200, previous, updatedAt };
    });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json({ success: true });
  } catch (e) {
    console.error("portal/seat", e);
    res.status(500).json({ error: "Erreur d'enregistrement de la place." });
  }
});
app.post("/api/ai/generate", requireTeacher(), async (req, res) => {
  const t = req.caller;
  if (!aiTeacherLimiter(`t:${t.uid}`)) return res.status(429).json({ code: "QUOTA_EXCEEDED", error: "Trop de demandes \xE0 l'IA en peu de temps. Patientez quelques minutes." });
  const genAI = getAI();
  if (!genAI) return res.status(500).json({ error: "Cl\xE9 GEMINI_API_KEY non configur\xE9e sur le serveur." });
  const { contents, config } = req.body || {};
  if (!contents) return res.status(400).json({ error: "Demande vide." });
  const credit = await reserveCredit(t);
  if (!credit) {
    return res.status(402).json({
      code: "NO_CREDIT",
      error: "Votre cr\xE9dit IA est \xE9puis\xE9. Rechargez-le avec le bouton \xAB Cr\xE9dits IA \xBB de l'Espace Enseignant."
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
async function applyCreditPayment(session) {
  const meta = session.metadata || {};
  const teacherId = String(meta.teacherId || "");
  const credits = parseInt(String(meta.credits || "0"), 10);
  if (!isAppPayment(meta) || !isSafeId(teacherId) || !(credits > 0)) {
    throw new Error("Ce paiement n'est pas une recharge de cr\xE9dits du Plan de Classe IA.");
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
    const ref = adminDb.doc(`billing/${t.uid}`);
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
app.get("/api/billing/me", requireTeacher(), async (req, res) => {
  const t = req.caller;
  try {
    const cfg = await getBillingConfig();
    if (cfg.enabled) await syncStripePayments(t.uid);
    let credits = cfg.freeCredits, used = 0;
    const snap = await adminDb.doc(`billing/${t.uid}`).get();
    if (snap.exists) {
      credits = Number(snap.data()?.credits || 0);
      used = Number(snap.data()?.used || 0);
    }
    res.json({
      enabled: cfg.enabled,
      exempt: cfg.adminsExempt && isAdminEmail(t),
      isAdmin: isAdminEmail(t),
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
    const origin = req.headers.origin || process.env.APP_URL || `http://localhost:${PORT}`;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "eur",
          product_data: {
            name: `Plan de Classe IA : ${pack.corrections} cr\xE9dits IA`,
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
    const [teachersSnap, billingSnap] = await Promise.all([
      adminDb.collection(TEACHERS).get(),
      adminDb.collection("billing").get()
    ]);
    const balances = new Map(billingSnap.docs.map((d) => [d.id, d.data()]));
    const teachers = teachersSnap.docs.map((d) => {
      const b = balances.get(d.id);
      const u = d.data() || {};
      return {
        teacherId: d.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || d.id,
        email: u.email || "",
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
app.get("/api/admin/orphan-plans", requireAdmin(), async (_req, res) => {
  const [snap, teachers] = await Promise.all([
    adminDb.collection(PLANS).select("teacherName", "className", "period", "teacherId", "updatedAt", "createdAt", "placements").get(),
    adminDb.collection(TEACHERS).select().get()
  ]);
  const known = new Set(teachers.docs.map((d) => d.id));
  const isoDate = (v) => {
    if (!v) return "";
    if (typeof v.toDate === "function") return v.toDate().toISOString();
    const t = typeof v === "number" ? v : Date.parse(String(v));
    return Number.isFinite(t) ? new Date(t).toISOString() : "";
  };
  const plans = snap.docs.filter((d) => {
    const id = String(d.data().teacherId || "");
    return !id || !known.has(id);
  }).map((d) => {
    const p = d.data();
    return {
      id: d.id,
      teacherId: p.teacherId || "",
      teacherName: p.teacherName || "",
      className: p.className || "",
      period: p.period || "",
      updatedAt: isoDate(p.updatedAt) || isoDate(p.createdAt),
      studentCount: placementsOf(p).length
    };
  });
  const accounts = /* @__PURE__ */ new Map();
  for (const p of plans) if (p.teacherId && !accounts.has(p.teacherId)) accounts.set(p.teacherId, String(p.teacherName || "Enseignant"));
  res.json({ plans, accountsWithoutProfile: Array.from(accounts, ([id, name]) => ({ id, name })) });
});
app.post("/api/admin/create-profile", requireAdmin(), async (req, res) => {
  const teacherId = String(req.body?.teacherId || "");
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!isSafeId(teacherId) || !name) return res.status(400).json({ error: "Compte ou nom invalide." });
  const ref = adminDb.doc(`${TEACHERS}/${teacherId}`);
  if ((await ref.get()).exists) return res.status(409).json({ error: "Ce profil existe d\xE9j\xE0." });
  const used = await adminDb.collection(PLANS).where("teacherId", "==", teacherId).limit(1).get();
  if (used.empty) return res.status(404).json({ error: "Aucun plan n'est li\xE9 \xE0 ce compte." });
  const civ = name.match(/^(M\.?|Mme\.?|Mr\.?|Madame|Monsieur)\s+/i);
  const email = String(used.docs[0].data().teacherEmail || "");
  await ref.set({
    uid: teacherId,
    email,
    firstName: civ ? civ[1] : "",
    lastName: civ ? name.slice(civ[0].length) : name,
    disciplines: [],
    classes: [],
    role: "teacher",
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  teacherNames.delete(teacherId);
  directoryCache = null;
  res.json({ success: true });
});
app.post("/api/admin/delete-plan", requireAdmin(), async (req, res) => {
  const planId = String(req.body?.planId || "");
  if (!isSafeId(planId)) return res.status(400).json({ error: "Plan invalide." });
  await adminDb.doc(`${PLANS}/${planId}`).delete();
  await adminDb.doc(`${SECRETS}/${planId}`).delete();
  directoryCache = null;
  res.json({ success: true });
});
app.post("/api/admin/assign-plan", requireAdmin(), async (req, res) => {
  const planId = String(req.body?.planId || "");
  const teacherId = String(req.body?.teacherId || "");
  if (!isSafeId(planId) || !isSafeId(teacherId)) return res.status(400).json({ error: "Plan ou enseignant invalide." });
  const t = await adminDb.doc(`${TEACHERS}/${teacherId}`).get();
  if (!t.exists) return res.status(404).json({ error: "Enseignant introuvable." });
  await adminDb.doc(`${PLANS}/${planId}`).set({ teacherId, teacherEmail: String(t.data()?.email || "") }, { merge: true });
  await adminDb.doc(`${SECRETS}/${planId}`).set({ teacherId }, { merge: true });
  directoryCache = null;
  res.json({ success: true });
});
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Route inconnue." });
});
async function migrateLegacyData() {
  const [plansSnap, teachersSnap] = await Promise.all([adminDb.collection(PLANS).get(), adminDb.collection(TEACHERS).get()]);
  const teachers = teachersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const byEmail = new Map(teachers.filter((t) => t.email).map((t) => [String(t.email).toLowerCase(), t.id]));
  const nameVariants = (t) => {
    const f = norm(t.firstName), l = norm(t.lastName);
    if (!l) return [];
    return [l, `${f} ${l}`, `${l} ${f}`, `m. ${l}`, `m ${l}`, `mme ${l}`, `mme. ${l}`, `mr ${l}`, `madame ${l}`, `monsieur ${l}`].map((v) => v.trim());
  };
  const byName = /* @__PURE__ */ new Map();
  for (const t of teachers) for (const v of nameVariants(t)) byName.set(v, [...byName.get(v) || [], t.id]);
  let moved = 0, assigned = 0, unassigned = 0;
  const writer = adminDb.bulkWriter();
  const studentOwners = /* @__PURE__ */ new Map();
  for (const d of plansSnap.docs) {
    const p = d.data();
    let teacherId = String(p.teacherId || "");
    const planUpdate = {};
    if (!teacherId) {
      const viaEmail = p.teacherEmail ? byEmail.get(String(p.teacherEmail).toLowerCase()) : void 0;
      const viaName = byName.get(norm(String(p.teacherName || "").replace(/\(.*?\)/g, "")));
      teacherId = viaEmail || (viaName && new Set(viaName).size === 1 ? viaName[0] : "");
      if (teacherId) {
        planUpdate.teacherId = teacherId;
        assigned++;
      } else unassigned++;
    }
    const secretRef = adminDb.doc(`${SECRETS}/${d.id}`);
    if (p.studentPasswords !== void 0 || p.studentRemarks !== void 0) {
      const existing = (await secretRef.get()).data() || {};
      writer.set(secretRef, {
        ...teacherId ? { teacherId } : {},
        studentPasswords: { ...p.studentPasswords || {}, ...existing.studentPasswords || {} },
        studentRemarks: { ...p.studentRemarks || {}, ...existing.studentRemarks || {} },
        updatedAt: String(p.updatedAt || "")
      }, { merge: true });
      planUpdate.studentPasswords = import_firestore.FieldValue.delete();
      planUpdate.studentRemarks = import_firestore.FieldValue.delete();
      moved++;
    } else if (planUpdate.teacherId) {
      writer.set(secretRef, { teacherId }, { merge: true });
    }
    if (Object.keys(planUpdate).length) writer.update(d.ref, planUpdate);
    if (teacherId) for (const s of placementsOf(p)) {
      const k = norm(s.name);
      if (!studentOwners.has(k)) studentOwners.set(k, /* @__PURE__ */ new Set());
      studentOwners.get(k).add(teacherId);
    }
  }
  let photos = 0;
  const photosSnap = await adminDb.collection(PHOTOS).get();
  for (const d of photosSnap.docs) {
    const ph = d.data();
    if (ph.teacherId) continue;
    const owners = studentOwners.get(norm(ph.name || ph.key));
    if (!owners || owners.size !== 1) continue;
    const owner = Array.from(owners)[0];
    const key = String(ph.key || norm(ph.name));
    writer.set(adminDb.doc(`${PHOTOS}/${owner}_${key.replace(/[^a-z0-9]/g, "_")}`), { ...ph, key, teacherId: owner });
    writer.delete(d.ref);
    photos++;
  }
  await writer.close();
  if (moved || assigned || unassigned || photos) {
    console.log(`Reprise des donn\xE9es : ${moved} plan(s) aux mots de passe mis \xE0 part, ${assigned} plan(s) rattach\xE9(s), ${unassigned} plan(s) sans enseignant retrouv\xE9 (visibles par l'administrateur), ${photos} photo(s) rattach\xE9e(s).`);
  }
}
async function startServer() {
  if (process.env.SKIP_MIGRATION !== "1") {
    try {
      await migrateLegacyData();
    } catch (e) {
      console.error("Reprise des donn\xE9es impossible :", e);
    }
  }
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
    app.use((req, res, next) => /^\/server\.cjs/i.test(req.path) ? res.status(404).end() : next());
    app.use(import_express.default.static(distPath, { index: false }));
    app.get("*", sendIndex);
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Plan de Classe IA : serveur sur le port ${PORT} (projet ${projectId}, base ${databaseId})`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
