// Eval IA envoie deux exercices par thème : « thème~ai-quiz » (coef 1) et « thème~chatbot » (coef 2).
// Suivi les regroupe en une seule colonne « moyenne » par thème : la case montre les deux notes en petit et la moyenne pondérée.
// Les anciennes colonnes séparées gardent leurs essais (les bulletins déjà faits continuent de les utiliser) mais ne sont plus proposées.
import { essaiQuiCompte, type Essai } from "./bulletin.ts";

export const COEF_QUIZ = 1, COEF_CHATBOT = 2;
type Ex = { id: string; titre: string };
type App = { id: string; exercices: Ex[]; [k: string]: any };
export type Partie = { nom: "Quiz" | "Chatbot"; coef: number; percent: number; score: string; provisoire?: boolean };
type EssaiEx = Essai & { score?: string; parts?: Partie[] };

const SUFFIXE = /\s*\((QCM IA|QCM|Quiz IA|Quiz|Chatbot|Chat bot)\)\s*$/i;
const theme = (id: string) => id.replace(/~(ai-quiz|chatbot)$/, "");
const fr = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

/** Colonnes regroupées : un thème dont le quiz ET le chatbot existent. */
export function themesEvalIA(app: App | undefined): Map<string, { quiz: Ex; chatbot: Ex }> {
  const m = new Map<string, { quiz?: Ex; chatbot?: Ex }>();
  for (const x of app?.exercices || []) {
    const q = x.id.endsWith("~ai-quiz"), c = x.id.endsWith("~chatbot");
    if (!q && !c) continue;
    const t = m.get(theme(x.id)) || {};
    if (q) t.quiz = x; else t.chatbot = x;
    m.set(theme(x.id), t);
  }
  return new Map([...m].filter((e): e is [string, { quiz: Ex; chatbot: Ex }] => !!e[1].quiz && !!e[1].chatbot));
}

/** Colonnes de bulletin déjà enregistrées sur le quiz ou le chatbot d'un thème regroupé : remplacées par la colonne moyenne (une seule fois). */
export function colonnesFusionnees<C extends { cle: string; titre?: string }>(colonnes: C[], themes: Set<string> | undefined): C[] {
  if (!themes?.size) return colonnes;
  const vues = new Set<string>();
  const sortie: C[] = [];
  for (const c of colonnes) {
    const m = /^evalia:(.+)~(ai-quiz|chatbot)$/.exec(c.cle);
    if (!m || !themes.has(m[1])) { sortie.push(c); continue; }
    const cle = `evalia:${m[1]}~moyenne`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    sortie.push({ ...c, cle, ...(c.titre !== undefined ? { titre: c.titre.replace(SUFFIXE, "") + " (moyenne quiz + chatbot)" } : {}) });
  }
  return sortie;
}

/** Remplace, dans les listes d'exercices, chaque couple quiz + chatbot par une colonne « moyenne » ; calcule les essais de ces colonnes. */
export function fusionnerEvalIA<A extends App>(applications: A[], applicationsToutes: A[], essais: Map<string, Record<string, EssaiEx[]>>): { applications: A[]; applicationsToutes: A[]; themes: Set<string> } {
  const themes = themesEvalIA(applicationsToutes.find(a => a.id === "evalia"));
  if (!themes.size) return { applications, applicationsToutes, themes: new Set() };
  const parties = new Set([...themes.values()].flatMap(t => [t.quiz.id, t.chatbot.id]));
  const transformer = (liste: A[]) => liste.map(a => {
    if (a.id !== "evalia") return a;
    const vus = new Set<string>();
    const exercices: Ex[] = [];
    for (const x of a.exercices) {
      if (!parties.has(x.id)) { exercices.push(x); continue; }
      const t = theme(x.id);
      if (vus.has(t)) continue;
      vus.add(t);
      const th = themes.get(t)!;
      exercices.push({ id: `${t}~moyenne`, titre: `${th.quiz.titre.replace(SUFFIXE, "")} (moyenne quiz + chatbot)` });
    }
    return { ...a, exercices };
  });
  for (const parExo of essais.values()) {
    for (const [t] of themes) {
      const lq = parExo[`evalia:${t}~ai-quiz`], lc = parExo[`evalia:${t}~chatbot`];
      const q = lq?.length ? essaiQuiCompte(lq) : null, c = lc?.length ? essaiQuiCompte(lc) : null;
      if (!q && !c) continue;
      const presentes: Partie[] = [];
      // Comme dans Eval IA : une partie non faite compte 0 dès que l'autre existe.
      presentes.push(q ? { nom: "Quiz", coef: COEF_QUIZ, percent: q.percent, score: q.score || `${fr(q.percent / 5)}/20`, ...(q.provisoire ? { provisoire: true } : {}) } : { nom: "Quiz", coef: COEF_QUIZ, percent: 0, score: "0/20" });
      presentes.push(c ? { nom: "Chatbot", coef: COEF_CHATBOT, percent: c.percent, score: c.score || `${fr(c.percent / 5)}/20`, ...(c.provisoire ? { provisoire: true } : {}) } : { nom: "Chatbot", coef: COEF_CHATBOT, percent: 0, score: "0/20" });
      const poids = presentes.reduce((s, p) => s + p.coef, 0);
      const percent = presentes.reduce((s, p) => s + p.percent * p.coef, 0) / poids;
      const at = Math.max(...[q?.at, c?.at].map(x => x ?? 0)) || null;
      const cle = `evalia:${t}~moyenne`;
      // Provisoire tant qu'un des deux est provisoire ; une note à un seul des deux est partielle.
      const calcule: EssaiEx = { percent, at, score: `${fr(percent / 5)}/20`, parts: presentes, ...(presentes.some(p => p.provisoire) ? { provisoire: true } : {}) };
      parExo[cle] = [...(parExo[cle] || []), calcule];
    }
  }
  return { applications: transformer(applications), applicationsToutes: transformer(applicationsToutes), themes: new Set(themes.keys()) };
}
