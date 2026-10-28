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
