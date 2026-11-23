"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/evaliaMoyenne.ts
var evaliaMoyenne_exports = {};
__export(evaliaMoyenne_exports, {
  COEF_CHATBOT: () => COEF_CHATBOT,
  COEF_QUIZ: () => COEF_QUIZ,
  colonnesFusionnees: () => colonnesFusionnees,
  fusionnerEvalIA: () => fusionnerEvalIA,
  themesEvalIA: () => themesEvalIA
});
module.exports = __toCommonJS(evaliaMoyenne_exports);

// lib/bulletin.ts
var plusRecent = (liste) => liste.reduce((m, x) => (x.at ?? 0) >= (m.at ?? 0) ? x : m);
var meilleur = (liste) => liste.reduce((m, x) => x.percent !== m.percent ? x.percent > m.percent ? x : m : !!x.provisoire !== !!m.provisoire ? x.provisoire ? m : x : (x.at ?? 0) >= (m.at ?? 0) ? x : m);
function essaiQuiCompte(essais) {
  if (!essais.length) return null;
  const manuelles = essais.filter((e) => e.manuelle), appli = essais.filter((e) => !e.manuelle);
  if (!manuelles.length || !appli.length) return meilleur(essais);
  const m = plusRecent(manuelles);
  const meilleurEnsuite = appli.filter((e) => (e.at ?? 0) > (m.at ?? 0) && e.percent > m.percent);
  return meilleurEnsuite.length ? meilleur(meilleurEnsuite) : m;
}

// lib/evaliaMoyenne.ts
var COEF_QUIZ = 1;
var COEF_CHATBOT = 2;
var SUFFIXE = /\s*\((QCM IA|QCM|Quiz IA|Quiz|Chatbot|Chat bot)\)\s*$/i;
var theme = (id) => id.replace(/~(ai-quiz|chatbot)$/, "");
var fr = (n) => String(Math.round(n * 10) / 10).replace(".", ",");
function themesEvalIA(app) {
  const m = /* @__PURE__ */ new Map();
  for (const x of app?.exercices || []) {
    const q = x.id.endsWith("~ai-quiz"), c = x.id.endsWith("~chatbot");
    if (!q && !c) continue;
    const t = m.get(theme(x.id)) || {};
    if (q) t.quiz = x;
    else t.chatbot = x;
    m.set(theme(x.id), t);
  }
  return new Map([...m].filter((e) => !!e[1].quiz && !!e[1].chatbot));
}
function colonnesFusionnees(colonnes, themes) {
  if (!themes?.size) return colonnes;
  const vues = /* @__PURE__ */ new Set();
  const sortie = [];
  for (const c of colonnes) {
    const m = /^evalia:(.+)~(ai-quiz|chatbot)$/.exec(c.cle);
    if (!m || !themes.has(m[1])) {
      sortie.push(c);
      continue;
    }
    const cle = `evalia:${m[1]}~moyenne`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    sortie.push({ ...c, cle, ...c.titre !== void 0 ? { titre: c.titre.replace(SUFFIXE, "") + " (moyenne quiz + chatbot)" } : {} });
  }
  return sortie;
}
function fusionnerEvalIA(applications, applicationsToutes, essais) {
  const themes = themesEvalIA(applicationsToutes.find((a) => a.id === "evalia"));
  if (!themes.size) return { applications, applicationsToutes, themes: /* @__PURE__ */ new Set() };
  const parties = new Set([...themes.values()].flatMap((t) => [t.quiz.id, t.chatbot.id]));
  const transformer = (liste) => liste.map((a) => {
    if (a.id !== "evalia") return a;
    const vus = /* @__PURE__ */ new Set();
    const exercices = [];
    for (const x of a.exercices) {
      if (!parties.has(x.id)) {
        exercices.push(x);
        continue;
      }
      const t = theme(x.id);
      if (vus.has(t)) continue;
      vus.add(t);
      const th = themes.get(t);
      exercices.push({ id: `${t}~moyenne`, titre: `${th.quiz.titre.replace(SUFFIXE, "")} (moyenne quiz + chatbot)` });
    }
    return { ...a, exercices };
  });
  for (const parExo of essais.values()) {
    for (const [t] of themes) {
      const lq = parExo[`evalia:${t}~ai-quiz`], lc = parExo[`evalia:${t}~chatbot`];
      const q = lq?.length ? essaiQuiCompte(lq) : null, c = lc?.length ? essaiQuiCompte(lc) : null;
      if (!q && !c) continue;
      const presentes = [];
      presentes.push(q ? { nom: "Quiz", coef: COEF_QUIZ, percent: q.percent, score: q.score || `${fr(q.percent / 5)}/20`, ...q.provisoire ? { provisoire: true } : {} } : { nom: "Quiz", coef: COEF_QUIZ, percent: 0, score: "0/20" });
      presentes.push(c ? { nom: "Chatbot", coef: COEF_CHATBOT, percent: c.percent, score: c.score || `${fr(c.percent / 5)}/20`, ...c.provisoire ? { provisoire: true } : {} } : { nom: "Chatbot", coef: COEF_CHATBOT, percent: 0, score: "0/20" });
      const poids = presentes.reduce((s, p) => s + p.coef, 0);
      const percent = presentes.reduce((s, p) => s + p.percent * p.coef, 0) / poids;
      const at = Math.max(...[q?.at, c?.at].map((x) => x ?? 0)) || null;
      const cle = `evalia:${t}~moyenne`;
      const calcule = { percent, at, score: `${fr(percent / 5)}/20`, parts: presentes, ...presentes.some((p) => p.provisoire) ? { provisoire: true } : {} };
      parExo[cle] = [...parExo[cle] || [], calcule];
    }
  }
  return { applications: transformer(applications), applicationsToutes: transformer(applicationsToutes), themes: new Set(themes.keys()) };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  COEF_CHATBOT,
  COEF_QUIZ,
  colonnesFusionnees,
  fusionnerEvalIA,
  themesEvalIA
});
