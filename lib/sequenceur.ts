// Liaison avec le Séquenceur : notes des autres applications reprises dans ses exercices, et ligne de bulletin de l'élève.
import { TRIMESTRES, bornes, type Periodes, type Trimestre } from "./bulletin.ts";

/** Note d'un résultat telle que l'application l'écrit (« 8/10 », « 7,5/20 »), sinon son pourcentage sur 100. */
export function noteDeResultat(score: unknown, percent: unknown): { note: number; sur: number } | null {
  const m = String(score ?? "").replace(/,/g, ".").match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
  if (m && Number(m[2]) > 0) return { note: Number(m[1]), sur: Number(m[2]) };
  const p = Number(percent);
  return Number.isFinite(p) ? { note: Math.round(Math.max(0, Math.min(100, p)) * 10) / 10, sur: 100 } : null;
}

/** Trimestres déjà commencés, le plus récent d'abord (celui en cours en tête). */
export function trimestresCommences(per: Periodes, maintenant = Date.now()): Trimestre[] {
  return TRIMESTRES.filter(t => bornes(per[t]).debut <= maintenant).reverse();
}

/** Code qu'un élève tape pour entrer dans une application (code de la classe, mot de passe enseignant…). */
export type CodeClasse = { appli: string; nom: string; url: string; libelle: string; classe: string; code: string };

/**
 * Codes d'entrée de l'élève de référence `refId` dans les applications reliées : pour chaque application qui en donne un
 * (« code » sur ses classes), celui de la classe où l'élève y est rattaché. Un même code n'apparaît qu'une fois par application.
 */
export function codesDeLEleve(
  refId: string,
  resultat: { app: string; studentId: string; refId: string | null }[],
  lus: { app: { id: string; nom: string; url: string; libelleCode?: string }; d: { classes: { id: string; name: string; code?: unknown }[]; students: { id: string; classId: string; className: string }[] } | null }[],
): CodeClasse[] {
  const codes: CodeClasse[] = [];
  for (const { app, d } of lus) {
    if (!d || !app.libelleCode) continue;
    const mes = new Set(resultat.filter(r => r.app === app.id && r.refId === refId).map(r => r.studentId));
    if (!mes.size) continue;
    const classeDe = new Map(d.classes.map(c => [c.id, c]));
    const vus = new Set<string>();
    for (const s of d.students) {
      if (!mes.has(s.id)) continue;
      const c = classeDe.get(s.classId);
      const code = typeof c?.code === "string" || typeof c?.code === "number" ? String(c.code).trim().slice(0, 40) : "";
      if (!code || vus.has(code)) continue;
      vus.add(code);
      codes.push({ appli: app.id, nom: app.nom, url: app.url, libelle: app.libelleCode, classe: String(c?.name || s.className || ""), code });
    }
  }
  return codes;
}
