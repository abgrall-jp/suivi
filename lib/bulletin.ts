// Calcul des notes du bulletin, par trimestre.
// La note calculée suit les résultats des applications ; une note définitive, une fois posée, ne bouge plus
// (seul l'enseignant peut la changer).

export type Trimestre = "T1" | "T2" | "T3";
export const TRIMESTRES: Trimestre[] = ["T1", "T2", "T3"];
export type Periodes = Record<Trimestre, { debut: string; fin: string }>; // dates AAAA-MM-JJ, fin incluse
export type Essai = { percent: number; at: number | null };

/** Trimestres de l'année scolaire en cours (septembre à juillet) : 1er sept.–30 nov., 1er déc.–fin février, 1er mars–14 juillet. */
export function periodesParDefaut(maintenant = new Date()): Periodes {
  const a = maintenant.getMonth() >= 7 ? maintenant.getFullYear() : maintenant.getFullYear() - 1; // à partir d'août : nouvelle année
  const finFevrier = new Date(Date.UTC(a + 1, 2, 0)).toISOString().slice(0, 10);
  return {
    T1: { debut: `${a}-09-01`, fin: `${a}-11-30` },
    T2: { debut: `${a}-12-01`, fin: finFevrier },
    T3: { debut: `${a + 1}-03-01`, fin: `${a + 1}-07-14` },
  };
}

export const estTrimestre = (t: unknown): t is Trimestre => TRIMESTRES.includes(t as Trimestre);
export const dateValide = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));

/** Bornes en millisecondes (heure de Paris approchée : on prend toute la journée de fin). */
export function bornes(p: { debut: string; fin: string }) {
  return { debut: Date.parse(`${p.debut}T00:00:00Z`) - 2 * 3600e3, fin: Date.parse(`${p.fin}T23:59:59Z`) };
}

/**
 * Note sur 20 d'un élève : moyenne des colonnes retenues, chaque colonne valant le dernier essai fait pendant le trimestre.
 * Un essai sans date compte toujours. Aucune colonne avec résultat : pas de note.
 */
export function noteSur20(essais: Record<string, Essai[]>, colonnes: string[], periode: { debut: string; fin: string }): number | null {
  const { debut, fin } = bornes(periode);
  const valeurs: number[] = [];
  for (const c of colonnes) {
    const dansPeriode = (essais[c] || []).filter(e => e.at === null || (e.at >= debut && e.at <= fin));
    if (!dansPeriode.length) continue;
    const dernier = dansPeriode.reduce((m, x) => ((x.at ?? 0) >= (m.at ?? 0) ? x : m));
    valeurs.push(Math.max(0, Math.min(100, dernier.percent)));
  }
  if (!valeurs.length) return null;
  return Math.round((valeurs.reduce((s, v) => s + v, 0) / valeurs.length / 5) * 10) / 10;
}

/** Note saisie à la main (sur 20, virgule acceptée) : nombre arrondi au dixième, null pour effacer, undefined si incorrecte. */
export function lireNote(v: unknown): number | null | undefined {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", ".").trim());
  if (!Number.isFinite(n) || n < 0 || n > 20) return undefined;
  return Math.round(n * 10) / 10;
}

/** Moyenne des notes présentes, au dixième. */
export function moyenne(notes: (number | null | undefined)[]): number | null {
  const v = notes.filter((n): n is number => typeof n === "number");
  return v.length ? Math.round((v.reduce((s, n) => s + n, 0) / v.length) * 10) / 10 : null;
}
