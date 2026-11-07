import test from "node:test";
import assert from "node:assert/strict";
import { estRapport, jourMoins, lireSeuils, regrouperEnseignants, synthese, valeurs, SEUILS_PAR_DEFAUT, type Compteurs, type LigneApp, type RapportApp } from "./consommation.ts";

const zero: Compteurs = { req: 0, pic: 0, r429: 0, r402: 0, e5xx: 0, ia: 0, iaErr: 0, ia429: 0, iaMs: 0, tokIn: 0, tokOut: 0 };
const T = 1_800_000_000_000;
function rapport(app: string, h: Partial<Compteurs> & { motifs?: any[] }, parMinute: Partial<Compteurs> = {}): RapportApp {
  const minute = Math.floor(T / 60e3);
  return {
    app, format: 1, maintenant: T, demarreLe: T - 3600e3, processus: 1, memoireMo: 90, enCours: 0,
    derniereHeure: { ...zero, motifs: [], ...h }, dernieres24h: { ...zero, motifs: [], ...h },
    minutes: Array.from({ length: 60 }, (_, i) => ({ ...zero, ...parMinute, t: (minute - 59 + i) * 60e3 })),
    heures: [], limites: {},
  };
}

test("seuils : valeurs par défaut, réglages lus dans l'environnement (virgule acceptée)", () => {
  assert.deepEqual(lireSeuils({}), SEUILS_PAR_DEFAUT);
  const s = lireSeuils({ SEUIL_IA_PAR_MINUTE: "500", PRIX_IA_ENTREE: "0,5", SEUIL_COUT_JOUR: "abc" });
  assert.equal(s.iaParMinute, 500);
  assert.equal(s.prixEntree, 0.5);
  assert.equal(s.coutJour, SEUILS_PAR_DEFAUT.coutJour);
});

test("tout va bien : aucune alerte, totaux additionnés", () => {
  const lignes: LigneApp[] = [
    { id: "evalia", nom: "Eval IA", etat: "ok", rapport: rapport("evalia", { ia: 40, req: 300 }, { ia: 2, pic: 3 }) },
    { id: "edubot", nom: "Edubot", etat: "ok", rapport: rapport("edubot", { ia: 10 }, { ia: 1, pic: 2 }) },
    { id: "quiz", nom: "Quiz IA", etat: "absent" },
  ];
  const r = synthese(lignes, SEUILS_PAR_DEFAUT, T);
  assert.equal(r.alertes.length, 0);
  assert.equal(r.total.ia1h, 50);
  assert.equal(r.total.picIaMinute, 3);
  assert.equal(r.total.picSimultanees, 5);
});

test("à 80 % du seuil d'appels par minute : attention ; au-delà : danger", () => {
  const s = { ...SEUILS_PAR_DEFAUT, iaParMinute: 100 };
  const a = synthese([{ id: "a", nom: "A", etat: "ok", rapport: rapport("a", {}, { ia: 85 }) }], s, T);
  assert.equal(a.alertes[0].niveau, "attention");
  assert.match(a.alertes[0].texte, /85 %/);
  const b = synthese([{ id: "a", nom: "A", etat: "ok", rapport: rapport("a", {}, { ia: 60 }) }, { id: "b", nom: "B", etat: "ok", rapport: rapport("b", {}, { ia: 60 }) }], s, T);
  assert.equal(b.alertes[0].niveau, "danger");
});

test("refus, crédits épuisés, quota Google et appli muette remontent en alerte", () => {
  const lignes: LigneApp[] = [
    { id: "evalia", nom: "Eval IA", etat: "ok", rapport: rapport("evalia", { r429: 3, r402: 2, ia429: 1, ia: 20, iaErr: 8, motifs: [{ motif: "429 POST /api/ai/generate QUOTA_EXCEEDED", n: 3 }] }) },
    { id: "cps", nom: "AI CPS", etat: "erreur", message: "ne répond pas" },
  ];
  const r = synthese(lignes, SEUILS_PAR_DEFAUT, T);
  const textes = r.alertes.map(a => a.texte).join("\n");
  assert.match(textes, /quota de la clé Gemini/);
  assert.match(textes, /crédits IA épuisés/);
  assert.match(textes, /3 refus « Trop de demandes ».*\/api\/ai\/generate/);
  assert.match(textes, /40 % des appels à l'IA ont échoué/);
  assert.match(textes, /Ne répond pas/);
  assert.equal(r.alertes.at(-1)!.niveau, "attention"); // les plus graves d'abord
});

test("dépense estimée d'après les jetons", () => {
  const s = { ...SEUILS_PAR_DEFAUT, prixEntree: 1, prixSortie: 4, coutJour: 10, euroParDollar: 1 };
  const r = synthese([{ id: "a", nom: "A", etat: "ok", rapport: rapport("a", { tokIn: 2_000_000, tokOut: 1_000_000 }) }], s, T);
  assert.equal(r.total.cout24h, 6);
  assert.equal(r.alertes.length, 0);
  const r2 = synthese([{ id: "a", nom: "A", etat: "ok", rapport: rapport("a", { tokIn: 2_000_000, tokOut: 1_500_000 }) }], s, T);
  assert.equal(r2.alertes[0].niveau, "attention");
});

test("une page d'accueil n'est pas un rapport", () => {
  assert.equal(estRapport({}), false);
  assert.equal(estRapport(null), false);
  assert.equal(estRapport(rapport("a", {})), true);
});

test("durées au choix : heure, 24 h, jours ; ancienne version sans historique", () => {
  const r = rapport("a", { ia: 4, tokIn: 10 }, { ia: 2 });
  assert.equal(valeurs(r, "1h")!.ia, 4);
  assert.equal(valeurs(r, "1h")!.iaMin, 2);
  assert.equal(valeurs(r, "7j"), null);
  const jour = (j: string, ia: number, iaMin: number, pic = 1) => ({ ...zero, jour: j, ia, iaMin, pic, tokIn: ia * 100 });
  r.aujourdhui = "2026-03-02";
  r.jours = [jour("2025-03-01", 100, 50), jour("2026-02-20", 10, 3, 9), jour("2026-02-24", 5, 7), jour("2026-03-02", 1, 1)];
  const s = valeurs(r, "7j")!;
  assert.equal(s.ia, 6); // 24 février (le 2 mars moins 6 jours) et 2 mars
  assert.equal(s.iaMin, 7);
  assert.equal(s.depuis, undefined);
  const m = valeurs(r, "30j")!;
  assert.equal(m.ia, 16);
  assert.equal(m.pic, 9);
  assert.equal(valeurs(r, "1an")!.ia, 16); // le 1er mars 2025 est hors de l'année glissante
  r.jours = r.jours.slice(1);
  assert.equal(valeurs(r, "3m")!.depuis, "2026-02-20");
  assert.equal(jourMoins("2026-03-01", 1), "2026-02-28");
});

test("coût par enseignant : comptes réunis d'une appli à l'autre, sans compte à la fin", () => {
  const s = { ...SEUILS_PAR_DEFAUT, prixEntree: 1, prixSortie: 1, euroParDollar: 1 };
  const e = (cle: string, ia: number, tok: number, nom?: string) => ({ cle, nom, req: ia, ia, iaErr: 0, tokIn: tok, tokOut: 0 });
  const fiches: Record<string, { cle: string; nom: string }> = { "anne@ecole.fr": { cle: "anne@ecole.fr", nom: "Anne M." }, "evalia/anne.perso@gmail.com": { cle: "anne@ecole.fr", nom: "Anne M." } };
  const r = regrouperEnseignants([
    { id: "evalia", nom: "Eval IA", liste: [e("anne.perso@gmail.com", 2, 1_000_000), e("-", 50, 3_000_000)] },
    { id: "quiz", nom: "Quiz IA", liste: [e("anne@ecole.fr", 1, 500_000), e("bob@ecole.fr", 9, 2_000_000, "Bob")] },
  ], s, (app, cle) => fiches[`${app}/${cle}`] || fiches[cle]);
  assert.deepEqual(r.map(l => [l.nom, l.ia, l.cout]), [["Bob", 9, 2], ["Anne M.", 3, 1.5], ["Sans compte (élèves, visiteurs)", 50, 3]]);
  assert.equal(r[1].connu, true);
  assert.deepEqual(r[1].apps.map(a => a.id), ["evalia", "quiz"]);
});

test("dépense convertie en euros (taux réglable)", () => {
  const s = { ...SEUILS_PAR_DEFAUT, prixEntree: 1, prixSortie: 1, euroParDollar: 0.9, coutJour: 100 };
  const r = synthese([{ id: "a", nom: "A", etat: "ok", rapport: rapport("a", { tokIn: 1_000_000, tokOut: 1_000_000 }) }], s, T);
  assert.equal(Math.round(r.total.cout24h * 100) / 100, 1.8);
  assert.equal(lireSeuils({ EURO_PAR_DOLLAR: "0,92" }).euroParDollar, 0.92);
  const r2 = synthese([{ id: "a", nom: "A", etat: "ok", rapport: rapport("a", { tokIn: 100_000_000, tokOut: 0 }) }], { ...s, coutJour: 100 }, T);
  assert.match(r2.alertes[0].texte, /90,00 €, 90 % du seuil \(100 €\)/);
});
