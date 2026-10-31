// Onglet « Consommation » (administrateur) : chiffres envoyés par chaque application (route /api/suivi/consommation,
// fichier dist/conso.cjs de l'application), additionnés ici, et alertes quand on approche d'une limite.

/** Compteurs d'une période (une minute, une heure, la dernière heure, les dernières 24 h). */
export type Compteurs = {
  req: number;    // demandes reçues par l'application (/api/...)
  pic: number;    // demandes traitées en même temps, au plus
  r429: number;   // refus « Trop de demandes » (limites de l'application)
  r402: number;   // refus « crédits IA épuisés »
  e5xx: number;   // erreurs du serveur
  ia: number;     // appels à Gemini
  iaErr: number;  // appels à Gemini en erreur
  ia429: number;  // refus de Google (quota de la clé Gemini)
  iaMs: number;   // durée totale des appels à Gemini (ms)
  tokIn: number;  // jetons lus par Gemini
  tokOut: number; // jetons écrits par Gemini (réflexion comprise)
};
export type Motif = { motif: string; n: number };
export type RapportApp = {
  app: string; format: number; maintenant: number; demarreLe: number; processus: number; memoireMo: number; enCours: number;
  derniereHeure: Compteurs & { motifs: Motif[] }; dernieres24h: Compteurs & { motifs: Motif[] };
  minutes: (Compteurs & { t: number })[]; heures: (Compteurs & { t: number })[];
  limites: Record<string, string>;
};

export type Seuils = {
  iaParMinute: number;      // appels Gemini par minute, toutes applications ensemble (même clé Gemini)
  simultanees: number;      // demandes traitées en même temps chez o2switch (« Entry Processes »)
  coutJour: number;         // dépense IA estimée sur 24 h, en dollars
  prixEntree: number;       // prix d'un million de jetons lus, en dollars
  prixSortie: number;       // prix d'un million de jetons écrits, en dollars
  erreursHeure: number;     // erreurs du serveur par heure et par application
};
export const SEUILS_PAR_DEFAUT: Seuils = { iaParMinute: 1000, simultanees: 80, coutJour: 30, prixEntree: 0.75, prixSortie: 3.75, erreursHeure: 5 };

export function lireSeuils(env: Record<string, string | undefined>): Seuils {
  const n = (cle: string, def: number) => {
    const v = Number(String(env[cle] ?? "").replace(",", "."));
    return Number.isFinite(v) && v > 0 ? v : def;
  };
  const d = SEUILS_PAR_DEFAUT;
  return {
    iaParMinute: n("SEUIL_IA_PAR_MINUTE", d.iaParMinute),
    simultanees: n("SEUIL_SIMULTANEES", d.simultanees),
    coutJour: n("SEUIL_COUT_JOUR", d.coutJour),
    prixEntree: n("PRIX_IA_ENTREE", d.prixEntree),
    prixSortie: n("PRIX_IA_SORTIE", d.prixSortie),
    erreursHeure: n("SEUIL_ERREURS_HEURE", d.erreursHeure),
  };
}

export const ALERTE = 0.8; // « attention » à 80 % d'un seuil

export type Alerte = { niveau: "danger" | "attention"; app: string | null; texte: string };
export type LigneApp = { id: string; nom: string; etat: "ok" | "absent" | "erreur"; message?: string; rapport?: RapportApp; cout24h?: number; cout1h?: number };

const cout = (c: Pick<Compteurs, "tokIn" | "tokOut">, s: Seuils) => (c.tokIn * s.prixEntree + c.tokOut * s.prixSortie) / 1e6;
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/** Additionne les applications, calcule la dépense estimée et les alertes. */
export function synthese(lignes: LigneApp[], s: Seuils, maintenant = Date.now()) {
  const minute = Math.floor(maintenant / 60e3);
  const parMinute = new Map<number, { ia: number; pic: number }>();
  for (const l of lignes) {
    const r = l.rapport;
    if (!r) continue;
    l.cout24h = cout(r.dernieres24h, s);
    l.cout1h = cout(r.derniereHeure, s);
    for (const m of r.minutes || []) {
      const k = Math.floor(m.t / 60e3);
      if (k < minute - 59 || k > minute) continue;
      const v = parMinute.get(k) || { ia: 0, pic: 0 };
      v.ia += m.ia || 0; v.pic += m.pic || 0;
      parMinute.set(k, v);
    }
  }
  const minutes = Array.from({ length: 60 }, (_, i) => ({ t: (minute - 59 + i) * 60e3, ia: parMinute.get(minute - 59 + i)?.ia || 0, pic: parMinute.get(minute - 59 + i)?.pic || 0 }));
  const avec = lignes.filter(l => l.rapport);
  const somme = (f: (r: RapportApp) => number) => avec.reduce((n, l) => n + f(l.rapport!), 0);
  const total = {
    ia1h: somme(r => r.derniereHeure.ia), ia24h: somme(r => r.dernieres24h.ia),
    r429h: somme(r => r.derniereHeure.r429), r402h: somme(r => r.derniereHeure.r402), ia429h: somme(r => r.derniereHeure.ia429),
    e5xxh: somme(r => r.derniereHeure.e5xx),
    cout1h: avec.reduce((n, l) => n + (l.cout1h || 0), 0), cout24h: avec.reduce((n, l) => n + (l.cout24h || 0), 0),
    picIaMinute: Math.max(0, ...minutes.map(m => m.ia)), picSimultanees: Math.max(0, ...minutes.map(m => m.pic)),
    enCours: somme(r => r.enCours || 0),
  };

  const alertes: Alerte[] = [];
  const seuil = (valeur: number, max: number, texte: (pct: number) => string, app: string | null = null) => {
    if (valeur >= max) alertes.push({ niveau: "danger", app, texte: texte(Math.round(100 * valeur / max)) });
    else if (valeur >= ALERTE * max) alertes.push({ niveau: "attention", app, texte: texte(Math.round(100 * valeur / max)) });
  };
  // Limites communes à toutes les applications.
  seuil(total.picIaMinute, s.iaParMinute, p => `Appels à l'IA : jusqu'à ${total.picIaMinute} par minute dans l'heure, ${p} % du seuil (${s.iaParMinute} par minute, clé Gemini commune).`);
  seuil(total.picSimultanees, s.simultanees, p => `Jusqu'à ${total.picSimultanees} demandes traitées en même temps, ${p} % de la limite o2switch (${s.simultanees}).`);
  seuil(total.cout24h, s.coutJour, p => `Dépense IA estimée sur 24 h : ${total.cout24h.toFixed(2)} $, ${p} % du seuil (${s.coutJour} $).`);

  for (const l of lignes) {
    if (l.etat === "erreur") { alertes.push({ niveau: "danger", app: l.nom, texte: `Ne répond pas : ${l.message || "erreur"}` }); continue; }
    const r = l.rapport;
    if (!r) continue;
    const h = r.derniereHeure;
    if (h.ia429 > 0) alertes.push({ niveau: "danger", app: l.nom, texte: `Google a refusé ${pluriel(h.ia429, "appel")} à l'IA dans l'heure (quota de la clé Gemini atteint).` });
    if (h.r402 > 0) alertes.push({ niveau: "danger", app: l.nom, texte: `${pluriel(h.r402, "demande")} refusée${h.r402 > 1 ? "s" : ""} dans l'heure : crédits IA épuisés. Rechargez les crédits de l'enseignant concerné.` });
    if (h.r429 > 0) {
      const ou = h.motifs.filter(m => m.motif.startsWith("429 ")).slice(0, 3).map(m => `${m.motif.slice(4)} (${m.n})`).join(", ");
      alertes.push({ niveau: h.r429 >= 20 ? "danger" : "attention", app: l.nom, texte: `${h.r429} refus « Trop de demandes » dans l'heure${ou ? " : " + ou : ""}.` });
    }
    seuil(h.e5xx, s.erreursHeure, () => `${pluriel(h.e5xx, "erreur")} du serveur dans l'heure.`, l.nom);
    if (h.ia >= 10 && h.iaErr / h.ia >= 0.1) alertes.push({ niveau: h.iaErr / h.ia >= 0.3 ? "danger" : "attention", app: l.nom, texte: `${Math.round(100 * h.iaErr / h.ia)} % des appels à l'IA ont échoué dans l'heure.` });
    if (h.ia >= 5 && h.iaMs / h.ia > 20000) alertes.push({ niveau: "attention", app: l.nom, texte: `L'IA répond lentement : ${Math.round(h.iaMs / h.ia / 1000)} s en moyenne dans l'heure.` });
  }
  alertes.sort((a, b) => Number(a.niveau !== "danger") - Number(b.niveau !== "danger"));
  return { total, minutes, alertes };
}

/** Le rapport reçu ressemble-t-il à celui de conso.cjs ? (une application sans compteurs renvoie sa page d'accueil) */
export function estRapport(d: any): d is RapportApp {
  return !!d && typeof d === "object" && d.format === 1 && !!d.derniereHeure && !!d.dernieres24h && Array.isArray(d.minutes) && Array.isArray(d.heures);
}
