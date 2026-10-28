// Petits outils communs à plusieurs vues.

/** Sans accents ni majuscules, pour chercher. */
export const sansAccent = (s: string) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Titre d'une colonne sur plusieurs lignes : « 4e · Séq. 1 · Sem. 3 · L'évolution des OST ». */
export function EnteteColonne({ titre }: { titre: string }) {
  const morceaux = titre.split(" · ").filter(Boolean);
  if (morceaux.length < 2) return <span className="titre-col seul">{titre}</span>;
  // Le début (matière, niveau, séquence, semaine) tient sur une ligne, pour laisser la place au titre.
  return <><span className="ligne-col">{morceaux.slice(0, -1).join(" · ")}</span><span className="titre-col">{morceaux[morceaux.length - 1]}</span></>;
}
