import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";
import type { Alerte, LigneApp, Seuils } from "../lib/consommation.ts";

// Onglet « Consommation » (administrateur) : appels à l'IA, refus et erreurs de chaque application, relus chaque minute.

type Reponse = {
  lu: number; seuils: Seuils; alertes: Alerte[]; applications: LigneApp[];
  minutes: { t: number; ia: number; pic: number }[];
  total: { ia1h: number; ia24h: number; r429h: number; r402h: number; ia429h: number; e5xxh: number; cout1h: number; cout24h: number; picIaMinute: number; picSimultanees: number; enCours: number };
};

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

      <div className="defile conso-table">
        <table className="tableau">
          <thead>
            <tr>
              <th className="fixe">Application</th>
              <th>Appels IA<br /><small>1 h · 24 h</small></th>
              <th>Pic IA<br /><small>par minute</small></th>
              <th>Réponse IA<br /><small>moyenne, 1 h</small></th>
              <th>Dépense<br /><small>24 h</small></th>
              <th>Trop de demandes<br /><small>1 h · 24 h</small></th>
              <th>Crédits épuisés<br /><small>1 h · 24 h</small></th>
              <th>Erreurs<br /><small>IA · serveur, 24 h</small></th>
              <th>Demandes<br /><small>1 h</small></th>
              <th>Mémoire</th>
              <th>Démarrée</th>
            </tr>
          </thead>
          <tbody>
            {d.applications.map(a => {
              const r = a.rapport;
              if (!r) return (
                <tr key={a.id}>
                  <td className="fixe">{a.nom}</td>
                  <td colSpan={10} className={a.etat === "erreur" ? "erreur gauche" : "petit gauche"}>
                    {a.etat === "erreur" ? `⛔ ${a.message}` : a.message ? `Compteurs ${a.message}.` : "Compteurs pas encore installés (fichier conso.cjs)."}
                  </td>
                </tr>
              );
              const h = r.derniereHeure, j = r.dernieres24h;
              const picIa = Math.max(0, ...r.minutes.map(m => m.ia));
              return (
                <tr key={a.id}>
                  <td className="fixe">
                    <details>
                      <summary>{a.nom}</summary>
                      <Motifs titre="Dernière heure" motifs={h.motifs} />
                      <Motifs titre="24 heures" motifs={j.motifs} />
                      {Object.keys(r.limites).length > 0 && <p className="petit">Réglages : {Object.entries(r.limites).map(([k, v]) => `${k} = ${v}`).join(", ")}</p>}
                    </details>
                  </td>
                  <td>{nb(h.ia)} · {nb(j.ia)}</td>
                  <td>{nb(picIa)}</td>
                  <td>{h.ia ? `${(h.iaMs / h.ia / 1000).toFixed(1).replace(".", ",")} s` : "–"}</td>
                  <td>{dollars(a.cout24h || 0)}</td>
                  <td className={h.r429 ? "moyen" : ""}>{nb(h.r429)} · {nb(j.r429)}</td>
                  <td className={h.r402 ? "faible" : ""}>{nb(h.r402)} · {nb(j.r402)}</td>
                  <td className={h.ia429 || h.e5xx ? "faible" : ""}>{nb(j.iaErr)} · {nb(j.e5xx)}</td>
                  <td>{nb(h.req)}</td>
                  <td>{r.memoireMo} Mo{r.processus > 1 ? ` (${r.processus} processus)` : ""}</td>
                  <td title={new Date(r.demarreLe).toLocaleString("fr-FR")}>il y a {depuis(r.demarreLe)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {absentes.length > 0 && <p className="petit">Sans chiffres pour le moment : {absentes.map(a => a.nom).join(", ")}.</p>}
      <p className="petit">
        Chaque application garde ses chiffres des dernières 24 heures, même après un redémarrage. La dépense est une estimation
        d'après les jetons ({s.prixEntree} $ le million lus, {s.prixSortie} $ le million écrits) : la facture exacte est dans Google Cloud &gt; Facturation.
        Les seuils se règlent dans cPanel, variables de Suivi : SEUIL_IA_PAR_MINUTE, SEUIL_SIMULTANEES, SEUIL_COUT_JOUR, SEUIL_ERREURS_HEURE,
        PRIX_IA_ENTREE, PRIX_IA_SORTIE. Alerte à 80 % d'un seuil.
      </p>
    </section>
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
