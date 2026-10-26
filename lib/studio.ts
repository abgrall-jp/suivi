// Appréciations écrites avec le Studio d'Appréciations : rattachées au trimestre et à l'élève de la liste.
import { decider, type EleveRef } from "./correspondance.ts";
import type { Trimestre } from "./bulletin.ts";

// Génération directe : term, mode, timestamp. Séance de classe enregistrée (premium) : period, className, createdAt (texte ISO).
export type AppreciationStudio = {
  studentName?: string; text?: string; term?: string; period?: string; mode?: string | null; className?: string;
  timestamp?: { toMillis?: () => number } | number | null; createdAt?: string;
};
export type TextesStudio = { eleve?: { texte: string; le: number }; prof?: { texte: string; le: number } };

/** « Trimestre 1 », « 1er trimestre », « T1 » → T1 ; semestres et année : aucun trimestre. */
export function trimestreDe(term: unknown): Trimestre | null {
  const t = String(term || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/semestre|annee/.test(t)) return null;
  const m = /(?:^|\b|t)([123])(?:er|e|eme)?\b/.exec(t.replace(/trimestre/g, " ").trim()) || /trimestre\s*([123])/.exec(t);
  return m ? (`T${m[1]}` as Trimestre) : null;
}

const millis = (d: AppreciationStudio) => {
  const t = d.timestamp;
  if (typeof t === "number") return t;
  if (typeof t?.toMillis === "function") return t.toMillis();
  return Date.parse(String(d.createdAt || "")) || 0;
};

/**
 * Dernière appréciation de chaque élève pour ce trimestre : celle que l'élève a écrite (mode Élève)
 * et celle du professeur (autres modes). Le nom est rapproché des élèves de la classe : une correspondance sûre,
 * ou un seul élève possible (« Léa M. ») ; sinon l'appréciation est laissée de côté.
 */
export function textesParEleve(docs: AppreciationStudio[], trimestre: Trimestre, eleves: EleveRef[]): Map<string, TextesStudio> {
  const res = new Map<string, TextesStudio>();
  for (const d of docs) {
    const texte = String(d.text || "").trim();
    if (!texte || trimestreDe(d.term || d.period) !== trimestre) continue;
    const dec = decider(String(d.studentName || ""), "", eleves);
    const refId = dec.statut === "auto" ? dec.refId : dec.statut === "a_verifier" && dec.candidats.length === 1 ? dec.candidats[0] : null;
    if (!refId) continue;
    const genre = d.mode === "student" ? "eleve" : "prof";
    const le = millis(d);
    const t = res.get(refId) || {};
    if (!t[genre] || le >= t[genre]!.le) t[genre] = { texte: texte.slice(0, 3000), le };
    res.set(refId, t);
  }
  return res;
}
