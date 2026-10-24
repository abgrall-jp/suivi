// Remarques écrites sur les élèves dans le Plan de classe IA, reprises dans le bulletin du trimestre.
import { decider, type EleveRef } from "./correspondance.ts";

export type Remarque = { studentName?: string; date?: string; sessionNumber?: string; sequenceNumber?: string; text?: string };
export type PlanPublie = { teacherEmail?: string; className?: string; studentRemarks?: Record<string, Remarque[]> };
export type RemarqueEleve = { date: string; seance: string; texte: string };

/** Plans de cet enseignant (adresse comparée sans majuscules). */
export const plansDe = (plans: PlanPublie[], email: string) =>
  plans.filter(p => String(p.teacherEmail || "").trim().toLowerCase() === email.trim().toLowerCase());

/** Remarques datées dans la période, rangées par élève de la liste (nom reconnu avec certitude), de la plus ancienne à la plus récente. */
export function remarquesParEleve(plans: PlanPublie[], periode: { debut: string; fin: string }, eleves: EleveRef[]): Map<string, RemarqueEleve[]> {
  const res = new Map<string, RemarqueEleve[]>();
  const vues = new Set<string>();
  for (const p of plans) {
    for (const liste of Object.values(p.studentRemarks || {})) {
      for (const r of Array.isArray(liste) ? liste : []) {
        const texte = String(r?.text || "").trim();
        const date = String(r?.date || "").slice(0, 10);
        if (!texte || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < periode.debut || date > periode.fin) continue;
        const dec = decider(String(r.studentName || ""), String(p.className || ""), eleves);
        if (dec.statut !== "auto") continue;
        // La même remarque peut être rangée sous deux clés (nom et numéro) : une seule fois.
        const cle = `${dec.refId}|${date}|${texte}`;
        if (vues.has(cle)) continue;
        vues.add(cle);
        const seance = [r.sequenceNumber, r.sessionNumber && (/^\d+$/.test(r.sessionNumber) ? `Séance ${r.sessionNumber}` : r.sessionNumber)].filter(Boolean).join(", ");
        res.set(dec.refId, [...(res.get(dec.refId) || []), { date, seance: String(seance).slice(0, 200), texte: texte.slice(0, 2000) }]);
      }
    }
  }
  for (const l of res.values()) l.sort((a, b) => a.date.localeCompare(b.date));
  return res;
}
