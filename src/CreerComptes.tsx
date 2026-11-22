import { useEffect, useState } from "react";
import { api, type Moi } from "./api.ts";

type LigneEleve = { prenom: string; nom: string; statut: string; id?: string; codeProvisoire?: string };
type ResultatApp = {
  app: string; nom?: string; statut: "ok" | "erreur" | "non_reliee" | "inconnue" | "enseignant_absent" | "a_la_premiere_connexion";
  erreur?: string; message?: string;
  classe?: { nom: string; statut: string; code?: string | null };
  eleves?: LigneEleve[];
};
type Reponse = { simulation: boolean; resultats: ResultatApp[] };

const LIBELLES: Record<string, string> = { a_creer: "à créer", cree: "créé", existe: "déjà présent (relié)", doublon_ignore: "doublon ignoré" };

/** « Prénom Nom » par ligne (ou « Nom;Prénom » avec un point-virgule ou une tabulation). */
function lireListe(texte: string) {
  return texte.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const [a, b] = l.split(/[;\t]/).map(x => x.trim());
    if (b !== undefined) return { prenom: b, nom: a };
    const m = l.split(/\s+/);
    return { prenom: m[0], nom: m.slice(1).join(" ") };
  });
}

export function VueCreerComptes({ moi }: { moi: Moi }) {
  const prises = moi.catalogue.filter(a => a.eleves && a.prete && moi.apps[a.id]?.email);
  const [nom, setNom] = useState("");
  const [niveau, setNiveau] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [ref, setRef] = useState<{ niveaux: string[]; disciplines: { nom: string; niveaux: string[] }[] } | null>(null);
  useEffect(() => { api<any>("/api/creer-comptes/referentiel", undefined, true).then(setRef).catch(() => setRef(null)); }, []);
  const disciplinesDuNiveau = (ref?.disciplines || []).filter(d => !d.niveaux.length || d.niveaux.includes(niveau));
  const [liste, setListe] = useState("");
  const [choix, setChoix] = useState<string[]>([]);
  const [rep, setRep] = useState<Reponse | null>(null);
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(false);
  const eleves = lireListe(liste);
  const pret = !!nom.trim() && !!niveau && eleves.length > 0 && choix.length > 0;

  const lancer = async (simulation: boolean) => {
    setErreur(""); setOccupe(true);
    try { setRep(await api<Reponse>("/api/creer-comptes", { nom: nom.trim(), niveau, discipline, eleves, applications: choix, simulation })); }
    catch (e: any) { setErreur(e.message); }
    finally { setOccupe(false); }
  };

  return (
    <div className="carte">
      <h2>Créer des comptes dans plusieurs applications</h2>
      <p className="petit">Saisissez la classe une seule fois. Rien n'est jamais modifié ni supprimé : un élève déjà présent dans une application est simplement relié, avec son code et ses résultats inchangés.</p>
      <label>Nom de la classe <input value={nom} onChange={e => { setNom(e.target.value); setRep(null); }} placeholder="ex. 6A" /></label>
      <label>Niveau
        <select value={niveau} onChange={e => { setNiveau(e.target.value); setDiscipline(""); setRep(null); }}>
          <option value="">Choisir…</option>
          {(ref?.niveaux || []).map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>{" "}
      <label>Discipline (facultatif)
        <select value={discipline} disabled={!niveau} onChange={e => { setDiscipline(e.target.value); setRep(null); }}>
          <option value="">{niveau ? "Aucune" : "Choisissez d'abord le niveau"}</option>
          {disciplinesDuNiveau.map(d => <option key={d.nom} value={d.nom}>{d.nom}</option>)}
        </select>
      </label>
      <label>Élèves (un par ligne : « Prénom Nom », ou « Nom;Prénom »)
        <textarea rows={8} value={liste} onChange={e => { setListe(e.target.value); setRep(null); }} />
      </label>
      <p className="petit">{eleves.length} élève{eleves.length > 1 ? "s" : ""} lu{eleves.length > 1 ? "s" : ""}.</p>
      <fieldset>
        <legend>Applications</legend>
        {prises.length === 0 && <p className="petit">Reliez d'abord vos applications dans « Mes applications ».</p>}
        {prises.length > 0 && <button className="lien" onClick={() => { setChoix(choix.length === prises.length ? [] : prises.map(a => a.id)); setRep(null); }}>{choix.length === prises.length ? "Tout décocher" : "Tout cocher"}</button>}
        {prises.map(a => (
          <label key={a.id} style={{ display: "block" }}>
            <input type="checkbox" checked={choix.includes(a.id)} onChange={() => { setChoix(c => c.includes(a.id) ? c.filter(x => x !== a.id) : [...c, a.id]); setRep(null); }} /> {a.nom}
          </label>
        ))}
      </fieldset>
      <p>
        <button disabled={!pret || occupe} onClick={() => lancer(true)}>Voir ce qui serait créé</button>{" "}
        <button className="principal" disabled={!pret || occupe || !rep?.simulation} onClick={() => lancer(false)} title="Il faut d'abord regarder l'aperçu">Créer</button>
      </p>
      {erreur && <p className="erreur">{erreur}</p>}
      {rep && <Compte rep={rep} />}
    </div>
  );
}

function Compte({ rep }: { rep: Reponse }) {
  return (
    <div>
      <h3>{rep.simulation ? "Aperçu (rien n'a été écrit)" : "Résultat"}</h3>
      {rep.resultats.map(r => (
        <div key={r.app} className="carte" style={{ marginBottom: 12 }}>
          <strong>{r.nom || r.app}</strong>
          {r.statut === "ok" ? <>
            <p className="petit">Classe « {r.classe?.nom} » : {LIBELLES[r.classe?.statut || ""] || r.classe?.statut}{r.classe?.code ? ` · code de classe ${r.classe.code}` : ""}</p>
            <ul>{r.eleves?.map((e, i) => <li key={i}>{e.prenom} {e.nom} : {LIBELLES[e.statut] || e.statut}{e.codeProvisoire && e.statut !== "existe" ? ` (code provisoire ${e.codeProvisoire})` : ""}</li>)}</ul>
          </> : <p className="erreur">{r.message || r.erreur || r.statut}</p>}
        </div>
      ))}
      {!rep.simulation && <button onClick={() => window.print()}>Imprimer la fiche</button>}
    </div>
  );
}
