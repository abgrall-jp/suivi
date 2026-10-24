// Appréciations écrites avec le Studio d'Appréciations : rattachées au trimestre et à l'élève de la liste.
import { decider, type EleveRef } from "./correspondance.ts";
import type { Trimestre } from "./bulletin.ts";

export type AppreciationStudio = { studentName?: string; text?: string; term?: string; mode?: string; timestamp?: { toMillis?: () => number } | number | null };
export type TextesStudio = { eleve?: { texte: string; le: number }; prof?: { texte: string; le: number } };

/** « Trimestre 1 », « 1er trimestre », « T1 » → T1 ; semestres et année : aucun trimestre. */
export function trimestreDe(term: unknown): Trimestre | null {
  const t = String(term || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/semestre|annee/.test(t)) return null;
  const m = /(?:^|\b|t)([123])(?:er|e|eme)?\b/.exec(t.replace(/trimestre/g, " ").trim()) || /trimestre\s*([123])/.exec(t);
  return m ? (`T${m[1]}` as Trimestre) : null;
}

const millis = (t: AppreciationStudio["timestamp"]) => (typeof t === "number" ? t : typeof t?.toMillis === "function" ? t.toMillis() : 0);

/**
 * Dernière appréciation de chaque élève pour ce trimestre : celle que l'élève a écrite (mode Élève)
 * et celle du professeur (autres modes). Un nom qui ne correspond pas avec certitude à un élève de la liste est laissé de côté.
 */
export function textesParEleve(docs: AppreciationStudio[], trimestre: Trimestre, eleves: EleveRef[]): Map<string, TextesStudio> {
  const res = new Map<string, TextesStudio>();
  for (const d of docs) {
    const texte = String(d.text || "").trim();
    if (!texte || trimestreDe(d.term) !== trimestre) continue;
    const dec = decider(String(d.studentName || ""), "", eleves);
    if (dec.statut !== "auto") continue;
    const genre = d.mode === "student" ? "eleve" : "prof";
    const le = millis(d.timestamp);
    const t = res.get(dec.refId) || {};
    if (!t[genre] || le >= t[genre]!.le) t[genre] = { texte: texte.slice(0, 3000), le };
    res.set(dec.refId, t);
  }
  return res;
}
