import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";

type Trimestre = "T1" | "T2" | "T3";
type Periodes = Record<Trimestre, { debut: string; fin: string }>;
type Colonne = { cle: string; app: string; titre: string };
type Externe = { id: string; titre: string };
type LigneBulletin = {
  id: string; nom: string; prenom: string; calculee: number | null; finale: number | null; figeeLe: string | null;
  externes: Record<string, number | null>; appreciation: string;
};
type Bulletin = {
  periodes: Periodes; classes: { cle: string; nom: string }[]; colonnesDispo: Colonne[];
  colonnes?: Colonne[]; externes?: Externe[]; eleves?: LigneBulletin[];
};

const TRIMESTRES: Trimestre[] = ["T1", "T2", "T3"];
const dateFr = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const note = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "");

/** Trimestre en cours, d'après les dates. */
function trimestreDuJour(p: Periodes): Trimestre {
  const j = new Date().toISOString().slice(0, 10);
  return TRIMESTRES.find(t => j >= p[t].debut && j <= p[t].fin) || "T1";
}

function ChoixPeriode({ periodes, trimestre, setTrimestre, classes, classe, setClasse }: {
  periodes: Periodes; trimestre: Trimestre; setTrimestre: (t: Trimestre) => void;
  classes: { cle: string; nom: string }[]; classe: string; setClasse: (c: string) => void;
}) {
  return (
    <>
      <select value={trimestre} onChange={e => setTrimestre(e.target.value as Trimestre)}>
        {TRIMESTRES.map(t => <option key={t} value={t}>{`${t.slice(1)}${t === "T1" ? "er" : "e"} trimestre (${dateFr(periodes[t].debut)} – ${dateFr(periodes[t].fin)})`}</option>)}
      </select>
      <select value={classe} onChange={e => setClasse(e.target.value)}>
        <option value="">Choisir la classe…</option>
        {classes.map(c => <option key={c.cle} value={c.cle}>{c.nom}</option>)}
      </select>
    </>
  );
}

// --- Bulletin de l'enseignant ----------------------------------------------------------------
export function VueBulletin() {
  const [b, setB] = useState<Bulletin | null>(null);
  const [trimestre, setTrimestre] = useState<Trimestre | null>(null);
  const [classe, setClasse] = useState("");
  const [msg, setMsg] = useState("");
  const [info, setInfo] = useState("");
  const [reglage, setReglage] = useState(false);

  const charger = useCallback(async () => {
    try {
      const q = trimestre && classe ? `?trimestre=${trimestre}&classe=${encodeURIComponent(classe)}` : "";
      const d = await api<Bulletin>(`/api/bulletin${q}`);
      setB(d); setMsg("");
      if (!trimestre) setTrimestre(trimestreDuJour(d.periodes));
      if (!classe && d.classes.length === 1) setClasse(d.classes[0].cle);
      if (q) setReglage(!d.colonnes?.length);
    } catch (e: any) { setMsg(e.message); }
  }, [trimestre, classe]);
  useEffect(() => { charger(); }, [charger]);

  const enregistrer = async (refId: string, champ: Record<string, unknown>) => {
    setMsg("");
    try { await api("/api/bulletin/eleve", { trimestre, classe, refId, ...champ }); await charger(); } catch (e: any) { setMsg(e.message); }
  };

  if (!b || !trimestre) return msg ? <p className="erreur">{msg}</p> : <p>Chargement…</p>;
  const externes = b.externes || [];
  const pret = !!(classe && b.eleves && b.colonnes?.length && !reglage);

  const exporter = () => {
    const entete = ["Nom", "Prénom", "Note calculée", "Note définitive", ...externes.map(x => x.titre), "Appréciation"];
    const lignes = (b.eleves || []).map(e => [e.nom, e.prenom, note(e.calculee), note(e.finale), ...externes.map(x => note(e.externes[x.id])), e.appreciation]);
    const csv = [entete, ...lignes].map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `bulletin-${classe}-${trimestre}.csv`;
    a.click();
  };

  return (
    <section>
      <div className="barre">
        <h2>Bulletin</h2>
        <ChoixPeriode periodes={b.periodes} trimestre={trimestre} setTrimestre={t => { setTrimestre(t); setInfo(""); }} classes={b.classes} classe={classe} setClasse={c => { setClasse(c); setInfo(""); }} />
        {pret && <button onClick={() => setReglage(true)}>Notes reprises</button>}
        {pret && <button onClick={async () => {
          if (!confirm("Les notes calculées deviennent définitives : elles ne bougeront plus si les résultats changent. Les notes déjà posées restent comme elles sont. Continuer ?")) return;
          try { const r = await api<{ figees: number }>("/api/bulletin/figer", { trimestre, classe }); setInfo(`${r.figees} note${r.figees > 1 ? "s" : ""} figée${r.figees > 1 ? "s" : ""}.`); charger(); } catch (e: any) { setMsg(e.message); }
        }}>Figer les notes</button>}
        {pret && <button onClick={exporter}>Exporter (tableur)</button>}
      </div>
      {msg && <p className="erreur">{msg}</p>}
      {info && <p className="info">{info}</p>}
      {!b.classes.length && <p>Aucune classe pour l'instant : reliez d'abord vos applications.</p>}
      {classe && reglage && <ReglageColonnes b={b} trimestre={trimestre} classe={classe} onFini={() => { setReglage(false); charger(); }} />}
      {pret && (
        <>
          <p className="petit">La note calculée suit les résultats du trimestre. Écrivez une note définitive, ou cliquez sur « Figer les notes » : elle ne sera plus mise à jour par le logiciel, mais vous pourrez toujours la changer.</p>
          <div className="defile">
            <table className="tableau bulletin">
              <thead><tr>
                <th className="fixe">Élève</th><th>Calculée</th><th>Définitive</th>
                {externes.map(x => <th key={x.id}>{x.titre}</th>)}
                <th>Appréciation</th>
              </tr></thead>
              <tbody>
                {b.eleves!.map(e => (
                  <tr key={e.id}>
                    <td className="fixe"><span className="nom">{e.nom} {e.prenom}</span></td>
                    <td>{note(e.calculee) || "–"}</td>
                    <td className={e.finale !== null ? "figee" : ""}>
                      <ChampNote valeur={e.finale} indication={note(e.calculee)} onValider={v => enregistrer(e.id, { finale: v })} />
                      {e.finale !== null && <button className="lien" title="Revenir à la note calculée" onClick={() => enregistrer(e.id, { finale: null })}>↺</button>}
                    </td>
                    {externes.map(x => (
                      <td key={x.id}><ChampNote valeur={e.externes[x.id] ?? null} onValider={v => enregistrer(e.id, { externes: { ...e.externes, [x.id]: v } })} /></td>
                    ))}
                    <td className="appreciation"><ChampTexte valeur={e.appreciation} onValider={v => enregistrer(e.id, { appreciation: v })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function ChampNote({ valeur, indication, onValider }: { valeur: number | null; indication?: string; onValider: (v: string) => void }) {
  const [v, setV] = useState(note(valeur));
  useEffect(() => setV(note(valeur)), [valeur]);
  return (
    <input className="note" inputMode="decimal" value={v} placeholder={indication || ""} onChange={e => setV(e.target.value)}
      onBlur={() => { if (v !== note(valeur)) onValider(v); }} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

function ChampTexte({ valeur, onValider }: { valeur: string; onValider: (v: string) => void }) {
  const [v, setV] = useState(valeur);
  useEffect(() => setV(valeur), [valeur]);
  return <textarea rows={2} value={v} maxLength={2000} onChange={e => setV(e.target.value)} onBlur={() => { if (v !== valeur) onValider(v); }} />;
}

function ReglageColonnes({ b, trimestre, classe, onFini }: { b: Bulletin; trimestre: Trimestre; classe: string; onFini: () => void }) {
  const [coches, setCoches] = useState<string[]>((b.colonnes || []).map(c => c.cle));
  const [externes, setExternes] = useState<Externe[]>(b.externes || []);
  const [nouvelle, setNouvelle] = useState("");
  const [msg, setMsg] = useState("");
  const parApp = new Map<string, Colonne[]>();
  // Les colonnes déjà retenues restent proposées, même si l'exercice n'a plus de résultat.
  for (const c of [...b.colonnesDispo, ...(b.colonnes || []).filter(x => !b.colonnesDispo.some(d => d.cle === x.cle))]) parApp.set(c.app, [...(parApp.get(c.app) || []), c]);
  const basculer = (cle: string) => setCoches(c => (c.includes(cle) ? c.filter(x => x !== cle) : [...c, cle]));

  return (
    <div className="carte reglage">
      <h3>Notes reprises dans le bulletin</h3>
      <p className="petit">Cochez les exercices qui comptent pour ce trimestre. La note calculée est la moyenne de ces exercices, ramenée sur 20.</p>
      {!b.colonnesDispo.length && <p>Pas encore d'exercice avec des résultats dans vos applications.</p>}
      {Array.from(parApp.entries()).map(([app, cols]) => (
        <fieldset key={app}>
          <legend>{app}</legend>
          {cols.map(c => <label key={c.cle} className="case"><input type="checkbox" checked={coches.includes(c.cle)} onChange={() => basculer(c.cle)} /> {c.titre}</label>)}
        </fieldset>
      ))}
      <fieldset>
        <legend>Notes externes (saisies à la main)</legend>
        {externes.map(x => (
          <span key={x.id} className="etiquette">{x.titre} <button className="lien" onClick={() => setExternes(externes.filter(y => y.id !== x.id))}>retirer</button></span>
        ))}
        <span className="ajout">
          <input placeholder="Ex. : Oral, Devoir sur table" value={nouvelle} onChange={e => setNouvelle(e.target.value)} maxLength={80} />
          <button disabled={!nouvelle.trim()} onClick={() => { setExternes([...externes, { id: `x${Date.now().toString(36)}`, titre: nouvelle.trim() }]); setNouvelle(""); }}>Ajouter</button>
        </span>
      </fieldset>
      {msg && <p className="erreur">{msg}</p>}
      <button className="principal" disabled={!coches.length} onClick={async () => {
        const toutes = Array.from(parApp.values()).flat();
        try { await api("/api/bulletin/colonnes", { trimestre, classe, colonnes: toutes.filter(c => coches.includes(c.cle)), externes }); onFini(); } catch (e: any) { setMsg(e.message); }
      }}>Enregistrer</button>
      {(b.colonnes || []).length > 0 && <button className="lien" onClick={onFini}>Annuler</button>}
    </div>
  );
}

// --- Prof principal ------------------------------------------------------------------------------
type VuePP = {
  nom: string;
  matieres: { enseignant: string; email: string; externes: Externe[]; notes: Record<string, { note: number | null; definitive: boolean; externes: Record<string, number | null>; appreciation: string }> }[];
  eleves: { id: string; nom: string; prenom: string; moyenne: number | null }[];
};

export function VueProfPrincipal({ classes, periodes }: { classes: { cle: string; nom: string }[]; periodes: Periodes }) {
  const [trimestre, setTrimestre] = useState<Trimestre>(trimestreDuJour(periodes));
  const [classe, setClasse] = useState(classes.length === 1 ? classes[0].cle : "");
  const [v, setV] = useState<VuePP | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!classe) return;
    api<VuePP>(`/api/pp/bulletin?trimestre=${trimestre}&classe=${encodeURIComponent(classe)}`).then(d => { setV(d); setMsg(""); }).catch(e => setMsg(e.message));
  }, [trimestre, classe]);

  return (
    <section>
      <div className="barre">
        <h2>Prof principal</h2>
        <ChoixPeriode periodes={periodes} trimestre={trimestre} setTrimestre={setTrimestre} classes={classes} classe={classe} setClasse={setClasse} />
      </div>
      <p className="petit">Les notes de vos collègues pour cette classe, en lecture seule. En gras : note définitive ; sinon, note calculée lors de la dernière ouverture de leur bulletin.</p>
      {msg && <p className="erreur">{msg}</p>}
      {v && classe && (!v.matieres.length ? <p>Aucun collègue n'a encore préparé son bulletin pour ce trimestre.</p> : (
        <div className="defile">
          <table className="tableau bulletin">
            <thead><tr>
              <th className="fixe">Élève</th>
              {v.matieres.map(m => <th key={m.email} colSpan={1 + m.externes.length}>{m.enseignant}</th>)}
              <th>Moyenne</th><th>Appréciations</th>
            </tr></thead>
            <tbody>
              {v.eleves.map(e => (
                <tr key={e.id}>
                  <td className="fixe"><span className="nom">{e.nom} {e.prenom}</span></td>
                  {v.matieres.flatMap(m => {
                    const n = m.notes[e.id];
                    return [
                      <td key={m.email} className={n?.definitive ? "figee" : ""}>{n?.definitive ? <strong>{note(n.note)}</strong> : note(n?.note)}</td>,
                      ...m.externes.map(x => <td key={`${m.email}:${x.id}`} title={x.titre}>{note(n?.externes?.[x.id])}</td>),
                    ];
                  })}
                  <td><strong>{note(e.moyenne)}</strong></td>
                  <td className="appreciation">{v.matieres.filter(m => m.notes[e.id]?.appreciation).map(m => <div key={m.email}><em>{m.enseignant} :</em> {m.notes[e.id].appreciation}</div>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

// --- Réglages de l'administrateur : professeurs principaux et trimestres ------------------------
export function ReglagesAdmin() {
  const [r, setR] = useState<{ periodes: Periodes; classes: { cle: string; nom: string; pp: string[] }[] } | null>(null);
  const [classe, setClasse] = useState("");
  const [emails, setEmails] = useState("");
  const [dates, setDates] = useState<Periodes | null>(null);
  const [msg, setMsg] = useState("");
  const [info, setInfo] = useState("");

  const charger = useCallback(async () => {
    try { const d = await api<any>("/api/admin/reglages"); setR(d); setDates(d.periodes); } catch (e: any) { setMsg(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);
  const faire = async (fn: () => Promise<any>, ok: string) => { setMsg(""); setInfo(""); try { await fn(); setInfo(ok); charger(); } catch (e: any) { setMsg(e.message); } };

  if (!r || !dates) return msg ? <p className="erreur">{msg}</p> : null;
  return (
    <>
      <h2 className="espace">Professeurs principaux</h2>
      <p className="petit">Le professeur principal voit les notes de tous ses collègues pour sa classe, sans pouvoir les modifier.</p>
      {r.classes.length > 0 && <ul>{r.classes.map(c => <li key={c.cle}><strong>{c.nom}</strong> : {c.pp.join(", ")}</li>)}</ul>}
      <div className="barre">
        <input placeholder="Classe (ex. : 5e B)" value={classe} onChange={e => setClasse(e.target.value)} />
        <input placeholder="Adresse(s) e-mail" value={emails} onChange={e => setEmails(e.target.value)} />
        <button disabled={!classe.trim()} onClick={() => faire(async () => { await api("/api/admin/pp", { classe, emails }); setClasse(""); setEmails(""); }, "Enregistré.")}>Enregistrer</button>
      </div>
      <p className="petit">Laissez l'adresse vide pour retirer le professeur principal d'une classe.</p>
      <h2 className="espace">Dates des trimestres</h2>
      <div className="dates">
        {TRIMESTRES.map(t => (
          <div key={t}>
            <strong>{t}</strong>
            <input type="date" value={dates[t].debut} onChange={e => setDates({ ...dates, [t]: { ...dates[t], debut: e.target.value } })} />
            <span>au</span>
            <input type="date" value={dates[t].fin} onChange={e => setDates({ ...dates, [t]: { ...dates[t], fin: e.target.value } })} />
          </div>
        ))}
      </div>
      <button onClick={() => faire(() => api("/api/admin/trimestres", dates), "Dates enregistrées.")}>Enregistrer les dates</button>
      {msg && <p className="erreur">{msg}</p>}
      {info && <p className="info">{info}</p>}
    </>
  );
}
