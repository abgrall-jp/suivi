// Rapprochement des élèves d'une application avec la liste de référence.
// Les noms ne sont pas écrits pareil d'une application à l'autre (« MARTIN Léa », « Lea Martin », « Léa M. ») :
// on compare sans accents ni majuscules, dans les deux ordres, en tolérant une faute de frappe.
// Une correspondance sûre est faite seule ; un doute est montré à l'enseignant, qui choisit une fois pour toutes.

export type EleveRef = { id: string; classe: string; nom: string; prenom: string };
export type EleveImporte = EleveRef & { email1: string; email2: string };
export type Niveau = "sur" | "probable";
export type Decision =
  | { statut: "auto"; refId: string }
  | { statut: "a_verifier"; candidats: string[] }
  | { statut: "aucun" };

export const normaliser = (s: string) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const jetons = (s: string) => normaliser(s).split(" ").filter(Boolean);

/** « 5e B », « 5ème B » et « 5B » donnent tous « 5b ». */
export const cleClasse = (s: string) => normaliser(s).replace(/\s+/g, "").replace(/^(\d+)(ieme|eme|em|e)?/, "$1");

export function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prec = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cour = [i];
    for (let j = 1; j <= b.length; j++) cour.push(Math.min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prec = cour;
  }
  return prec[b.length];
}

/** Ressemblance entre un nom écrit dans une application et un élève de référence. */
export function comparer(nomApp: string, classeApp: string, ref: EleveRef): Niveau | null {
  const a = jetons(nomApp);
  const p = jetons(ref.prenom), n = jetons(ref.nom);
  if (!a.length || !p.length) return null;
  const r = [...p, ...n];
  const trie = (x: string[]) => [...x].sort().join(" ");
  let niveau: Niveau | null = null;
  if (trie(a) === trie(r)) niveau = "sur";
  else if (Math.min(trie(a).length, trie(r).length) >= 6 && distance(trie(a), trie(r)) <= 1) niveau = "probable";
  else if (p.every(x => a.includes(x))) {
    const reste = a.filter(x => !p.includes(x));
    // « Léa M. » (initiale du nom) ou « Léa » seule.
    if (reste.length === 0 || (reste.length === 1 && reste[0].length === 1 && n[0]?.startsWith(reste[0]))) niveau = "probable";
  }
  // Classe différente : jamais sûr.
  if (niveau === "sur" && classeApp && ref.classe && cleClasse(classeApp) !== cleClasse(ref.classe)) niveau = "probable";
  return niveau;
}

export function decider(nomApp: string, classeApp: string, refs: EleveRef[]): Decision {
  const surs: string[] = [], probables: string[] = [];
  for (const ref of refs) {
    const n = comparer(nomApp, classeApp, ref);
    if (n === "sur") surs.push(ref.id);
    else if (n === "probable") probables.push(ref.id);
  }
  if (surs.length === 1) return { statut: "auto", refId: surs[0] };
  // Même nom et même prénom, écrits à l'identique, chez un seul élève : sûr, même si la classe est écrite autrement
  // d'une application à l'autre (« 201 » et « 2nde 1 »).
  if (!surs.length) {
    const cle = [...jetons(nomApp)].sort().join(" ");
    const memes = cle ? refs.filter(r => [...jetons(r.prenom), ...jetons(r.nom)].sort().join(" ") === cle) : [];
    if (memes.length === 1) return { statut: "auto", refId: memes[0].id };
  }
  const candidats = [...surs, ...probables];
  return candidats.length ? { statut: "a_verifier", candidats: candidats.slice(0, 5) } : { statut: "aucun" };
}

/** Identifiant stable d'un élève de référence, tiré de sa classe et de son nom. */
export const idEleve = (classe: string, nom: string, prenom: string) =>
  `${cleClasse(classe)}_${normaliser(nom).replace(/ /g, "-")}_${normaliser(prenom).replace(/ /g, "-")}`.slice(0, 150);

/**
 * Liste d'élèves collée depuis un tableur ou un fichier CSV : Classe ; Nom ; Prénom ; e-mail parent 1 ; e-mail parent 2
 * (séparateur ; , ou tabulation ; les e-mails sont facultatifs).
 */
export function lireListe(texte: string): { eleves: EleveImporte[]; erreurs: string[] } {
  const eleves = new Map<string, EleveImporte>();
  const erreurs: string[] = [];
  const lignes = String(texte || "").replace(/^﻿/, "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  lignes.forEach((ligne, i) => {
    const cols = ligne.split(/[;\t,]/).map(c => c.trim().replace(/^"|"$/g, ""));
    if (i === 0 && /classe/i.test(cols[0] || "") && /nom/i.test(cols[1] || "")) return;
    const [classe, nom, prenom] = cols;
    const [email1, email2] = [cols[3], cols[4]].map(e => (e || "").toLowerCase());
    if (!classe || !nom || !prenom) { erreurs.push(`Ligne ${i + 1} : il faut la classe, le nom et le prénom.`); return; }
    const mauvais = [email1, email2].find(e => e && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(e));
    if (mauvais) { erreurs.push(`Ligne ${i + 1} : adresse e-mail incorrecte (${mauvais.slice(0, 80)}).`); return; }
    const id = idEleve(classe, nom, prenom);
    eleves.set(id, { id, classe: classe.slice(0, 40), nom: nom.slice(0, 80), prenom: prenom.slice(0, 80), email1, email2 });
  });
  return { eleves: Array.from(eleves.values()), erreurs };
}

/** « Classe » qui n'est que le nom de l'élève (tous ses mots sont dans son nom, sans chiffre) : pas une vraie classe. */
export function classeEstUnNom(classe: string, nom: string) {
  const c = normaliser(classe);
  if (!c || /\d/.test(c)) return false;
  const mots = new Set(normaliser(nom).split(" "));
  return c.split(" ").every(m => mots.has(m));
}
