import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api.ts";

type Ligne = { id: string; nom: string; prenom: string; parents: { n: 1 | 2; email: string; envoyeLe: string | null }[] };
const dateFr = (d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

// --- Envoi des mots de passe aux parents (prof principal, administrateur) ------------------------
export function VueParents({ classes }: { classes: { cle: string; nom: string }[] }) {
  const [classe, setClasse] = useState(classes.length === 1 ? classes[0].cle : "");
  const [eleves, setEleves] = useState<Ligne[] | null>(null);
  const [coches, setCoches] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [info, setInfo] = useState("");
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    if (!classe) return;
    try { setEleves((await api<{ eleves: Ligne[] }>(`/api/parents?classe=${encodeURIComponent(classe)}`)).eleves); setMsg(""); } catch (e: any) { setMsg(e.message); }
  }, [classe]);
  useEffect(() => { setCoches([]); setInfo(""); charger(); }, [charger]);

  const avecAdresse = (eleves || []).filter(e => e.parents.some(p => p.email));
  const jamais = avecAdresse.filter(e => e.parents.some(p => p.email && !p.envoyeLe)).map(e => e.id);
  const basculer = (id: string) => setCoches(c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id]));

  return (
    <section>
      <div className="barre">
        <h2>Parents</h2>
        <select value={classe} onChange={e => setClasse(e.target.value)}>
          <option value="">Choisir la classe…</option>
          {classes.map(c => <option key={c.cle} value={c.cle}>{c.nom}</option>)}
        </select>
      </div>
      <p className="petit">Chaque parent reçoit par e-mail son propre mot de passe, le même dans toutes les applications. Un nouvel envoi remplace l'ancien mot de passe. Les adresses viennent de la liste de l'établissement (colonnes 4 et 5).</p>
      {msg && <p className="erreur pre">{msg}</p>}
      {info && <p className="info pre">{info}</p>}
      {eleves && (
        <>
          <div className="barre">
            <button onClick={() => setCoches(jamais)} disabled={!jamais.length}>Cocher ceux qui n'ont rien reçu ({jamais.length})</button>
            <button onClick={() => setCoches(avecAdresse.map(e => e.id))}>Tout cocher</button>
            <button className="principal" disabled={!coches.length || occupe} onClick={async () => {
              if (!confirm(`Envoyer un nouveau mot de passe aux parents de ${coches.length} élève${coches.length > 1 ? "s" : ""} ?`)) return;
              setOccupe(true); setMsg(""); setInfo("");
              try {
                const r = await api<{ envoyes: number; erreurs: string[] }>("/api/parents/envoyer", { classe, refIds: coches });
                setInfo(`${r.envoyes} e-mail${r.envoyes > 1 ? "s" : ""} envoyé${r.envoyes > 1 ? "s" : ""}.`);
                if (r.erreurs.length) setMsg(`Certaines applications n'ont pas pu être mises à jour :\n${r.erreurs.join("\n")}`);
                setCoches([]); charger();
              } catch (e: any) { setMsg(e.message); } finally { setOccupe(false); }
            }}>{occupe ? "Envoi…" : "Envoyer les mots de passe"}</button>
          </div>
          <table className="corr">
            <thead><tr><th></th><th>Élève</th><th>Parent 1</th><th>Parent 2</th></tr></thead>
            <tbody>
              {eleves.map(e => {
                const possible = e.parents.some(p => p.email);
                return (
                  <tr key={e.id}>
                    <td><input type="checkbox" disabled={!possible} checked={coches.includes(e.id)} onChange={() => basculer(e.id)} /></td>
                    <td>{e.nom} {e.prenom}</td>
                    {e.parents.map(p => (
                      <td key={p.n}>
                        {p.email ? <>{p.email}<br /><span className={p.envoyeLe ? "info petit" : "petit"}>{p.envoyeLe ? `envoyé le ${dateFr(p.envoyeLe)}` : "pas encore envoyé"}</span></> : <span className="petit">pas d'adresse</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

// --- Page publique : mot de passe perdu --------------------------------------------------------------
export function ParentsOubli() {
  const [email, setEmail] = useState("");
  const [fait, setFait] = useState(false);
  const [msg, setMsg] = useState("");
  const envoyer = async (e: FormEvent) => {
    e.preventDefault();
    setMsg("");
    try {
      const r = await fetch("/api/parents/oubli", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Erreur ${r.status}`);
      setFait(true);
    } catch (err: any) { setMsg(err.message); }
  };
  return (
    <div className="centre carte connexion">
      <h1>Mot de passe parent perdu</h1>
      {fait ? (
        <p className="info">Si cette adresse est connue de l'établissement, un nouveau mot de passe vient d'y être envoyé. Pensez à regarder dans les indésirables. L'ancien mot de passe ne fonctionne plus.</p>
      ) : (
        <>
          <p>Écrivez l'adresse e-mail que vous avez donnée à l'établissement. Vous recevrez un nouveau mot de passe, valable dans toutes les applications.</p>
          <form onSubmit={envoyer}>
            <input type="email" placeholder="Votre adresse e-mail" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
            <button type="submit" className="principal">Recevoir un nouveau mot de passe</button>
          </form>
          {msg && <p className="erreur">{msg}</p>}
        </>
      )}
    </div>
  );
}
