import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api.ts";
import { EnteteColonne } from "./outils.tsx";

// --- Espace des familles (page publique /famille) ------------------------------------------------
// L'élève ou ses parents se connectent avec le code personnel, ou avec le mot de passe parent ;
// ils voient seulement ce que les enseignants ont publié pour cet élève.

type Enfant = { jeton: string; prenom: string; nom: string };
type Colonne = { cle: string; app?: string; titre: string; coef?: number };
type VueFamille = {
  eleve: { nom: string; prenom: string; classe: string } | null;
  tableaux: { enseignant: string; classe: string; publieLe: string; colonnes: Colonne[]; resultats: Record<string, { percent: number; score: string }> }[];
  bulletins: {
    enseignant: string; classe: string; trimestre: string; publieLe: string; colonnes: Colonne[]; externes: { id: string; titre: string }[];
    notes: Record<string, number | null>; moyenne: number | null; definitive: boolean; externesNotes: Record<string, number | null>; appreciation: string;
  }[];
};

const CLE = "suivi-famille";
const lire = (): Enfant[] => { try { return JSON.parse(localStorage.getItem(CLE) || "[]"); } catch { return []; } };
const ecrire = (e: Enfant[]) => { try { localStorage.setItem(CLE, JSON.stringify(e)); } catch { /* navigation privée */ } };
const note = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "–");
const dateFr = (d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const couleur = (p: number) => (p >= 75 ? "tres-bien" : p >= 50 ? "bien" : p >= 25 ? "moyen" : "faible");
const nomTrimestre = (t: string) => `${t.slice(1)}${t === "T1" ? "er" : "e"} trimestre`;

export function EspaceFamille() {
  const [enfants, setEnfants] = useState<Enfant[]>(lire);
  const [choisi, setChoisi] = useState(0);
  const enfant = enfants[choisi];
  const sortir = () => { ecrire([]); setEnfants([]); setChoisi(0); };
  if (!enfant) return <ConnexionFamille onOk={e => { ecrire(e); setEnfants(e); setChoisi(0); }} />;
  return (
    <div className="appli">
      <header>
        <strong>Suivi · Famille</strong>
        {enfants.length > 1 && (
          <nav>{enfants.map((e, i) => <button key={e.jeton} className={i === choisi ? "actif" : ""} onClick={() => setChoisi(i)}>{e.prenom || `Enfant ${i + 1}`}</button>)}</nav>
        )}
        <span className="moi"><button className="lien" onClick={sortir}>Se déconnecter</button></span>
      </header>
      <main><VueEnfant key={enfant.jeton} jeton={enfant.jeton} onExpire={sortir} /></main>
    </div>
  );
}

function ConnexionFamille({ onOk }: { onOk: (e: Enfant[]) => void }) {
  const [mode, setMode] = useState<"code" | "parent">("code");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [mdp, setMdp] = useState("");
  const [msg, setMsg] = useState("");
  const [occupe, setOccupe] = useState(false);
  const envoyer = async (ev: FormEvent) => {
    ev.preventDefault();
    setMsg(""); setOccupe(true);
    try {
      const r = await fetch("/api/famille/connexion", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "code" ? { code } : { email: email.trim(), motDePasse: mdp }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || `Erreur ${r.status}`);
      onOk(d.enfants);
    } catch (e: any) { setMsg(e.message); } finally { setOccupe(false); }
  };
  return (
    <div className="centre carte connexion">
      <h1>Suivi · Famille</h1>
      <p>Les résultats et le bulletin publiés par les enseignants.</p>
      <div className="onglets">
        <button className={mode === "code" ? "actif" : ""} onClick={() => setMode("code")}>J'ai un code</button>
        <button className={mode === "parent" ? "actif" : ""} onClick={() => setMode("parent")}>Parent : e-mail et mot de passe</button>
      </div>
      <form onSubmit={envoyer}>
        {mode === "code" ? (
          <input placeholder="Code (ex. : Renard-Tulipe-47-3)" value={code} onChange={e => setCode(e.target.value)} required autoComplete="off" autoCapitalize="off" />
        ) : (
          <>
            <input type="email" placeholder="Adresse e-mail" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
            <input type="password" placeholder="Mot de passe parent" value={mdp} onChange={e => setMdp(e.target.value)} required autoComplete="current-password" />
          </>
        )}
        <button type="submit" className="principal" disabled={occupe}>Voir</button>
      </form>
      {msg && <p className="erreur">{msg}</p>}
      {mode === "parent" && <p className="petit"><a href="/parents">Mot de passe parent perdu ?</a></p>}
    </div>
  );
}

function VueEnfant({ jeton, onExpire }: { jeton: string; onExpire: () => void }) {
  const [v, setV] = useState<VueFamille | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    fetch("/api/famille", { headers: { Authorization: `Famille ${jeton}` } }).then(async r => {
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) return onExpire();
      if (!r.ok) throw new Error(d?.error || `Erreur ${r.status}`);
      setV(d);
    }).catch(e => setMsg(e.message));
  }, [jeton, onExpire]);
  if (msg) return <p className="erreur">{msg}</p>;
  if (!v) return <p>Chargement…</p>;
  return (
    <section>
      {v.eleve && <h2>{v.eleve.prenom} {v.eleve.nom} <span className="petit">({v.eleve.classe})</span></h2>}
      {!v.tableaux.length && !v.bulletins.length && <p>Aucun résultat publié pour l'instant.</p>}
      {v.bulletins.map((b, i) => (
        <div key={`b${i}`} className="carte">
          <h3>Bulletin · {nomTrimestre(b.trimestre)} · {b.enseignant}</h3>
          <p className="petit">Publié le {dateFr(b.publieLe)}</p>
          <div className="defile court">
            <table className="tableau bulletin">
              <thead><tr>
                {b.colonnes.map(c => <th key={c.cle} className="exo"><EnteteColonne titre={c.titre} /><span className="coef">coef. {note(c.coef ?? 1)}</span></th>)}
                <th>Moyenne</th>
                {b.externes.map(x => <th key={x.id}>{x.titre}</th>)}
              </tr></thead>
              <tbody><tr>
                {b.colonnes.map(c => <td key={c.cle}>{note(b.notes[c.cle])}</td>)}
                <td><strong>{note(b.moyenne)}</strong></td>
                {b.externes.map(x => <td key={x.id}>{note(b.externesNotes[x.id])}</td>)}
              </tr></tbody>
            </table>
          </div>
          {b.appreciation && <p className="appreciation-famille"><strong>Appréciation :</strong> {b.appreciation}</p>}
        </div>
      ))}
      {v.tableaux.map((t, i) => (
        <div key={`t${i}`} className="carte">
          <h3>Résultats · {t.enseignant}</h3>
          <p className="petit">Publiés le {dateFr(t.publieLe)}</p>
          {!t.colonnes.length ? <p>Aucun exercice publié.</p> : (
            <div className="defile court">
              <table className="tableau">
                <thead><tr>{t.colonnes.map(c => <th key={c.cle} className="exo" title={`${c.app} : ${c.titre}`}><EnteteColonne titre={c.titre} /></th>)}</tr></thead>
                <tbody><tr>{t.colonnes.map(c => {
                  const r = t.resultats[c.cle];
                  return <td key={c.cle} className={r ? couleur(r.percent) : "vide"}>{r ? <>{r.score && <span className="note">{r.score.replace(/\s*\/\s*/, "/")}</span>} {r.percent} %</> : ""}</td>;
                })}</tr></tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

// --- Codes des familles (enseignant) ---------------------------------------------------------------
type LigneCode = { id: string; nom: string; prenom: string; classe: string; codeLe: string | null };

export function VueCodesFamille() {
  const [classes, setClasses] = useState<{ cle: string; nom: string }[]>([]);
  const [classe, setClasse] = useState("");
  const [eleves, setEleves] = useState<LigneCode[] | null>(null);
  const [fiches, setFiches] = useState<{ codes: { id: string; nom: string; prenom: string; classe: string; code: string }[]; adresse: string } | null>(null);
  const [msg, setMsg] = useState("");
  const [occupe, setOccupe] = useState(false);

  useEffect(() => { api<{ classes: { cle: string; nom: string }[] }>("/api/bulletin").then(d => setClasses(d.classes)).catch(e => setMsg(e.message)); }, []);
  const charger = useCallback(async () => {
    if (!classe) return;
    try { setEleves((await api<{ eleves: LigneCode[] }>(`/api/famille/codes?classe=${encodeURIComponent(classe)}`)).eleves); setMsg(""); } catch (e: any) { setMsg(e.message); }
  }, [classe]);
  useEffect(() => { setFiches(null); charger(); }, [charger]);

  const creer = async (refIds?: string[]) => {
    setMsg(""); setOccupe(true);
    try { setFiches(await api("/api/famille/codes", { classe, ...(refIds ? { refIds } : {}) })); await charger(); } catch (e: any) { setMsg(e.message); } finally { setOccupe(false); }
  };
  const sansCode = (eleves || []).filter(e => !e.codeLe);

  return (
    <section>
      <div className="barre">
        <h2>Familles</h2>
        <select value={classe} onChange={e => setClasse(e.target.value)}>
          <option value="">Choisir la classe…</option>
          {classes.map(c => <option key={c.cle} value={c.cle}>{c.nom}</option>)}
        </select>
      </div>
      <p className="petit">
        Chaque élève reçoit un code personnel, valable pour lui et ses parents, sur <strong>{location.origin}/famille</strong>.
        Ils y voient seulement leurs propres résultats : le tableau et le bulletin que vous avez publiés (bouton « Publier pour les familles »).
        Les parents qui ont reçu le mot de passe parent de Suivi peuvent aussi l'utiliser.
      </p>
      {msg && <p className="erreur">{msg}</p>}
      {fiches && fiches.codes.length > 0 && (
        <div className="carte">
          <div className="barre">
            <strong>{fiches.codes.length} code{fiches.codes.length > 1 ? "s" : ""} créé{fiches.codes.length > 1 ? "s" : ""}</strong>
            <button className="principal" onClick={() => window.print()}>Imprimer les fiches</button>
          </div>
          <p className="petit">Notez-les ou imprimez-les maintenant : un code n'est montré qu'une fois. Un code perdu se remplace par « Nouveau code ».</p>
          <div className="fiches">
            {fiches.codes.map(c => (
              <div key={c.id} className="fiche-code">
                <strong>{c.prenom} {c.nom}</strong> <span className="petit">({c.classe})</span>
                <div>Adresse : {fiches.adresse}</div>
                <div>Code : <span className="code">{c.code}</span></div>
              </div>
            ))}
          </div>
        </div>
      )}
      {eleves && (
        <>
          <div className="barre">
            <button className="principal" disabled={occupe || !sansCode.length} onClick={() => creer()}>
              {sansCode.length ? `Créer les codes manquants (${sansCode.length})` : "Tous les élèves ont un code"}
            </button>
          </div>
          <table className="corr">
            <thead><tr><th>Élève</th><th>Code</th><th></th></tr></thead>
            <tbody>
              {eleves.map(e => (
                <tr key={e.id}>
                  <td>{e.nom} {e.prenom}</td>
                  <td>{e.codeLe ? `créé le ${new Date(e.codeLe).toLocaleDateString("fr-FR")}` : "pas encore"}</td>
                  <td><button className="lien" disabled={occupe} onClick={() => { if (!e.codeLe || confirm(`Remplacer le code de ${e.prenom} ${e.nom} ? L'ancien ne fonctionnera plus.`)) creer([e.id]); }}>{e.codeLe ? "Nouveau code" : "Créer"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/** Bouton « Publier pour les familles » : copie ce que le professeur voit, pour cette classe, dans l'espace des familles. */
export function BoutonPublier({ publieLe, onPublier, onRetirer }: { publieLe: string | null; onPublier: () => Promise<void>; onRetirer: () => Promise<void> }) {
  const [occupe, setOccupe] = useState(false);
  const faire = async (fn: () => Promise<void>) => { setOccupe(true); try { await fn(); } finally { setOccupe(false); } };
  return (
    <span className="publier">
      <button disabled={occupe} title="Les élèves et les parents voient seulement leur propre ligne, telle qu'elle est maintenant." onClick={() => faire(onPublier)}>
        {publieLe ? "Republier pour les familles" : "Publier pour les familles"}
      </button>
      {publieLe && <span className="petit">publié le {new Date(publieLe).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · <button className="lien" disabled={occupe} onClick={() => { if (confirm("Retirer cette publication ? Les familles ne la verront plus.")) faire(onRetirer); }}>retirer</button></span>}
    </span>
  );
}
