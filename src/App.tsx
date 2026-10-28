import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, connexionEmail, connexionGoogle, deconnexion, inscriptionEmail, motDePasseOublie } from "./firebase.ts";
import { api, suivreChargements, type Correspondances, type Moi, type Tableau } from "./api.ts";
import { ReglagesAdmin, VueBulletin, VueProfPrincipal } from "./Bulletin.tsx";
import { ParentsOubli, VueParents } from "./Parents.tsx";
import { EnteteColonne, sansAccent } from "./outils.tsx";
import { BoutonPublier, EspaceFamille, VueCodesFamille } from "./Famille.tsx";

type Onglet = "tableau" | "bulletin" | "familles" | "pp" | "parents" | "applications" | "correspondances" | "eleves";

const messageAuth = (e: any) => {
  const code = String(e?.code || "");
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Adresse ou mot de passe incorrect.";
  if (code.includes("email-already-in-use")) return "Un compte existe déjà avec cette adresse. Connectez-vous.";
  if (code.includes("weak-password")) return "Mot de passe trop court (6 caractères au moins).";
  if (code.includes("popup-closed")) return "";
  return e?.message || "Connexion impossible.";
};

export default function App() {
  // Page publique pour les parents : pas de connexion.
  if (location.pathname.replace(/\/+$/, "") === "/parents") return <ParentsOubli />;
  if (location.pathname.replace(/\/+$/, "") === "/famille") return <EspaceFamille />;
  return <Enseignants />;
}

function Enseignants() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [moi, setMoi] = useState<Moi | null>(null);
  const [erreur, setErreur] = useState("");
  const [onglet, setOnglet] = useState<Onglet>("tableau");
  // Le tableau et le bulletin restent en mémoire quand on change d'onglet : y revenir est immédiat (ils se relisent en silence).
  const [bulletinVu, setBulletinVu] = useState(false);
  useEffect(() => { if (onglet === "bulletin") setBulletinVu(true); }, [onglet]);
  const [aVerifier, setAVerifier] = useState(0);
  const [pp, setPp] = useState<{ classes: { cle: string; nom: string }[]; gerees: { cle: string; nom: string }[]; periodes: any } | null>(null);

  useEffect(() => onAuthStateChanged(auth, u => { setUser(u); setMoi(null); setErreur(""); }), []);

  const chargerMoi = useCallback(async () => {
    try { setMoi(await api<Moi>("/api/moi")); setErreur(""); } catch (e: any) { setErreur(e.message); }
  }, []);
  useEffect(() => { if (user) chargerMoi(); }, [user, chargerMoi]);
  useEffect(() => { if (moi?.choisies) api("/api/pp").then(setPp).catch(() => setPp(null)); }, [moi?.email, moi?.choisies]);

  if (user === undefined) return <div className="centre">Chargement…</div>;
  if (!user) return <Accueil />;
  if (erreur && !moi) return (
    <div className="centre carte">
      <p className="erreur">{erreur}</p>
      <button onClick={async () => { await user.reload(); await user.getIdToken(true); chargerMoi(); }}>Réessayer</button>
      <button className="lien" onClick={deconnexion}>Se déconnecter</button>
    </div>
  );
  if (!moi) return <div className="centre">Chargement…</div>;
  if (moi.choisies === null) return <PremierChoix moi={moi} onFini={chargerMoi} />;

  return (
    <div className="appli">
      <BarreChargement />
      <header>
        <strong>Suivi</strong>
        <nav>
          <button className={onglet === "tableau" ? "actif" : ""} onClick={() => setOnglet("tableau")}>Tableau</button>
          <button className={onglet === "bulletin" ? "actif" : ""} onClick={() => setOnglet("bulletin")}>Bulletin</button>
          <button className={onglet === "familles" ? "actif" : ""} onClick={() => setOnglet("familles")}>Familles</button>
          {!!pp?.classes.length && <button className={onglet === "pp" ? "actif" : ""} onClick={() => setOnglet("pp")}>Prof principal</button>}
          {!!pp?.gerees.length && <button className={onglet === "parents" ? "actif" : ""} onClick={() => setOnglet("parents")}>Parents</button>}
          <button className={onglet === "applications" ? "actif" : ""} onClick={() => setOnglet("applications")}>Mes applications</button>
          <button className={onglet === "correspondances" ? "actif" : ""} onClick={() => setOnglet("correspondances")}>
            Noms des élèves{aVerifier > 0 && <span className="pastille">{aVerifier}</span>}
          </button>
          {moi.isAdmin && <button className={onglet === "eleves" ? "actif" : ""} onClick={() => setOnglet("eleves")}>Établissement</button>}
        </nav>
        <span className="moi">{moi.email} <button className="lien" onClick={deconnexion}>Déconnexion</button></span>
      </header>
      <main>
        <div hidden={onglet !== "tableau"}><VueTableau moi={moi} onAVerifier={setAVerifier} allerA={setOnglet} actif={onglet === "tableau"} /></div>
        {bulletinVu && <div hidden={onglet !== "bulletin"}><VueBulletin actif={onglet === "bulletin"} /></div>}
        {onglet === "familles" && <VueCodesFamille />}
        {onglet === "pp" && pp && <VueProfPrincipal classes={pp.classes} periodes={pp.periodes} />}
        {onglet === "parents" && pp && <VueParents classes={pp.gerees} />}
        {onglet === "applications" && <MesApplications moi={moi} onChange={chargerMoi} />}
        {onglet === "correspondances" && <VueCorrespondances onChange={setAVerifier} />}
        {onglet === "eleves" && moi.isAdmin && <ListeEtablissement />}
      </main>
    </div>
  );
}

/** Barre fine en haut de la page tant qu'un chargement est en cours (dans n'importe quel onglet). */
function BarreChargement() {
  const [n, setN] = useState(0);
  useEffect(() => suivreChargements(setN), []);
  return <div className={`barre-chargement${n > 0 ? " active" : ""}`} role="progressbar" aria-label="Chargement en cours" aria-hidden={n === 0} />;
}

// --- Accueil : élève, parent ou professeur --------------------------------------------------
function Accueil() {
  const [prof, setProf] = useState(false);
  if (prof) return <Connexion onRetour={() => setProf(false)} />;
  return (
    <div className="centre large accueil">
      <h1>Suivi</h1>
      <p>Les résultats et les bulletins de toutes les applications Je peux apprendre, au même endroit.</p>
      <div className="portes">
        <a className="porte carte" href="/famille?qui=eleve"><span className="icone">🎒</span><strong>Accueil élève</strong><span>Mes résultats et mon bulletin, avec mon identifiant.</span></a>
        <a className="porte carte" href="/famille?qui=parent"><span className="icone">👪</span><strong>Accueil parent</strong><span>Les résultats et le bulletin de mon enfant.</span></a>
        <button className="porte carte" onClick={() => setProf(true)}><span className="icone">🧑‍🏫</span><strong>Accueil professeur</strong><span>Tableau des résultats, bulletin, publication pour les familles.</span></button>
      </div>
    </div>
  );
}

// --- Connexion ---------------------------------------------------------------------------
function Connexion({ onRetour }: { onRetour: () => void }) {
  const [mode, setMode] = useState<"connexion" | "inscription">("connexion");
  const [email, setEmail] = useState("");
  const [mdp, setMdp] = useState("");
  const [msg, setMsg] = useState("");
  const [info, setInfo] = useState("");
  const [occupe, setOccupe] = useState(false);

  const envoyer = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(""); setInfo(""); setOccupe(true);
    try {
      if (mode === "inscription") {
        await inscriptionEmail(email.trim(), mdp);
        setInfo("Compte créé. Ouvrez le lien reçu par e-mail pour confirmer votre adresse, puis cliquez sur « Réessayer ».");
      } else await connexionEmail(email.trim(), mdp);
    } catch (err) { setMsg(messageAuth(err)); } finally { setOccupe(false); }
  };

  return (
    <div className="centre carte connexion">
      <p className="petit"><button className="lien" onClick={onRetour}>← Accueil</button></p>
      <h1>Suivi · Professeur</h1>
      <p>Les résultats de vos élèves dans toutes les applications Je peux apprendre, au même endroit.</p>
      <button className="principal" onClick={() => connexionGoogle().catch(e => setMsg(messageAuth(e)))}>Se connecter avec Google</button>
      <div className="ou">ou avec votre adresse e-mail</div>
      <form onSubmit={envoyer}>
        <input type="email" placeholder="Adresse e-mail" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
        <input type="password" placeholder="Mot de passe" value={mdp} onChange={e => setMdp(e.target.value)} required minLength={6}
          autoComplete={mode === "inscription" ? "new-password" : "current-password"} />
        <button type="submit" disabled={occupe}>{mode === "inscription" ? "Créer mon compte" : "Se connecter"}</button>
      </form>
      {msg && <p className="erreur">{msg}</p>}
      {info && <p className="info">{info}</p>}
      <p className="petit">
        {mode === "connexion"
          ? <button className="lien" onClick={() => setMode("inscription")}>Créer un compte</button>
          : <button className="lien" onClick={() => setMode("connexion")}>J'ai déjà un compte</button>}
        {" · "}
        <button className="lien" onClick={async () => {
          if (!email.trim()) { setMsg("Écrivez d'abord votre adresse e-mail."); return; }
          try { await motDePasseOublie(email.trim()); setInfo("Un lien pour changer de mot de passe vous a été envoyé."); setMsg(""); } catch (e) { setMsg(messageAuth(e)); }
        }}>Mot de passe oublié</button>
      </p>
    </div>
  );
}

// --- Première ouverture : choix des applications -------------------------------------------
function PremierChoix({ moi, onFini }: { moi: Moi; onFini: () => void }) {
  const avecEleves = moi.catalogue.filter(a => a.eleves);
  const [coches, setCoches] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const basculer = (id: string) => setCoches(c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id]));
  return (
    <div className="centre carte large">
      <h1>Bienvenue dans Suivi</h1>
      <p>Cochez les applications que vous utilisez avec vos élèves. Vous pourrez en ajouter d'autres plus tard, dans « Mes applications ».</p>
      <div className="grille-apps">
        {avecEleves.map(a => (
          <label key={a.id} className={`choix ${coches.includes(a.id) ? "coche" : ""}`}>
            <input type="checkbox" checked={coches.includes(a.id)} onChange={() => basculer(a.id)} />
            <span>{a.nom}</span>
            {!a.prete && <small>bientôt</small>}
          </label>
        ))}
      </div>
      {msg && <p className="erreur">{msg}</p>}
      <button className="principal" disabled={!coches.length} onClick={async () => {
        try { await api("/api/choix", { applications: coches }); onFini(); } catch (e: any) { setMsg(e.message); }
      }}>Continuer</button>
    </div>
  );
}

// --- Mes applications : cocher et relier ------------------------------------------------------
function MesApplications({ moi, onChange }: { moi: Moi; onChange: () => void }) {
  const choisies = moi.choisies || [];
  const avecEleves = moi.catalogue.filter(a => a.eleves);
  const outils = moi.catalogue.filter(a => !a.eleves);
  const [msg, setMsg] = useState("");

  const basculer = async (id: string) => {
    const suivantes = choisies.includes(id) ? choisies.filter(x => x !== id) : [...choisies, id];
    try { await api("/api/choix", { applications: suivantes }); onChange(); } catch (e: any) { setMsg(e.message); }
  };

  return (
    <section>
      <h2>Mes applications</h2>
      <p>Pour chaque application cochée, reliez votre compte enseignant : Suivi pourra alors lire les résultats de vos élèves.</p>
      {msg && <p className="erreur">{msg}</p>}
      <div className="liste-apps">
        {avecEleves.map(a => (
          <div key={a.id} className={`ligne-app ${choisies.includes(a.id) ? "" : "eteinte"}`}>
            <label className="titre-app">
              <input type="checkbox" checked={choisies.includes(a.id)} onChange={() => basculer(a.id)} />
              <span>{a.nom}</span>
            </label>
            {choisies.includes(a.id) && <Liaison moi={moi} appId={a.id} onChange={onChange} />}
          </div>
        ))}
      </div>
      <h3>Outils pour l'enseignant</h3>
      <p className="petit">Ces applications n'enregistrent pas de résultats d'élèves : elles apparaîtront plus tard dans une page « Activité ».</p>
      <ul className="outils">{outils.map(a => <li key={a.id}><a href={a.url} target="_blank" rel="noreferrer">{a.nom}</a></li>)}</ul>
    </section>
  );
}

function Liaison({ moi, appId, onChange }: { moi: Moi; appId: string; onChange: () => void }) {
  const a = moi.catalogue.find(x => x.id === appId)!;
  const liee = moi.apps[appId];
  const [autre, setAutre] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeEnvoye, setCodeEnvoye] = useState(false);
  const [msg, setMsg] = useState("");
  const [occupe, setOccupe] = useState(false);

  const faire = async (fn: () => Promise<any>) => {
    setMsg(""); setOccupe(true);
    try { await fn(); } catch (e: any) { setMsg(e.message); } finally { setOccupe(false); }
  };

  if (!a.prete) return <span className="statut bientot">Bientôt disponible</span>;
  if (liee) return (
    <span className="statut reliee">
      Reliée avec {liee.email}{liee.nomDansAppli ? ` (${liee.nomDansAppli})` : ""}
      <button className="lien" onClick={() => faire(async () => { await api("/api/apps/retirer", { app: appId }); onChange(); })}>Délier</button>
    </span>
  );
  return (
    <div className="liaison">
      {!autre ? (
        <>
          <button disabled={occupe} onClick={() => faire(async () => { await api("/api/apps/relier", { app: appId }); onChange(); })}>
            Relier avec {moi.email}
          </button>
          <button className="lien" onClick={() => setAutre(true)}>J'utilise une autre adresse dans {a.nom}</button>
        </>
      ) : (
        <div className="autre">
          <input type="email" placeholder={`Adresse utilisée dans ${a.nom}`} value={email} onChange={e => setEmail(e.target.value)} />
          {!codeEnvoye ? (
            <button disabled={occupe || !email.trim() || !moi.mails} onClick={() => faire(async () => { await api("/api/apps/code", { app: appId, email: email.trim() }); setCodeEnvoye(true); })}>
              Recevoir un code
            </button>
          ) : (
            <>
              <input inputMode="numeric" placeholder="Code reçu (6 chiffres)" value={code} onChange={e => setCode(e.target.value)} maxLength={6} />
              <button disabled={occupe || code.trim().length !== 6} onClick={() => faire(async () => { await api("/api/apps/relier", { app: appId, email: email.trim(), code: code.trim() }); onChange(); })}>
                Relier
              </button>
            </>
          )}
          <button className="lien" onClick={() => { setAutre(false); setCodeEnvoye(false); setCode(""); }}>Annuler</button>
          {!moi.mails && <p className="petit">L'envoi de codes par e-mail n'est pas encore réglé sur le serveur.</p>}
        </div>
      )}
      {msg && <p className="erreur">{msg}</p>}
    </div>
  );
}

// --- Tableau en direct --------------------------------------------------------------------------
type Tri = { cle: string; sens: 1 | -1 } | null;

const couleur = (p: number) => (p >= 75 ? "tres-bien" : p >= 50 ? "bien" : p >= 25 ? "moyen" : "faible");
const dateCourte = (t: number | null) => (t ? new Date(t).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

function VueTableau({ moi, onAVerifier, allerA, actif }: { moi: Moi; onAVerifier: (n: number) => void; allerA: (o: Onglet) => void; actif: boolean }) {
  const [t, setT] = useState<Tableau | null>(null);
  const [msg, setMsg] = useState("");
  const [classe, setClasse] = useState("");
  const [cherche, setCherche] = useState("");
  const [tri, setTri] = useState<Tri>(null);
  const [voirMasquees, setVoirMasquees] = useState(false);
  const defile = useRef<HTMLDivElement>(null);
  const actifRef = useRef(actif);
  // Retour sur l'onglet : relecture discrète (les données affichées restent visibles pendant ce temps).
  useEffect(() => { if (actif && !actifRef.current) charger(false, true); actifRef.current = actif; }, [actif]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saisie, setSaisie] = useState<string | null>(null); // case en cours de saisie : « refId|colonne »
  const [edite, setEdite] = useState<string | null>(null); // élève dont on corrige le nom ou qu'on fusionne

  const charger = useCallback(async (frais = false, silencieux = false) => {
    try { const d = await api<Tableau>(`/api/tableau${frais ? "?frais=1" : ""}`, undefined, silencieux); setT(d); onAVerifier(d.aVerifier); setMsg(""); } catch (e: any) { setMsg(e.message); }
  }, [onAVerifier]);

  // Mise à jour toutes les 30 secondes, tant que la page est visible.
  useEffect(() => {
    charger();
    const id = setInterval(() => { if (document.visibilityState === "visible" && actifRef.current) charger(false, true); }, 30000);
    return () => clearInterval(id);
  }, [charger]);

  // Note saisie à la main (résultat perdu ou absent) : sur 20, vide pour l'effacer.
  // La case change tout de suite (sans attendre le serveur) ; Entrée passe à l'élève suivant dans la même colonne.
  // Le tableau est relu discrètement quelques secondes après la dernière saisie.
  const relecture = useRef<number | undefined>(undefined);
  const saisirNote = async (refId: string, cle: string, note: string | null, suivant: boolean) => {
    if (note === null) { const j = eleves.findIndex(x => x.id === refId); setSaisie(suivant && eleves[j + 1] ? `${eleves[j + 1].id}|${cle}` : null); return; }
    const n = note.trim() === "" ? null : Number(note.replace(",", "."));
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 20)) { setMsg("La note doit être entre 0 et 20."); setSaisie(null); return; }
    const i = eleves.findIndex(x => x.id === refId);
    setSaisie(suivant && eleves[i + 1] ? `${eleves[i + 1].id}|${cle}` : null);
    setMsg("");
    setT(prev => prev && {
      ...prev,
      eleves: prev.eleves.map(x => {
        if (x.id !== refId) return x;
        const resultats = { ...x.resultats }, autres = { ...(x.autres || {}) };
        const avant = resultats[cle];
        if (n === null) {
          if (!avant?.manuelle) return x;
          if (autres[cle] && !autres[cle].manuelle) resultats[cle] = autres[cle]; else delete resultats[cle];
          delete autres[cle];
        } else {
          const arrondie = Math.round(n * 10) / 10;
          if (avant && !avant.manuelle) autres[cle] = avant;
          resultats[cle] = { percent: arrondie * 5, score: `${String(arrondie).replace(".", ",")}/20`, at: Date.now(), manuelle: true };
        }
        return { ...x, resultats, autres };
      }),
    });
    try { await api("/api/notes-manuelles", { refId, cle, note }, true); } catch (e: any) { setMsg(e.message); charger(); return; }
    window.clearTimeout(relecture.current);
    relecture.current = window.setTimeout(() => charger(false, true), 4000);
  };

  const classes = useMemo(() => Array.from(new Set((t?.eleves || []).map(e => e.classe))).sort((a, b) => a.localeCompare(b, "fr")), [t]);
  const filtres = (t?.eleves || []).filter(e => !classe || e.classe === classe);
  // Colonnes : seulement celles où un élève affiché a un résultat (une classe de 4e ne voit pas les séquences de 2de),
  // et celles dont le titre contient le texte cherché.
  const mots = sansAccent(cherche).split(/\s+/).filter(Boolean);
  const masquees = t?.masquees || [];
  const titreDe = new Map((t?.applications || []).flatMap(a => a.exercices.map(x => [`${a.id}:${x.id}`, `${a.nom} · ${x.titre}`] as [string, string])));
  const apps = (t?.applications || []).map(a => ({
    ...a,
    exercices: a.exercices.filter(x => !masquees.includes(`${a.id}:${x.id}`) && filtres.some(e => e.resultats[`${a.id}:${x.id}`])
      && mots.every(m => sansAccent(`${a.nom} ${x.titre}`).includes(m))),
  })).filter(a => a.exercices.length);
  const reliees = Object.keys(moi.apps).length;
  const eleves = [...filtres];
  if (tri?.cle === "__nom") eleves.sort((a, b) => tri.sens * `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, "fr"));
  else if (tri) eleves.sort((a, b) => {
    const pa = a.resultats[tri.cle]?.percent, pb = b.resultats[tri.cle]?.percent;
    if (pa === undefined || pb === undefined) return pa === undefined ? (pb === undefined ? 0 : 1) : -1; // sans résultat : en bas
    return tri.sens * (pa - pb);
  });
  // 1er clic : meilleurs en haut ; 2e : plus faibles en haut ; 3e : ordre de la classe.
  const trier = (cle: string) => setTri(p => (p?.cle !== cle ? { cle, sens: cle === "__nom" ? 1 : -1 } : p.sens === (cle === "__nom" ? 1 : -1) ? { cle, sens: (-p.sens) as 1 | -1 } : null));
  const fleche = (cle: string) => (tri?.cle === cle ? (tri.sens === -1 ? " ▼" : " ▲") : "");
  const masquer = async (liste: string[]) => {
    if (!t) return;
    setT({ ...t, masquees: liste });
    try { await api("/api/colonnes-masquees", { masquees: liste }); } catch (e: any) { setMsg(e.message); }
  };
  const decaler = (sens: number) => defile.current?.scrollBy({ left: sens * Math.max(300, defile.current.clientWidth * 0.7), behavior: "smooth" });
  const retirer = async (id: string, nom: string) => {
    if (!confirm(`Ne plus suivre ${nom} ? Il disparaît du tableau et du bulletin. Vous pourrez le remettre dans « Noms des élèves ».`)) return;
    try {
      const c = await api<Correspondances>("/api/correspondances");
      await api("/api/exclus", { ...c.exclus, eleves: [...c.exclus.eleves, id] });
      charger();
    } catch (e: any) { setMsg(e.message); }
  };

  if (!t && !msg) return <p>Chargement des résultats…</p>;
  if (!reliees) return (
    <div className="carte">
      <p>Aucune application n'est encore reliée.</p>
      <button className="principal" onClick={() => allerA("applications")}>Relier mes applications</button>
    </div>
  );
  return (
    <section>
      <div className="barre">
        <h2>Résultats en direct</h2>
        <select value={classe} onChange={e => setClasse(e.target.value)}>
          <option value="">Toutes les classes</option>
          {classes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="search" placeholder="Chercher une colonne (ex. : 4e Séq. 2)" value={cherche} onChange={e => setCherche(e.target.value)} />
        <button onClick={() => charger(true)}>Actualiser</button>
        {classe && <BoutonPublier publieLe={t?.publiees?.[cleCl(classe)] || null}
          onPublier={async () => { try { await api("/api/publier/tableau", { classe }); await charger(); } catch (e: any) { setMsg(e.message); } }}
          onRetirer={async () => { try { await api("/api/publier/tableau", { classe, retirer: true }); await charger(); } catch (e: any) { setMsg(e.message); } }} />}
        {masquees.length > 0 && <button onClick={() => setVoirMasquees(!voirMasquees)}>Colonnes masquées ({masquees.length})</button>}
        {!!apps.length && <span className="defilement"><button title="Voir les colonnes de gauche" onClick={() => decaler(-1)}>◀</button><button title="Voir les colonnes de droite" onClick={() => decaler(1)}>▶</button></span>}
        {t && <span className="petit">Mis à jour à {new Date(t.lu).toLocaleTimeString("fr-FR")}</span>}
      </div>
      {msg && <p className="erreur">{msg}</p>}
      {voirMasquees && masquees.length > 0 && (
        <div className="carte etiquettes">
          <span className="petit">Colonnes masquées :</span>
          {masquees.map(c => <span key={c} className="etiquette">{titreDe.get(c) || c} <button className="lien" onClick={() => masquer(masquees.filter(x => x !== c))}>afficher</button></span>)}
          <button className="lien" onClick={() => { masquer([]); setVoirMasquees(false); }}>Tout afficher</button>
        </div>
      )}
      {edite && t && (() => {
        const el = t.eleves.find(x => x.id === edite);
        return el ? <EditeurEleve eleve={el} autres={t.eleves.filter(x => x.id !== el.id)} onFini={async () => { setEdite(null); await charger(); }} onErreur={setMsg} /> : null;
      })()}
      {t?.applications.filter(a => a.erreur).map(a => <p key={a.id} className="alerte">{a.nom} : {a.erreur}</p>)}
      {t && t.aVerifier > 0 && (
        <p className="alerte">{t.aVerifier} nom{t.aVerifier > 1 ? "s" : ""} d'élève à vérifier : leurs résultats n'apparaissent pas encore.{" "}
          <button className="lien" onClick={() => allerA("correspondances")}>Vérifier</button></p>
      )}
      {t?.provisoire && <p className="petit">La liste de l'établissement n'est pas encore importée : les élèves sont repris des applications.</p>}
      {!!apps.length && <p className="petit">Cliquez sur le titre d'une colonne pour classer les élèves selon cette note (cliquez encore pour inverser). La croix ✕ masque une colonne inutile.
        Une note perdue ou absente ? Cliquez sur la case pour la saisir sur 20 (Entrée passe à l'élève suivant) : elle apparaît <span className="manuelle-legende">en violet</span>, ici et dans le bulletin.</p>}
      {!apps.length ? <p>{cherche ? "Aucune colonne ne correspond à cette recherche." : "Pas encore de résultat dans les applications reliées."}</p> : (
        <div className="defile" ref={defile}>
          <table className="tableau">
            <thead>
              <tr>
                <th rowSpan={2} className="fixe triable" onClick={() => trier("__nom")} title="Classer par nom">Élève{fleche("__nom")}</th>
                {apps.map(a => <th key={a.id} colSpan={a.exercices.length} className="groupe">{a.nom}</th>)}
              </tr>
              <tr>{apps.flatMap(a => a.exercices.map(x => {
                const cle = `${a.id}:${x.id}`;
                return <th key={cle} className={`exo triable ${tri?.cle === cle ? "trie" : ""}`} title={`${x.titre}\nCliquer pour classer`} onClick={() => trier(cle)}>
                  <button className="masquer" title="Masquer cette colonne" onClick={ev => { ev.stopPropagation(); masquer([...masquees, cle]); }}>✕</button>
                  <EnteteColonne titre={x.titre} />{fleche(cle)}</th>;
              }))}</tr>
            </thead>
            <tbody>
              {eleves.map(e => (
                <tr key={e.id}>
                  <td className="fixe"><button className="nom lien-nom" title="Corriger le nom, inverser nom et prénom, ou fusionner avec un autre élève" onClick={() => setEdite(e.id)}>{e.nom} {e.prenom}</button><span className="classe">{e.classe}
                    <button className="lien retirer" title="Ne plus suivre cet élève" onClick={() => retirer(e.id, `${e.nom} ${e.prenom}`.trim())}>retirer</button></span></td>
                  {apps.flatMap(a => a.exercices.map(x => {
                    const cle = `${a.id}:${x.id}`;
                    const r = e.resultats[cle];
                    if (saisie === `${e.id}|${cle}`) return <td key={cle} className="saisie"><CaseNote initiale={r?.manuelle ? String(r.percent / 5).replace(".", ",") : ""} onValider={(v, suivant) => saisirNote(e.id, cle, v, suivant)} onAnnuler={() => setSaisie(null)} /></td>;
                    return <td key={cle} className={`${r ? couleur(r.percent) : "vide"}${r?.manuelle ? " manuelle" : ""} modifiable`} onClick={() => setSaisie(`${e.id}|${cle}`)}
                      title={r ? `${r.manuelle ? "Saisie à la main" : r.score} · ${dateCourte(r.at)}\nCliquer pour corriger` : "Cliquer pour saisir une note sur 20"}>
                      {r ? <>{r.score && <span className="note">{r.score.replace(/\s*\/\s*/, "/")}</span>}{Math.round(r.percent)} %</> : ""}
                      {e.autres?.[cle] && <span className={`autre-note ${e.autres[cle].manuelle ? "manuelle-legende" : "appli"}`}
                        title={e.autres[cle].manuelle ? "Note saisie à la main : l'élève a fait mieux ensuite dans l'application, elle ne compte plus" : "Note de l'application : c'est la note saisie à la main qui compte"}>
                        {e.autres[cle].manuelle ? e.autres[cle].score : `${Math.round(e.autres[cle].percent)} %`}</span>}</td>;
                  }))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Corriger le nom d'un élève (inverser nom et prénom) ou le fusionner avec un autre (le même élève, écrit autrement). */
function EditeurEleve({ eleve, autres, onFini, onErreur }: { eleve: Ref; autres: Ref[]; onFini: () => void; onErreur: (m: string) => void }) {
  const [prenom, setPrenom] = useState(eleve.prenom);
  const [nom, setNom] = useState(eleve.nom);
  const [occupe, setOccupe] = useState(false);
  const boite = useRef<HTMLDivElement>(null);
  useEffect(() => { boite.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [eleve.id]);
  const faire = async (fn: () => Promise<unknown>) => { setOccupe(true); try { await fn(); onFini(); } catch (e: any) { onErreur(e.message); } finally { setOccupe(false); } };
  return (
    <div className="carte editeur-eleve" ref={boite}>
      <strong>{eleve.nom} {eleve.prenom}</strong> <span className="petit">({eleve.classe})</span>
      <div className="ligne">
        <label>Prénom <input value={prenom} onChange={ev => setPrenom(ev.target.value)} /></label>
        <label>Nom <input value={nom} onChange={ev => setNom(ev.target.value)} /></label>
        <button title="Échanger le nom et le prénom" onClick={() => { setPrenom(nom); setNom(prenom); }}>⇄ Inverser</button>
        <button className="principal" disabled={occupe || !nom.trim()} onClick={() => faire(() => api("/api/eleves/nom", { refId: eleve.id, nom, prenom }))}>Enregistrer</button>
        <button disabled={occupe} onClick={onFini}>Fermer</button>
      </div>
      <div className="ligne">
        <span className="petit">Le même élève apparaît deux fois ? Fusionner avec :</span>
        <ChoixEleve refs={autres} placeholder="Tapez les premières lettres de l'autre nom" onChoix={r => {
          if (confirm(`Fusionner « ${eleve.nom} ${eleve.prenom} » avec « ${r.nom} ${r.prenom} » ? Ses résultats passent sur ${r.prenom || r.nom}. Rien ne change dans les applications.`))
            faire(() => api("/api/eleves/fusionner", { de: eleve.id, vers: r.id }));
        }} />
      </div>
      <p className="petit">La correction et la fusion valent dans Suivi seulement (tableau, bulletin, familles) : les applications d'origine ne sont pas modifiées.</p>
    </div>
  );
}

/** Case du tableau en saisie : Entrée ou clic ailleurs enregistre, Échap annule. */
function CaseNote({ initiale, onValider, onAnnuler }: { initiale: string; onValider: (v: string | null, suivant: boolean) => void; onAnnuler: () => void }) {
  const [v, setV] = useState(initiale);
  const fini = useRef(false);
  const valider = (suivant: boolean) => {
    if (fini.current) return;
    fini.current = true;
    if (v.trim() !== initiale) onValider(v.trim(), suivant); else if (suivant) onValider(null, true); else onAnnuler();
  };
  return <input className="note" autoFocus enterKeyHint="next" inputMode="decimal" placeholder="/20" value={v} onChange={ev => setV(ev.target.value)} onBlur={() => valider(false)}
    onKeyDown={ev => { if (ev.key === "Enter" || ev.key === "Tab") { ev.preventDefault(); valider(true); } if (ev.key === "Escape") { fini.current = true; onAnnuler(); } }} />;
}

const cleCl = (s: string) => sansAccent(s).replace(/[^a-z0-9]/g, "").replace(/^(\d+)(ieme|eme|em|e)?/, "$1");

// --- Correspondances des noms --------------------------------------------------------------------
const libelleStatut: Record<string, string> = { confirme: "Confirmé", auto: "Reconnu", a_verifier: "À vérifier", aucun: "Introuvable", ignore: "Ignoré" };
type Ref = Correspondances["references"][number];
const nomComplet = (r: Ref) => `${r.nom} ${r.prenom}`.trim();

/** Élèves dont le nom ou le prénom commence par les lettres tapées (« dur », « alice d », « d a »). */
export function chercherEleves(refs: Ref[], texte: string, max = 8): Ref[] {
  const mots = sansAccent(texte).split(/[\s,.'-]+/).filter(Boolean);
  if (!mots.length) return [];
  return refs.filter(r => {
    const parts = sansAccent(`${r.nom} ${r.prenom} ${r.classe}`).split(/[\s,.'-]+/).filter(Boolean);
    return mots.every(m => parts.some(p => p.startsWith(m)));
  }).sort((x, y) => x.nom.localeCompare(y.nom, "fr") || x.prenom.localeCompare(y.prenom, "fr")).slice(0, max);
}

/** Champ où l'on tape les premières lettres de l'élève, avec la liste des élèves qui correspondent. */
function ChoixEleve({ refs, placeholder, onChoix }: { refs: Ref[]; placeholder: string; onChoix: (r: Ref) => void }) {
  const [texte, setTexte] = useState("");
  const trouves = chercherEleves(refs, texte);
  return (
    <span className="choix-eleve">
      <input type="search" placeholder={placeholder} value={texte} onChange={e => setTexte(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && trouves.length === 1) { onChoix(trouves[0]); setTexte(""); } }} />
      {!!texte.trim() && (
        <span className="liste">
          {trouves.length ? trouves.map(r => <button key={r.id} onClick={() => { onChoix(r); setTexte(""); }}>{nomComplet(r)} ({r.classe})</button>)
            : <span className="petit" style={{ padding: 8, display: "block" }}>Aucun élève ne commence par « {texte} ».</span>}
        </span>
      )}
    </span>
  );
}

function VueCorrespondances({ onChange }: { onChange: (n: number) => void }) {
  const [c, setC] = useState<Correspondances | null>(null);
  const [msg, setMsg] = useState("");
  const [tous, setTous] = useState(false);

  const charger = useCallback(async () => {
    try {
      const d = await api<Correspondances>("/api/correspondances");
      setC(d); onChange(d.eleves.filter(e => e.statut === "a_verifier" || e.statut === "aucun").length); setMsg("");
    } catch (e: any) { setMsg(e.message); }
  }, [onChange]);
  useEffect(() => { charger(); }, [charger]);

  const choisir = async (app: string, studentId: string, refId: string | null) => {
    try { await api("/api/correspondances", { app, studentId, refId }); charger(); } catch (e: any) { setMsg(e.message); }
  };
  const exclure = async (x: { eleves: string[]; classes: string[]; inclus?: string[] }) => {
    try { await api("/api/exclus", x); charger(); } catch (e: any) { setMsg(e.message); }
  };

  if (!c) return msg ? <p className="erreur">{msg}</p> : <p>Chargement…</p>;
  const refDe = new Map(c.references.map(r => [r.id, r]));
  const nomRef = (id: string) => { const r = refDe.get(id); return r ? `${nomComplet(r)} (${r.classe})` : id; };
  const ordre = ["a_verifier", "aucun", "ignore", "confirme", "auto"];
  const classeExclue = (classe: string) => c.exclus.classes.includes(cleCl(classe));
  const lignes = c.eleves.filter(e => (tous || e.statut === "a_verifier" || e.statut === "aucun") && !classeExclue(e.classe) && (tous || !e.exclu))
    .sort((a, b) => ordre.indexOf(a.statut) - ordre.indexOf(b.statut) || a.classe.localeCompare(b.classe, "fr") || a.nom.localeCompare(b.nom, "fr"));
  const classes = Array.from(new Map(c.references.map(r => [cleCl(r.classe), r.classe])).entries()).sort((a, b) => a[1].localeCompare(b[1], "fr", { numeric: true }));
  const exclus = c.exclus.eleves.map(id => refDe.get(id) || { id, nom: id, prenom: "", classe: "" });
  // Élèves qu'on peut ajouter au suivi : ceux des applications qui ne sont pas suivis (retirés, classe décochée, compte de test),
  // et ceux qu'on avait marqués « ignoré » dans les noms.
  const ignores = c.eleves.filter(e => e.statut === "ignore").map(e => ({ id: `ignore:${e.app}:${e.studentId}`, app: e.app, studentId: e.studentId, nom: e.nom, prenom: "", classe: e.classe }));
  const aAjouter: Ref[] = [...c.references.filter(r => r.suivi === false), ...ignores.map(({ id, nom, prenom, classe }) => ({ id, nom, prenom, classe }))];
  const choisirOubli = async (app: string, studentId: string) => {
    try { await api("/api/correspondances", { app, studentId, oublier: true }); charger(); } catch (e: any) { setMsg(e.message); }
  };

  return (
    <section>
      <div className="barre">
        <h2>Noms des élèves</h2>
        <label className="petit"><input type="checkbox" checked={tous} onChange={e => setTous(e.target.checked)} /> Montrer aussi les élèves reconnus</label>
      </div>

      <div className="carte">
        <h3>Élèves et classes suivis</h3>
        <p className="petit">Décochez une classe qui n'a pas besoin de suivi, ou retirez un élève (compte de test, élève parti). Ils disparaissent du tableau et du bulletin ; vous pouvez les remettre à tout moment.</p>
        <div className="etiquettes">
          <button className="lien" onClick={() => exclure({ ...c.exclus, classes: [] })}>Tout cocher</button>
          <button className="lien" onClick={() => exclure({ ...c.exclus, classes: classes.map(([cle]) => cle) })}>Tout décocher</button>
          <button className="lien" title="Les noms de professeurs ou de groupes de formation sont décochés" onClick={() => exclure({ ...c.exclus, classes: classes.filter(([, nom]) => !/^\s*\d/.test(nom)).map(([cle]) => cle) })}>Ne garder que les classes qui commencent par un chiffre</button>
        </div>
        <div className="etiquettes">
          {classes.map(([cle, nom]) => (
            <label key={cle} className={`etiquette ${c.exclus.classes.includes(cle) ? "exclue" : ""}`}>
              <input type="checkbox" checked={!c.exclus.classes.includes(cle)}
                onChange={ev => exclure({ ...c.exclus, classes: ev.target.checked ? c.exclus.classes.filter(x => x !== cle) : [...c.exclus.classes, cle] })} /> {nom}
            </label>
          ))}
        </div>
        <div className="ajout-retrait">
          <ChoixEleve refs={c.references.filter(r => r.suivi !== false)} placeholder="Retirer un élève : tapez les premières lettres"
            onChoix={r => exclure({ ...c.exclus, eleves: [...c.exclus.eleves, r.id], inclus: (c.exclus.inclus || []).filter(x => x !== r.id) })} />
          <ChoixEleve refs={aAjouter} placeholder="Ajouter un élève : tapez les premières lettres" onChoix={async r => {
            const ignore = ignores.find(x => x.id === r.id);
            if (ignore) { await choisirOubli(ignore.app, ignore.studentId); return; }
            const ref = refDe.get(r.id);
            // Retiré à la main : il suffit de le remettre ; classe décochée ou compte de test : ajouté à la main.
            const forcer = !!ref && (c.exclus.classes.includes(cleCl(ref.classe)) || !c.exclus.eleves.includes(r.id));
            exclure({ ...c.exclus, eleves: c.exclus.eleves.filter(x => x !== r.id), inclus: forcer ? [...(c.exclus.inclus || []), r.id] : c.exclus.inclus || [] });
          }} />
        </div>
        {!!c.exclus.inclus?.length && (
          <div className="etiquettes">
            <span className="petit">Élèves ajoutés :</span>
            {c.exclus.inclus.map(id => refDe.get(id) || { id, nom: id, prenom: "", classe: "" }).map(r => (
              <span key={r.id} className="etiquette">{nomComplet(r)}{r.classe ? ` (${r.classe})` : ""}{" "}
                <button className="lien" onClick={() => exclure({ ...c.exclus, inclus: (c.exclus.inclus || []).filter(x => x !== r.id) })}>enlever</button></span>
            ))}
          </div>
        )}
        {!!exclus.length && (
          <div className="etiquettes">
            <span className="petit">Élèves retirés :</span>
            {exclus.map(r => (
              <span key={r.id} className="etiquette">{nomComplet(r)}{r.classe ? ` (${r.classe})` : ""}{" "}
                <button className="lien" onClick={() => exclure({ ...c.exclus, eleves: c.exclus.eleves.filter(x => x !== r.id) })}>remettre</button></span>
            ))}
          </div>
        )}
      </div>

      <p>Un même élève peut être écrit différemment d'une application à l'autre. Suivi relie seul les noms identiques ; pour les autres, choisissez l'élève une fois pour toutes.</p>
      {msg && <p className="erreur">{msg}</p>}
      {!lignes.length ? <p className="info">Tous les noms sont reconnus.</p> : (
        <table className="corr">
          <thead><tr><th>Application</th><th>Nom dans l'application</th><th>Classe</th><th>État</th><th>Élève de la liste</th></tr></thead>
          <tbody>
            {lignes.map(e => (
              <tr key={`${e.app}:${e.studentId}`}>
                <td>{e.appNom}</td>
                <td>{e.nom}</td>
                <td>{e.classe}</td>
                <td><span className={`etat ${e.statut}`}>{libelleStatut[e.statut]}</span></td>
                <td>
                  <div className="choix-eleve">
                    {e.refId && <strong>{nomRef(e.refId)}</strong>}
                    {e.candidats.map(id => <button key={id} onClick={() => choisir(e.app, e.studentId, id)}>{nomRef(id)}</button>)}
                    <ChoixEleve refs={c.references} placeholder={e.refId ? "Changer : premières lettres…" : "Tapez les premières lettres…"} onChoix={r => choisir(e.app, e.studentId, r.id)} />
                    {e.statut !== "ignore" && <button className="lien" title="Compte de test, élève parti…" onClick={() => choisir(e.app, e.studentId, null)}>ne pas suivre</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// --- Liste de l'établissement (administrateur) -------------------------------------------------
function ListeEtablissement() {
  const [nombre, setNombre] = useState<number | null>(null);
  const [texte, setTexte] = useState("");
  const [msg, setMsg] = useState("");
  const [info, setInfo] = useState("");

  const charger = useCallback(async () => {
    try { setNombre((await api<{ eleves: unknown[] }>("/api/admin/eleves")).eleves.length); } catch (e: any) { setMsg(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  return (
    <section>
      <h2>Liste des élèves de l'établissement</h2>
      <p>{nombre === null ? "…" : `${nombre} élève${nombre > 1 ? "s" : ""} dans la liste.`} C'est la liste de référence : tous les noms des applications y sont rapprochés.</p>
      <p className="petit">Collez les colonnes Classe, Nom, Prénom (et, si vous les avez, les e-mails des deux parents) depuis le tableur de l'établissement, ou choisissez un fichier CSV. La nouvelle liste remplace l'ancienne.</p>
      <input type="file" accept=".csv,.txt" onChange={async e => { const f = e.target.files?.[0]; if (f) setTexte(await f.text()); }} />
      <textarea rows={12} value={texte} onChange={e => setTexte(e.target.value)} placeholder={"Classe;Nom;Prénom;E-mail parent 1;E-mail parent 2\n5A;MARTIN;Léa;papa.martin@mail.fr;maman.martin@mail.fr\n5A;DUBOIS;Hugo;parent.dubois@mail.fr"} />
      <button className="principal" disabled={!texte.trim()} onClick={async () => {
        setMsg(""); setInfo("");
        try {
          const r = await api<{ nombre: number; retires: number }>("/api/admin/eleves", { texte });
          setInfo(`${r.nombre} élèves importés${r.retires ? `, ${r.retires} retirés` : ""}.`); setTexte(""); charger();
        } catch (e: any) { setMsg(e.message); }
      }}>Importer la liste</button>
      {msg && <p className="erreur pre">{msg}</p>}
      {info && <p className="info">{info}</p>}
      <ReglagesAdmin />
    </section>
  );
}
