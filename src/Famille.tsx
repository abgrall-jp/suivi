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
  tableaux: { enseignant: string; classe: string; publieLe: string; colonnes: Colonne[]; resultats: Record<string, { percent: number; score: string; manuelle?: boolean }> }[];
  bulletins: {
    enseignant: string; classe: string; trimestre: string; publieLe: string; colonnes: Colonne[]; externes: { id: string; titre: string }[];
    notes: Record<string, number | null>; manuelles?: string[]; moyenne: number | null; definitive: boolean; externesNotes: Record<string, number | null>; appreciation: string; autoEval?: string;
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
  const [changer, setChanger] = useState<{ jeton: string; prenom: string; premiere: boolean } | null>(null);
  const enfant = enfants[choisi];
  const sortir = () => { ecrire([]); setEnfants([]); setChoisi(0); setChanger(null); };
  const entrer = (e: Enfant[]) => { ecrire(e); setEnfants(e); setChoisi(0); setChanger(null); };
  if (changer) return <ChoixMotDePasse {...changer} onOk={entrer} onAnnuler={() => setChanger(null)} />;
  if (!enfant) return <ConnexionFamille onOk={entrer} onChanger={(jeton, prenom) => setChanger({ jeton, prenom, premiere: true })} />;
  return (
    <div className="appli">
      <header>
        <strong>Suivi · Famille</strong>
        {enfants.length > 1 && (
          <nav>{enfants.map((e, i) => <button key={e.jeton} className={i === choisi ? "actif" : ""} onClick={() => setChoisi(i)}>{e.prenom || `Enfant ${i + 1}`}</button>)}</nav>
        )}
        <span className="moi">
          <button className="lien" onClick={() => setChanger({ jeton: enfant.jeton, prenom: enfant.prenom, premiere: false })}>Changer le mot de passe</button>
          {" · "}<button className="lien" onClick={sortir}>Se déconnecter</button>
        </span>
      </header>
      <main><VueEnfant key={enfant.jeton} jeton={enfant.jeton} onExpire={sortir} /></main>
    </div>
  );
}

function ConnexionFamille({ onOk, onChanger }: { onOk: (e: Enfant[]) => void; onChanger: (jeton: string, prenom: string) => void }) {
  // Arrivée depuis l'accueil : « ?qui=eleve » (identifiant seulement) ou « ?qui=parent » (identifiant de l'enfant ou e-mail).
  const qui = new URLSearchParams(location.search).get("qui");
  // liste : enseignant, classe, nom, puis mot de passe (élèves et parents) ; identifiant : celui de la fiche ; email : mot de passe parent.
  const [mode, setMode] = useState<"liste" | "identifiant" | "email">("liste");
  const [annuaire, setAnnuaire] = useState<{ uid: string; nom: string; classes: { cle: string; nom: string }[] }[] | null>(null);
  const [ens, setEns] = useState("");
  const [classe, setClasse] = useState("");
  const [eleves, setEleves] = useState<{ id: string; nom: string }[] | null>(null);
  const [refId, setRefId] = useState("");
  const [identifiant, setIdentifiant] = useState("");
  const [email, setEmail] = useState("");
  const [mdp, setMdp] = useState("");
  const [msg, setMsg] = useState("");
  const [occupe, setOccupe] = useState(false);
  useEffect(() => {
    fetch("/api/famille/annuaire").then(r => r.json()).then(d => setAnnuaire(d.enseignants || [])).catch(() => setAnnuaire([]));
  }, []);
  const classes = annuaire?.find(e => e.uid === ens)?.classes || [];
  useEffect(() => {
    setEleves(null); setRefId("");
    if (!ens || !classe) return;
    fetch(`/api/famille/annuaire/eleves?enseignant=${encodeURIComponent(ens)}&classe=${encodeURIComponent(classe)}`)
      .then(r => r.json()).then(d => setEleves(d.eleves || [])).catch(() => setEleves([]));
  }, [ens, classe]);
  const envoyer = async (ev: FormEvent) => {
    ev.preventDefault();
    setMsg(""); setOccupe(true);
    try {
      const d = await poster("/api/famille/connexion", mode === "liste" ? { refId, enseignant: ens, motDePasse: mdp } : mode === "identifiant" ? { identifiant, motDePasse: mdp } : { email: email.trim(), motDePasse: mdp });
      if (d.doitChanger) onChanger(d.jeton, d.prenom); else onOk(d.enfants);
    } catch (e: any) { setMsg(e.message); } finally { setOccupe(false); }
  };
  const tu = qui === "eleve";
  return (
    <div className="centre carte connexion">
      <p className="petit"><a href="/">← Accueil</a></p>
      <h1>{tu ? "Accueil élève" : qui === "parent" ? "Accueil parent" : "Suivi · Famille"}</h1>
      <p>{tu ? "Tes résultats et ton bulletin, publiés par tes enseignants." : "Les résultats et le bulletin publiés par les enseignants."}</p>
      {mode !== "email" && <p className="alerte">{tu
        ? "Ton mot de passe est celui du Séquenceur. Si tu ne le connais plus, récupère-le auprès de ton enseignant."
        : "Le mot de passe est celui de l'élève dans le Séquenceur : c'est le même pour les parents, votre enfant doit vous le transmettre."}</p>}
      <form onSubmit={envoyer}>
        {mode === "liste" && <>
          <label className="etape">1. {tu ? "Ton enseignant" : "L'enseignant"}
            <select value={ens} onChange={e => { setEns(e.target.value); setClasse(""); }} required>
              <option value="">{annuaire === null ? "Chargement…" : annuaire.length ? "Choisir…" : "Aucun enseignant pour l'instant"}</option>
              {(annuaire || []).map(e => <option key={e.uid} value={e.uid}>{e.nom}</option>)}
            </select>
          </label>
          <label className="etape">2. {tu ? "Ta classe" : "La classe"}
            <select value={classe} onChange={e => setClasse(e.target.value)} required disabled={!ens}>
              <option value="">Choisir…</option>
              {classes.map(c => <option key={c.cle} value={c.cle}>{c.nom}</option>)}
            </select>
          </label>
          <label className="etape">3. {tu ? "Ton nom" : "Le nom de l'élève"}
            <select value={refId} onChange={e => setRefId(e.target.value)} required disabled={!eleves}>
              <option value="">{ens && classe && !eleves ? "Chargement…" : "Choisir…"}</option>
              {(eleves || []).map(x => <option key={x.id} value={x.id}>{x.nom}</option>)}
            </select>
          </label>
        </>}
        {mode === "identifiant" && <input placeholder="Identifiant (ex. : alice.durand.5b)" value={identifiant} onChange={e => setIdentifiant(e.target.value)} required autoComplete="username" autoCapitalize="off" />}
        {mode === "email" && <input type="email" placeholder="Adresse e-mail" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />}
        <label className="etape">{mode === "liste" ? "4. " : ""}Mot de passe
          <input type="password" placeholder={mode === "email" ? "Mot de passe parent" : "Mot de passe du Séquenceur"} value={mdp} onChange={e => setMdp(e.target.value)} required autoComplete="current-password" />
        </label>
        <button type="submit" className="principal" disabled={occupe}>Entrer</button>
      </form>
      {msg && <p className="erreur">{msg}</p>}
      <p className="petit">{mode === "email"
        ? <a href="/parents">Mot de passe parent perdu ?</a>
        : `Mot de passe oublié ? ${tu ? "Demande" : "Demandez"} à l'enseignant de le retrouver dans le Séquenceur. Les parents utilisent le même mot de passe que l'élève.`}</p>
      <p className="petit">
        {mode !== "liste" && <button className="lien" onClick={() => setMode("liste")}>Choisir l'enseignant, la classe et le nom</button>}
        {mode !== "identifiant" && <button className="lien" onClick={() => setMode("identifiant")}>{tu ? "J'ai un identifiant" : "Avec l'identifiant de la fiche"}</button>}
        {!tu && mode !== "email" && <button className="lien" onClick={() => setMode("email")}>Parent : avec mon adresse e-mail</button>}
      </p>
    </div>
  );
}

async function poster(chemin: string, body: unknown) {
  const r = await fetch(chemin, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || `Erreur ${r.status}`);
  return d;
}

/** Choix du mot de passe : obligatoire à la première connexion, possible ensuite. Les parents utilisent le même. */
function ChoixMotDePasse({ jeton, prenom, premiere, onOk, onAnnuler }: { jeton: string; prenom: string; premiere: boolean; onOk: (e: Enfant[]) => void; onAnnuler: () => void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [msg, setMsg] = useState("");
  const [occupe, setOccupe] = useState(false);
  const envoyer = async (ev: FormEvent) => {
    ev.preventDefault();
    if (a !== b) { setMsg("Les deux mots de passe ne sont pas identiques."); return; }
    setMsg(""); setOccupe(true);
    try { onOk((await poster("/api/famille/mot-de-passe", { jeton, nouveau: a })).enfants); } catch (e: any) { setMsg(e.message); } finally { setOccupe(false); }
  };
  return (
    <div className="centre carte connexion">
      <h1>{premiere ? `Bienvenue${prenom ? ` ${prenom}` : ""} !` : "Changer le mot de passe"}</h1>
      <p>{premiere ? "Choisissez votre mot de passe personnel : celui de la classe ne vous servira plus. " : ""}Vos parents utiliseront le même pour voir vos résultats.</p>
      <form onSubmit={envoyer}>
        <input type="password" placeholder="Nouveau mot de passe (8 caractères au moins)" value={a} onChange={e => setA(e.target.value)} required minLength={8} autoComplete="new-password" />
        <input type="password" placeholder="Le même, une deuxième fois" value={b} onChange={e => setB(e.target.value)} required minLength={8} autoComplete="new-password" />
        <button type="submit" className="principal" disabled={occupe}>Enregistrer</button>
      </form>
      {msg && <p className="erreur">{msg}</p>}
      <button className="lien" onClick={onAnnuler}>{premiere ? "Retour" : "Annuler"}</button>
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
                {b.colonnes.map(c => <td key={c.cle} className={b.manuelles?.includes(c.cle) ? "manuelle" : ""} title={b.manuelles?.includes(c.cle) ? "Note saisie par l'enseignant" : undefined}>{note(b.notes[c.cle])}</td>)}
                <td><strong>{note(b.moyenne)}</strong></td>
                {b.externes.map(x => <td key={x.id}>{note(b.externesNotes[x.id])}</td>)}
              </tr></tbody>
            </table>
          </div>
          {!!b.manuelles?.length && <p className="petit"><span className="manuelle-legende">En violet</span> : note saisie par l'enseignant.</p>}
          {b.autoEval && <p className="appreciation-famille"><strong>Appréciation de l'élève :</strong> {b.autoEval}</p>}
          {b.appreciation && <p className="appreciation-famille"><strong>Appréciation du professeur :</strong> {b.appreciation}</p>}
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
                  return <td key={c.cle} className={`${r ? couleur(r.percent) : "vide"}${r?.manuelle ? " manuelle" : ""}`} title={r?.manuelle ? "Note saisie par l'enseignant" : undefined}>{r ? <>{r.score && <span className="note">{r.score.replace(/\s*\/\s*/, "/")}</span>} {r.percent} %</> : ""}</td>;
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
type LigneCode = { id: string; nom: string; prenom: string; classe: string; codeLe: string | null; identifiant: string | null; personnalise: boolean };

export function VueCodesFamille() {
  const [classes, setClasses] = useState<{ cle: string; nom: string }[]>([]);
  const [classe, setClasse] = useState("");
  const [eleves, setEleves] = useState<LigneCode[] | null>(null);
  const [fiches, setFiches] = useState<{ codes: { id: string; nom: string; prenom: string; classe: string; identifiant: string; code: string }[]; adresse: string; motDeClasse: string | null } | null>(null);
  const [motDeClasse, setMotDeClasse] = useState("");
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
    try { setFiches(await api("/api/famille/codes", { classe, ...(refIds ? { refIds } : { motDeClasse: motDeClasse.trim() }) })); setMotDeClasse(""); await charger(); } catch (e: any) { setMsg(e.message); } finally { setOccupe(false); }
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
        Chaque élève reçoit une fiche avec son identifiant et le mot de passe de départ de la classe, pour <strong>{location.origin}/famille</strong>.
        À la première connexion, il choisit son mot de passe ; ses parents utilisent le même. Ils y voient seulement leurs propres résultats :
        le tableau et le bulletin que vous avez publiés (bouton « Publier pour les familles »). Mot de passe oublié : bouton « Mot de passe oublié » en face de l'élève.
      </p>
      {msg && <p className="erreur">{msg}</p>}
      {fiches && fiches.codes.length > 0 && (
        <div className="carte">
          <div className="barre">
            <strong>{fiches.codes.length} fiche{fiches.codes.length > 1 ? "s" : ""} créée{fiches.codes.length > 1 ? "s" : ""}</strong>
            <button className="principal" onClick={() => window.print()}>Imprimer les fiches</button>
          </div>
          {fiches.motDeClasse && <p>Mot de passe de départ de la classe : <span className="code">{fiches.motDeClasse}</span></p>}
          <p className="petit">Notez-le ou imprimez les fiches maintenant : il n'est montré qu'une fois. Conseil : faites la première connexion en classe, tous ensemble, pour que chacun choisisse aussitôt son mot de passe (tant qu'un élève ne l'a pas fait, un camarade qui connaît le mot de passe de classe peut ouvrir son compte).</p>
          <div className="fiches">
            {fiches.codes.map(c => (
              <div key={c.id} className="fiche-code">
                <strong>{c.prenom} {c.nom}</strong> <span className="petit">({c.classe})</span>
                <div>Adresse : {fiches.adresse}</div>
                <div>Accueil élève : choisis ton enseignant, ta classe et ton nom.</div>
                <div className="petit-fiche">(ou identifiant : <span className="code">{c.identifiant}</span>)</div>
                <div>Mot de passe de départ : <span className="code">{c.code}</span></div>
                <div className="petit-fiche">À la première connexion, choisis ton mot de passe. Tes parents utiliseront le même.</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {eleves && (
        <>
          <div className="barre">
            {sansCode.length > 0 && <input placeholder="Mot de passe de classe (vide : tiré au hasard)" value={motDeClasse} onChange={e => setMotDeClasse(e.target.value)} maxLength={60} />}
            <button className="principal" disabled={occupe || !sansCode.length} onClick={() => creer()}>
              {sansCode.length ? `Créer les fiches (${sansCode.length} élève${sansCode.length > 1 ? "s" : ""})` : "Tous les élèves ont leur fiche"}
            </button>
          </div>
          <table className="corr">
            <thead><tr><th>Élève</th><th>Identifiant</th><th>Accès</th><th></th></tr></thead>
            <tbody>
              {eleves.map(e => (
                <tr key={e.id}>
                  <td>{e.nom} {e.prenom}</td>
                  <td>{e.identifiant || "–"}</td>
                  <td>{!e.codeLe ? "pas encore de fiche" : e.personnalise ? "mot de passe choisi" : `fiche du ${new Date(e.codeLe).toLocaleDateString("fr-FR")}, pas encore utilisée`}</td>
                  <td><button className="lien" disabled={occupe} onClick={() => { if (!e.codeLe || confirm(`Mot de passe oublié : nouveau mot de passe de départ, personnel, pour ${e.prenom} ${e.nom} ? Son mot de passe actuel ne fonctionnera plus : il en choisira un nouveau.`)) creer([e.id]); }}>{e.codeLe ? "Mot de passe oublié" : "Créer sa fiche"}</button></td>
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
