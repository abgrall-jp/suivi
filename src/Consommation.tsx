import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";
import { cout, estPeriode, PERIODES, valeurs, type Alerte, type LigneApp, type Periode, type Seuils, type Valeurs } from "../lib/consommation.ts";

// Onglet « Consommation » (administrateur) : appels à l'IA, refus et erreurs de chaque application, relus chaque minute.

type Reponse = {
  lu: number; seuils: Seuils; alertes: Alerte[]; applications: LigneApp[];
  minutes: { t: number; ia: number; pic: number }[];
  total: { ia1h: number; ia24h: number; r429h: number; r402h: number; ia429h: number; e5xxh: number; cout1h: number; cout24h: number; picIaMinute: number; picSimultanees: number; enCours: number };
};

/** Colonnes du tableau dont la durée se choisit, avec leur durée par défaut. */
const COLONNES = {
  ia: { titre: "Appels IA", defaut: "24h" },
  picIa: { titre: "Pic IA", sous: "par minute", defaut: "1h" },
  reponse: { titre: "Réponse IA", sous: "moyenne", defaut: "1h" },
  depense: { titre: "Dépense", defaut: "24h" },
  r429: { titre: "Trop de demandes", defaut: "24h" },
  r402: { titre: "Crédits épuisés", defaut: "24h" },
  erreurs: { titre: "Erreurs", sous: "IA · serveur", defaut: "24h" },
  req: { titre: "Demandes", defaut: "1h" },
} satisfies Record<string, { titre: string; sous?: string; defaut: Periode }>;
type Colonne = keyof typeof COLONNES;
const CLE_DUREES = "suivi-conso-durees";
function lireDurees(): Record<Colonne, Periode> {
  const d = Object.fromEntries(Object.entries(COLONNES).map(([k, c]) => [k, c.defaut])) as Record<Colonne, Periode>;
  try {
    const l = JSON.parse(localStorage.getItem(CLE_DUREES) || "{}");
    for (const k of Object.keys(d) as Colonne[]) if (estPeriode(l[k])) d[k] = l[k];
  } catch { /* navigation privée */ }
  return d;
}
const jourFr = (j: string) => new Date(j + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

const nb = (n: number) => n.toLocaleString("fr-FR");
const dollars = (n: number) => (n < 0.01 && n > 0 ? "< 0,01 $" : `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`);
const heure = (t: number) => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const depuis = (t: number) => {
  const m = Math.round((Date.now() - t) / 60e3);
  return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} j`;
};

export function VueConsommation() {
  const [d, setD] = useState<Reponse | null>(null);
  const [msg, setMsg] = useState("");
  const charger = useCallback(async (silencieux = false) => {
    try { setD(await api<Reponse>("/api/admin/consommation", undefined, silencieux)); setMsg(""); } catch (e: any) { setMsg(e.message); }
  }, []);
  useEffect(() => {
    charger();
    const id = setInterval(() => { if (!document.hidden) charger(true); }, 60e3);
    return () => clearInterval(id);
  }, [charger]);

  if (!d) return <section><h2>Consommation des applications</h2><p className={msg ? "erreur" : ""}>{msg || "Lecture des applications…"}</p></section>;
  const s = d.seuils, t = d.total;
  const absentes = d.applications.filter(a => a.etat === "absent");
  return (
    <section className="conso">
      <div className="barre">
        <h2>Consommation des applications</h2>
        <span className="petit">Lu à {heure(d.lu)}, relu chaque minute.</span>
        <button onClick={() => charger()}>Actualiser</button>
      </div>
      {msg && <p className="erreur">{msg}</p>}

      {d.alertes.length === 0
        ? <p className="conso-ok">✓ Aucune limite approchée dans la dernière heure.</p>
        : <ul className="conso-alertes">
          {d.alertes.map((a, i) => (
            <li key={i} className={a.niveau}>
              <strong>{a.niveau === "danger" ? "⛔ Dépassement" : "⚠ Attention"}</strong>
              {a.app && <span className="etiquette">{a.app}</span>}
              <span>{a.texte}</span>
            </li>
          ))}
        </ul>}

      <div className="conso-tuiles">
        <Tuile titre="Appels à l'IA, dernière heure" valeur={nb(t.ia1h)} detail={`${nb(t.ia24h)} sur 24 h`} />
        <Tuile titre="Pic par minute (toutes applis)" valeur={nb(t.picIaMinute)} detail={`seuil ${nb(s.iaParMinute)}`} niveau={niveau(t.picIaMinute, s.iaParMinute)} />
        <Tuile titre="Demandes en même temps, au plus" valeur={nb(t.picSimultanees)} detail={`limite o2switch ${s.simultanees}`} niveau={niveau(t.picSimultanees, s.simultanees)} />
        <Tuile titre="Dépense IA estimée, 24 h" valeur={dollars(t.cout24h)} detail={`seuil ${s.coutJour} $ · ${dollars(t.cout1h)} dans l'heure`} niveau={niveau(t.cout24h, s.coutJour)} />
        <Tuile titre="Refus « Trop de demandes », 1 h" valeur={nb(t.r429h)} detail="limites des applications" niveau={t.r429h ? "attention" : undefined} />
        <Tuile titre="Crédits IA épuisés, 1 h" valeur={nb(t.r402h)} detail={`quota Google atteint : ${nb(t.ia429h)}`} niveau={t.r402h || t.ia429h ? "danger" : undefined} />
      </div>

      <Graphique minutes={d.minutes} />

      <Tableau d={d} />
      {absentes.length > 0 && <p className="petit">Sans chiffres pour le moment : {absentes.map(a => a.nom).join(", ")}.</p>}
      <p className="petit">
        Chaque application garde ses chiffres minute par minute sur 24 heures et jour par jour sur un an, même après un redémarrage
        (la durée de chaque colonne se choisit dans son petit menu). La dépense est une estimation
        d'après les jetons ({s.prixEntree} $ le million lus, {s.prixSortie} $ le million écrits) : la facture exacte est dans Google Cloud &gt; Facturation.
        Les seuils se règlent dans cPanel, variables de Suivi : SEUIL_IA_PAR_MINUTE, SEUIL_SIMULTANEES, SEUIL_COUT_JOUR, SEUIL_ERREURS_HEURE,
        PRIX_IA_ENTREE, PRIX_IA_SORTIE. Alerte à 80 % d'un seuil.
      </p>
    </section>
  );
}

/** Tableau par application ; chaque colonne a sa durée (1 heure à 1 an), retenue par le navigateur. */
function Tableau({ d }: { d: Reponse }) {
  const [durees, setDurees] = useState(lireDurees);
  const choisir = (c: Colonne, p: Periode) => {
    const n = { ...durees, [c]: p };
    setDurees(n);
    try { localStorage.setItem(CLE_DUREES, JSON.stringify(n)); } catch { /* navigation privée */ }
  };
  const nomPeriode = (p: Periode) => PERIODES.find(x => x.id === p)!.nom;
  const lignes = d.applications.map(a => {
    const v = {} as Record<Colonne, Valeurs | null>;
    for (const c of Object.keys(COLONNES) as Colonne[]) v[c] = a.rapport ? valeurs(a.rapport, durees[c]) : null;
    return { a, v };
  });
  // Totaux : somme des applications qui ont des chiffres pour la durée choisie.
  const total = (c: Colonne, f: (x: Valeurs) => number) => lignes.reduce((n, l) => n + (l.v[c] ? f(l.v[c]!) : 0), 0);
  const manque = (c: Colonne) => lignes.some(l => l.a.rapport && !l.v[c]);
  const cellule = (c: Colonne, x: Valeurs | null, texte: (x: Valeurs) => string, classe?: (x: Valeurs) => string) => {
    if (!x) return <td title="Historique par jour pas encore disponible : mettre à jour le fichier conso.cjs de cette application.">–</td>;
    return (
      <td className={classe?.(x) || ""} title={x.depuis ? `Chiffres depuis le ${jourFr(x.depuis)} (début de l'historique)` : undefined}>
        {texte(x)}{x.depuis && <sup>*</sup>}
      </td>
    );
  };
  const moyenne = (ia: number, ms: number) => (ia ? `${(ms / ia / 1000).toFixed(1).replace(".", ",")} s` : "–");
  const premier = lignes.flatMap(l => l.a.rapport?.jours?.map(j => j.jour) || []).sort()[0];
  const partiel = lignes.some(l => Object.values(l.v).some(x => x?.depuis));
  return (
    <>
      <div className="defile conso-table">
        <table className="tableau">
          <thead>
            <tr>
              <th className="fixe">Application</th>
              {(Object.entries(COLONNES) as [Colonne, { titre: string; sous?: string }][]).map(([c, col]) => (
                <th key={c}>
                  {col.titre}{col.sous && <><br /><small>{col.sous}</small></>}<br />
                  <select className="conso-duree" value={durees[c]} onChange={e => choisir(c, e.target.value as Periode)} aria-label={`Durée de la colonne ${col.titre}`}>
                    {PERIODES.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
                  </select>
                </th>
              ))}
              <th>Mémoire</th>
              <th>Démarrée</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map(({ a, v }) => {
              const r = a.rapport;
              if (!r) return (
                <tr key={a.id}>
                  <td className="fixe">{a.nom}</td>
                  <td colSpan={10} className={a.etat === "erreur" ? "erreur gauche" : "petit gauche"}>
                    {a.etat === "erreur" ? `⛔ ${a.message}` : a.message ? `Compteurs ${a.message}.` : "Compteurs pas encore installés (fichier conso.cjs)."}
                  </td>
                </tr>
              );
              return (
                <tr key={a.id}>
                  <td className="fixe">
                    <details>
                      <summary>{a.nom}</summary>
                      <Motifs titre="Dernière heure" motifs={r.derniereHeure.motifs} />
                      <Motifs titre="24 heures" motifs={r.dernieres24h.motifs} />
                      {Object.keys(r.limites).length > 0 && <p className="petit">Réglages : {Object.entries(r.limites).map(([k, val]) => `${k} = ${val}`).join(", ")}</p>}
                    </details>
                  </td>
                  {cellule("ia", v.ia, x => nb(x.ia))}
                  {cellule("picIa", v.picIa, x => (Number.isNaN(x.iaMin) ? "–" : nb(x.iaMin)))}
                  {cellule("reponse", v.reponse, x => moyenne(x.ia, x.iaMs))}
                  {cellule("depense", v.depense, x => dollars(cout(x, d.seuils)))}
                  {cellule("r429", v.r429, x => nb(x.r429), x => (x.r429 ? "moyen" : ""))}
                  {cellule("r402", v.r402, x => nb(x.r402), x => (x.r402 ? "faible" : ""))}
                  {cellule("erreurs", v.erreurs, x => `${nb(x.iaErr)} · ${nb(x.e5xx)}`, x => (x.ia429 || x.e5xx ? "faible" : ""))}
                  {cellule("req", v.req, x => nb(x.req))}
                  <td>{r.memoireMo} Mo{r.processus > 1 ? ` (${r.processus} processus)` : ""}</td>
                  <td title={new Date(r.demarreLe).toLocaleString("fr-FR")}>il y a {depuis(r.demarreLe)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th className="fixe">Toutes</th>
              <td>{nb(total("ia", x => x.ia))}{manque("ia") && <sup>†</sup>}</td>
              <td title="Pic de l'application la plus chargée">{nb(Math.max(0, ...lignes.map(l => l.v.picIa?.iaMin || 0)))}</td>
              <td>{moyenne(total("reponse", x => x.ia), total("reponse", x => x.iaMs))}</td>
              <td>{dollars(total("depense", x => cout(x, d.seuils)))}{manque("depense") && <sup>†</sup>}</td>
              <td>{nb(total("r429", x => x.r429))}{manque("r429") && <sup>†</sup>}</td>
              <td>{nb(total("r402", x => x.r402))}{manque("r402") && <sup>†</sup>}</td>
              <td>{nb(total("erreurs", x => x.iaErr))} · {nb(total("erreurs", x => x.e5xx))}{manque("erreurs") && <sup>†</sup>}</td>
              <td>{nb(total("req", x => x.req))}{manque("req") && <sup>†</sup>}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
      {(partiel || Object.keys(COLONNES).some(c => manque(c as Colonne))) && (
        <p className="petit">
          {partiel && <>* L'historique par jour a commencé le {premier ? jourFr(premier) : "…"} : les durées plus longues ne comptent que depuis cette date. </>}
          {Object.keys(COLONNES).some(c => manque(c as Colonne)) && <>– et † : certaines applications n'ont pas encore l'historique par jour (fichier conso.cjs à mettre à jour), elles ne sont pas comptées dans le total.</>}
        </p>
      )}
    </>
  );
}

const niveau = (v: number, max: number) => (v >= max ? "danger" : v >= 0.8 * max ? "attention" : undefined);

function Tuile({ titre, valeur, detail, niveau }: { titre: string; valeur: string; detail: string; niveau?: "danger" | "attention" }) {
  return (
    <div className={`conso-tuile ${niveau || ""}`}>
      <span className="petit">{titre}</span>
      <strong>{niveau === "danger" ? "⛔ " : niveau === "attention" ? "⚠ " : ""}{valeur}</strong>
      <span className="petit">{detail}</span>
    </div>
  );
}

function Motifs({ titre, motifs }: { titre: string; motifs: { motif: string; n: number }[] }) {
  return (
    <div className="petit">
      <strong>{titre}</strong>
      {motifs.length ? <ul>{motifs.map(m => <li key={m.motif}>{m.motif} : {m.n}</li>)}</ul> : <> : aucun refus ni erreur.</>}
    </div>
  );
}

/** Appels à l'IA par minute sur la dernière heure, toutes applications ensemble. */
function Graphique({ minutes }: { minutes: { t: number; ia: number }[] }) {
  const [survol, setSurvol] = useState<number | null>(null);
  const max = Math.max(5, ...minutes.map(m => m.ia));
  const L = 600, H = 100, pas = L / minutes.length;
  const m = survol === null ? null : minutes[survol];
  return (
    <figure className="conso-graphique">
      <figcaption>
        <strong>Appels à l'IA par minute</strong> <span className="petit">dernière heure, toutes applications</span>
        <span className="petit conso-survol">{m ? `${heure(m.t)} : ${nb(m.ia)} appel${m.ia > 1 ? "s" : ""}` : `maximum ${nb(Math.max(0, ...minutes.map(x => x.ia)))}`}</span>
      </figcaption>
      <div className="conso-trace">
        <span className="graduation conso-milieu">{nb(Math.round(max / 2))}</span>
        <svg viewBox={`0 0 ${L} ${H}`} preserveAspectRatio="none" role="img" aria-label="Appels à l'IA par minute sur la dernière heure" onMouseLeave={() => setSurvol(null)}>
          <line x1={0} x2={L} y1={H - 0.5} y2={H - 0.5} className="axe" vectorEffect="non-scaling-stroke" />
          <line x1={0} x2={L} y1={H / 2} y2={H / 2} className="grille" vectorEffect="non-scaling-stroke" />
          {minutes.map((x, i) => {
            const h = x.ia ? Math.max(2, H * x.ia / max) : 0;
            return (
              <g key={x.t} onMouseEnter={() => setSurvol(i)}>
                <rect x={i * pas} y={0} width={pas} height={H} fill="transparent" />
                {h > 0 && <rect x={i * pas + 1} y={H - h} width={pas - 2} height={h} className={survol === i ? "barre-ia actif" : "barre-ia"} />}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="graduation conso-heures"><span>{heure(minutes[0]?.t || 0)}</span><span>{heure(minutes[minutes.length - 1]?.t || 0)}</span></div>
    </figure>
  );
}
