import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { EnteteColonne } from "./outils.tsx";
import { BoutonPublier } from "./Famille.tsx";

type Trimestre = "T1" | "T2" | "T3";
type Periodes = Record<Trimestre, { debut: string; fin: string }>;
type Colonne = { cle: string; app: string; titre: string; coef?: number };
type Externe = { id: string; titre: string };
type LigneBulletin = {
  id: string; nom: string; prenom: string; calculee: number | null; notes?: Record<string, number | null>; manuelles?: string[]; autres?: Record<string, { note: number | null; manuelle: boolean }>; finale: number | null; figeeLe: string | null;
  externes: Record<string, number | null>; appreciation: string; appreciationEcrite?: boolean; studio?: { eleve: string; prof: string };
  remarques?: { date: string; seance: string; texte: string }[];
};
type Bulletin = {
  periodes: Periodes; classes: { cle: string; nom: string }[]; colonnesDispo: Colonne[];
  colonnes?: Colonne[]; externes?: Externe[]; eleves?: LigneBulletin[]; studioRelie?: boolean; publieLe?: string | null;
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

  const charger = useCallback(async (silencieux = false) => {
    try {
      const q = trimestre && classe ? `?trimestre=${trimestre}&classe=${encodeURIComponent(classe)}` : "";
      const d = await api<Bulletin>(`/api/bulletin${q}`, undefined, silencieux);
      setB(d); setMsg("");
      if (!trimestre) setTrimestre(trimestreDuJour(d.periodes));
      if (!classe && d.classes.length === 1) setClasse(d.classes[0].cle);
      if (q) setReglage(!d.colonnes?.length);
    } catch (e: any) { setMsg(e.message); }
  }, [trimestre, classe]);
  useEffect(() => { charger(); }, [charger]);
  // Après une saisie, la page change tout de suite ; le bulletin (moyennes) est relu discrètement 3 secondes après la dernière.
  const relecture = useRef<number | undefined>(undefined);
  const relireBientot = () => { window.clearTimeout(relecture.current); relecture.current = window.setTimeout(() => charger(true), 3000); };
  const changerLigne = (refId: string, f: (l: LigneBulletin) => LigneBulletin) =>
    setB(prev => prev && { ...prev, eleves: prev.eleves?.map(l => (l.id === refId ? f(l) : l)) });

  const enregistrer = async (refId: string, champ: Record<string, unknown>) => {
    setMsg("");
    const nombre = (v: unknown) => (v === null || v === "" ? null : Number(String(v).replace(",", ".")));
    changerLigne(refId, l => ({
      ...l,
      ...("finale" in champ ? { finale: nombre(champ.finale) } : {}),
      ...("appreciation" in champ ? { appreciation: String(champ.appreciation), appreciationEcrite: true } : {}),
      ...("externes" in champ ? { externes: Object.fromEntries(Object.entries(champ.externes as Record<string, unknown>).map(([k, v]) => [k, nombre(v)])) } : {}),
    }));
    try { await api("/api/bulletin/eleve", { trimestre, classe, refId, ...champ }, true); relireBientot(); } catch (e: any) { setMsg(e.message); charger(true); }
  };

  // Note d'une colonne saisie à la main (perdue ou absente des applications) ; vide efface la note saisie.
  const saisirNote = async (refId: string, cle: string, v: string, manuelle: boolean) => {
    if (!v.trim() && !manuelle) return; // effacer une note des applications : rien à faire
    setMsg("");
    if (v.trim()) changerLigne(refId, l => ({ ...l, notes: { ...l.notes, [cle]: Number(v.replace(",", ".")) }, manuelles: [...(l.manuelles || []).filter(c => c !== cle), cle] }));
    try { await api("/api/notes-manuelles", { refId, cle, note: v, trimestre }, true); relireBientot(); } catch (e: any) { setMsg(e.message); charger(true); }
  };

  if (!b || !trimestre) return msg ? <p className="erreur">{msg}</p> : <p>Chargement…</p>;
  const externes = b.externes || [];
  const colonnes = b.colonnes || [];
  const pret = !!(classe && b.eleves && b.colonnes?.length && !reglage);

  const exporter = () => {
    const entete = ["Nom", "Prénom", ...colonnes.map(c => `${c.titre} (coef. ${note(c.coef ?? 1)})`), "Moyenne calculée", "Note définitive", ...externes.map(x => x.titre), "Appréciation de l'élève", "Appréciation du professeur"];
    const lignes = (b.eleves || []).map(e => [e.nom, e.prenom, ...colonnes.map(c => note(e.notes?.[c.cle])), note(e.calculee), note(e.finale), ...externes.map(x => note(e.externes[x.id])), e.studio?.eleve || "", e.appreciation]);
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
        {pret && <BoutonPublier publieLe={b.publieLe || null}
          onPublier={async () => { try { await api("/api/publier/bulletin", { trimestre, classe }); setInfo("Bulletin publié : chaque élève et ses parents voient leur ligne dans l'espace Famille."); await charger(); } catch (e: any) { setMsg(e.message); } }}
          onRetirer={async () => { try { await api("/api/publier/bulletin", { trimestre, classe, retirer: true }); await charger(); } catch (e: any) { setMsg(e.message); } }} />}
      </div>
      {msg && <p className="erreur">{msg}</p>}
      {info && <p className="info">{info}</p>}
      {!b.classes.length && <p>Aucune classe pour l'instant : reliez d'abord vos applications.</p>}
      {classe && reglage && <ReglageColonnes b={b} trimestre={trimestre} classe={classe} onFini={() => { setReglage(false); charger(); }} />}
      {pret && (
        <>
          {!b.studioRelie && <p className="petit">Pour voir ici les appréciations écrites dans le Studio d'Appréciations, reliez-le dans « Mes applications ».</p>}
          <p className="petit">Chaque colonne montre la note sur 20 du dernier essai du trimestre ; la moyenne calculée en tient compte avec les coefficients. Une note perdue ou absente ? Écrivez-la dans la case : elle apparaît <span className="manuelle-legende">en violet</span>. Si une case a deux notes (celle de l'application et celle saisie), la plus récente compte, l'autre est affichée à côté en petit. Écrivez une note définitive, ou cliquez sur « Figer les notes » : elle ne sera plus mise à jour par le logiciel, mais vous pourrez toujours la changer.</p>
          <div className="defile">
            <table className="tableau bulletin">
              <thead><tr>
                <th className="fixe">Élève</th>
                {colonnes.map(c => <th key={c.cle} className="exo" title={`${c.app} : ${c.titre}`}><EnteteColonne titre={c.titre} />
                  <span className="coef">coef. <ChampCoef valeur={c.coef ?? 1} onValider={async v => {
                    setMsg("");
                    try { await api("/api/bulletin/colonnes", { trimestre, classe, colonnes: colonnes.map(x => (x.cle === c.cle ? { ...x, coef: v } : x)), externes }); await charger(); } catch (e: any) { setMsg(e.message); }
                  }} /></span></th>)}
                <th>Moyenne calculée</th><th>Définitive</th>
                {externes.map(x => <th key={x.id}>{x.titre}</th>)}
                <th>Appréciation de l'élève<span className="coef">Studio, partie élève</span></th>
                <th>Appréciation du professeur<span className="coef">{b.studioRelie ? "reprise du Studio, modifiable" : "à écrire"}</span></th>
              </tr></thead>
              <tbody>
                {b.eleves!.map(e => (
                  <tr key={e.id}>
                    <td className="fixe"><span className="nom">{e.nom} {e.prenom}</span></td>
                    {colonnes.map(c => {
                      const manuelle = !!e.manuelles?.includes(c.cle);
                      return <td key={c.cle} className={manuelle ? "manuelle" : ""} title={manuelle ? "Note saisie à la main" : "Note des applications (saisir une note pour la remplacer)"}>
                        <ChampNote valeur={e.notes?.[c.cle] ?? null} indication="–" onValider={v => saisirNote(e.id, c.cle, v, manuelle)} />
                        <AutreNote autre={e.autres?.[c.cle]} onEffacer={() => saisirNote(e.id, c.cle, "", true)} />
                      </td>;
                    })}
                    <td><strong>{note(e.calculee) || "–"}</strong></td>
                    <td className={`definitive${e.finale !== null ? " figee" : ""}`}>
                      <ChampNote valeur={e.finale} indication={note(e.calculee)} onValider={v => enregistrer(e.id, { finale: v })} />
                      {e.finale !== null && <button className="lien" title="Revenir à la note calculée" onClick={() => enregistrer(e.id, { finale: null })}>↺</button>}
                    </td>
                    {externes.map(x => (
                      <td key={x.id}><ChampNote valeur={e.externes[x.id] ?? null} onValider={v => enregistrer(e.id, { externes: { ...e.externes, [x.id]: v } })} /></td>
                    ))}
                    <td className="appreciation eleve">{e.studio?.eleve || <span className="petit">–</span>}</td>
                    <td className="appreciation">
                      <ChampTexte valeur={e.appreciation} onValider={v => enregistrer(e.id, { appreciation: v })} />
                      {!e.appreciationEcrite && !!e.studio?.prof && <div className="studio">Reprise du Studio</div>}
                      {e.appreciationEcrite && !!e.studio?.prof && e.studio.prof !== e.appreciation && (
                        <div className="studio"><span>Studio : {e.studio.prof}</span> <button className="lien" onClick={() => enregistrer(e.id, { appreciation: e.studio!.prof })}>Reprendre</button></div>
                      )}
                      {!!e.remarques?.length && (
                        <details className="studio">
                          <summary>Plan de classe : {e.remarques.length} remarque{e.remarques.length > 1 ? "s" : ""}</summary>
                          <ul>{e.remarques.map((r, i) => <li key={i}><strong>{new Date(`${r.date}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</strong>{r.seance ? ` (${r.seance})` : ""} : {r.texte}</li>)}</ul>
                        </details>
                      )}
                    </td>
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

/** L'autre note de la colonne, à côté de celle qui compte : celle de l'application (gris) ou celle saisie à la main (violet). */
function AutreNote({ autre, onEffacer }: { autre?: { note: number | null; manuelle: boolean }; onEffacer: () => void }) {
  if (!autre || autre.note === null) return null;
  return autre.manuelle
    ? <span className="autre-note manuelle-legende" title="Note saisie à la main, plus ancienne que celle de l'application : elle ne compte pas">{note(autre.note)}
      <button className="lien" title="Effacer la note saisie" onClick={onEffacer}>✕</button></span>
    : <span className="autre-note appli" title="Note de l'application, plus ancienne que la note saisie : elle ne compte pas">{note(autre.note)}</span>;
}

/** Entrée : enregistre la case et passe à la même colonne de l'élève suivant. */
function allerEnDessous(input: HTMLInputElement) {
  const td = input.closest("td");
  const suivant = (td?.parentElement?.nextElementSibling as HTMLTableRowElement | null)?.cells[td!.cellIndex]?.querySelector("input");
  if (suivant) { suivant.focus(); suivant.select(); } else input.blur();
}

function ChampNote({ valeur, indication, onValider }: { valeur: number | null; indication?: string; onValider: (v: string) => void }) {
  const [v, setV] = useState(note(valeur));
  useEffect(() => setV(note(valeur)), [valeur]);
  return (
    <input className="note" inputMode="decimal" value={v} placeholder={indication || ""} onChange={e => setV(e.target.value)}
      onBlur={() => { if (v !== note(valeur)) onValider(v); }} enterKeyHint="next" onKeyDown={e => { if (e.key === "Enter") allerEnDessous(e.target as HTMLInputElement); }} />
  );
}

function ChampCoef({ valeur, onValider }: { valeur: number; onValider: (v: number) => void }) {
  const [v, setV] = useState(note(valeur));
  useEffect(() => setV(note(valeur)), [valeur]);
  const valider = () => {
    const n = Number(v.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) { setV(note(valeur)); return; }
    if (n !== valeur) onValider(n);
  };
  return <input className="coef" inputMode="decimal" title="Coefficient : de 0,5 à 10" value={v} onChange={e => setV(e.target.value)} onBlur={valider} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />;
}

function ChampTexte({ valeur, onValider }: { valeur: string; onValider: (v: string) => void }) {
  const [v, setV] = useState(valeur);
  useEffect(() => setV(valeur), [valeur]);
  return <textarea rows={2} value={v} maxLength={2000} onChange={e => setV(e.target.value)} onBlur={() => { if (v !== valeur) onValider(v); }} />;
}

function ReglageColonnes({ b, trimestre, classe, onFini }: { b: Bulletin; trimestre: Trimestre; classe: string; onFini: () => void }) {
  const [coches, setCoches] = useState<string[]>((b.colonnes || []).map(c => c.cle));
  const [coefs, setCoefs] = useState<Record<string, string>>(Object.fromEntries((b.colonnes || []).map(c => [c.cle, note(c.coef ?? 1)])));
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
      <p className="petit">Cochez les exercices qui comptent pour ce trimestre et donnez-leur un coefficient. Seuls les exercices faits par les élèves de cette classe sont proposés. La moyenne calculée est la moyenne de ces notes, avec leurs coefficients, sur 20.</p>
      {!b.colonnesDispo.length && <p>Pas encore d'exercice avec des résultats pour cette classe.</p>}
      {Array.from(parApp.entries()).map(([app, cols]) => (
        <fieldset key={app}>
          <legend>{app}</legend>
          {cols.map(c => (
            <span key={c.cle} className="case">
              <label><input type="checkbox" checked={coches.includes(c.cle)} onChange={() => basculer(c.cle)} /> {c.titre}</label>
              {coches.includes(c.cle) && <>
                <span className="petit">coef.</span>
                <input className="coef" inputMode="decimal" value={coefs[c.cle] ?? "1"} onChange={e => setCoefs({ ...coefs, [c.cle]: e.target.value })} />
              </>}
            </span>
          ))}
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
        const colonnes = toutes.filter(c => coches.includes(c.cle)).map(c => ({ ...c, coef: Number(String(coefs[c.cle] ?? "1").replace(",", ".")) || 1 }));
        try { await api("/api/bulletin/colonnes", { trimestre, classe, colonnes, externes }); onFini(); } catch (e: any) { setMsg(e.message); }
      }}>Enregistrer</button>
      {(b.colonnes || []).length > 0 && <button className="lien" onClick={onFini}>Annuler</button>}
    </div>
  );
}

// --- Prof principal ------------------------------------------------------------------------------
type VuePP = {
  nom: string;
  matieres: { enseignant: string; email: string; externes: Externe[]; notes: Record<string, { note: number | null; definitive: boolean; externes: Record<string, number | null>; appreciation: string }> }[];
  eleves: { id: string; nom: string; prenom: string; moyenne: number | null; autoEval: string }[];
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
                  <td className="appreciation">
                    {v.matieres.filter(m => m.notes[e.id]?.appreciation).map(m => <div key={m.email}><em>{m.enseignant} :</em> {m.notes[e.id].appreciation}</div>)}
                    {e.autoEval && <div className="studio eleve"><em>L'élève :</em> {e.autoEval}</div>}
                  </td>
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
