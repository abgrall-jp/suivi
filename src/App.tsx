import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, connexionEmail, connexionGoogle, deconnexion, inscriptionEmail, motDePasseOublie } from "./firebase.ts";
import { api, type Correspondances, type Moi, type Tableau } from "./api.ts";
import { ReglagesAdmin, VueBulletin, VueProfPrincipal } from "./Bulletin.tsx";
import { ParentsOubli, VueParents } from "./Parents.tsx";

type Onglet = "tableau" | "bulletin" | "pp" | "parents" | "applications" | "correspondances" | "eleves";

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
  return <Enseignants />;
}

function Enseignants() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [moi, setMoi] = useState<Moi | null>(null);
  const [erreur, setErreur] = useState("");
  const [onglet, setOnglet] = useState<Onglet>("tableau");
  const [aVerifier, setAVerifier] = useState(0);
  const [pp, setPp] = useState<{ classes: { cle: string; nom: string }[]; gerees: { cle: string; nom: string }[]; periodes: any } | null>(null);

  useEffect(() => onAuthStateChanged(auth, u => { setUser(u); setMoi(null); setErreur(""); }), []);

  const chargerMoi = useCallback(async () => {
    try { setMoi(await api<Moi>("/api/moi")); setErreur(""); } catch (e: any) { setErreur(e.message); }
  }, []);
  useEffect(() => { if (user) chargerMoi(); }, [user, chargerMoi]);
  useEffect(() => { if (moi?.choisies) api("/api/pp").then(setPp).catch(() => setPp(null)); }, [moi?.email, moi?.choisies]);

  if (user === undefined) return <div className="centre">Chargement…</div>;
  if (!user) return <Connexion />;
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
      <header>
        <strong>Suivi</strong>
        <nav>
          <button className={onglet === "tableau" ? "actif" : ""} onClick={() => setOnglet("tableau")}>Tableau</button>
          <button className={onglet === "bulletin" ? "actif" : ""} onClick={() => setOnglet("bulletin")}>Bulletin</button>
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
        {onglet === "tableau" && <VueTableau moi={moi} onAVerifier={setAVerifier} allerA={setOnglet} />}
        {onglet === "bulletin" && <VueBulletin />}
        {onglet === "pp" && pp && <VueProfPrincipal classes={pp.classes} periodes={pp.periodes} />}
        {onglet === "parents" && pp && <VueParents classes={pp.gerees} />}
        {onglet === "applications" && <MesApplications moi={moi} onChange={chargerMoi} />}
        {onglet === "correspondances" && <VueCorrespondances onChange={setAVerifier} />}
        {onglet === "eleves" && moi.isAdmin && <ListeEtablissement />}
      </main>
    </div>
  );
}

// --- Connexion ---------------------------------------------------------------------------
function Connexion() {
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
      <h1>Suivi</h1>
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
const couleur = (p: number) => (p >= 75 ? "tres-bien" : p >= 50 ? "bien" : p >= 25 ? "moyen" : "faible");
const dateCourte = (t: number | null) => (t ? new Date(t).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

function VueTableau({ moi, onAVerifier, allerA }: { moi: Moi; onAVerifier: (n: number) => void; allerA: (o: Onglet) => void }) {
  const [t, setT] = useState<Tableau | null>(null);
  const [msg, setMsg] = useState("");
  const [classe, setClasse] = useState("");

  const charger = useCallback(async () => {
    try { const d = await api<Tableau>("/api/tableau"); setT(d); onAVerifier(d.aVerifier); setMsg(""); } catch (e: any) { setMsg(e.message); }
  }, [onAVerifier]);

  // Mise à jour toutes les 30 secondes, tant que la page est visible.
  useEffect(() => {
    charger();
    const id = setInterval(() => { if (document.visibilityState === "visible") charger(); }, 30000);
    return () => clearInterval(id);
  }, [charger]);

  const classes = useMemo(() => Array.from(new Set((t?.eleves || []).map(e => e.classe))).sort((a, b) => a.localeCompare(b, "fr")), [t]);
  const eleves = (t?.eleves || []).filter(e => !classe || e.classe === classe);
  const apps = (t?.applications || []).filter(a => a.exercices.length);
  const reliees = Object.keys(moi.apps).length;

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
        <button onClick={charger}>Actualiser</button>
        {t && <span className="petit">Mis à jour à {new Date(t.lu).toLocaleTimeString("fr-FR")}</span>}
      </div>
      {msg && <p className="erreur">{msg}</p>}
      {t?.applications.filter(a => a.erreur).map(a => <p key={a.id} className="alerte">{a.nom} : {a.erreur}</p>)}
      {t && t.aVerifier > 0 && (
        <p className="alerte">{t.aVerifier} nom{t.aVerifier > 1 ? "s" : ""} d'élève à vérifier : leurs résultats n'apparaissent pas encore.{" "}
          <button className="lien" onClick={() => allerA("correspondances")}>Vérifier</button></p>
      )}
      {t?.provisoire && <p className="petit">La liste de l'établissement n'est pas encore importée : les élèves sont repris des applications.</p>}
      {!apps.length ? <p>Pas encore de résultat dans les applications reliées.</p> : (
        <div className="defile">
          <table className="tableau">
            <thead>
              <tr>
                <th rowSpan={2} className="fixe">Élève</th>
                {apps.map(a => <th key={a.id} colSpan={a.exercices.length} className="groupe">{a.nom}</th>)}
              </tr>
              <tr>{apps.flatMap(a => a.exercices.map(x => <th key={`${a.id}:${x.id}`} className="exo" title={x.titre}>{x.titre}</th>))}</tr>
            </thead>
            <tbody>
              {eleves.map(e => (
                <tr key={e.id}>
                  <td className="fixe"><span className="nom">{e.nom} {e.prenom}</span><span className="classe">{e.classe}</span></td>
                  {apps.flatMap(a => a.exercices.map(x => {
                    const r = e.resultats[`${a.id}:${x.id}`];
                    return <td key={`${a.id}:${x.id}`} className={r ? couleur(r.percent) : "vide"} title={r ? `${r.score} · ${dateCourte(r.at)}` : ""}>{r ? `${Math.round(r.percent)} %` : ""}</td>;
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

// --- Correspondances des noms --------------------------------------------------------------------
const libelleStatut: Record<string, string> = { confirme: "Confirmé", auto: "Reconnu", a_verifier: "À vérifier", aucun: "Introuvable", ignore: "Ignoré" };

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

  if (!c) return msg ? <p className="erreur">{msg}</p> : <p>Chargement…</p>;
  const refDe = new Map(c.references.map(r => [r.id, r]));
  const nomRef = (id: string) => { const r = refDe.get(id); return r ? `${r.nom} ${r.prenom} (${r.classe})` : id; };
  const ordre = ["a_verifier", "aucun", "ignore", "confirme", "auto"];
  const lignes = c.eleves.filter(e => tous || e.statut === "a_verifier" || e.statut === "aucun")
    .sort((a, b) => ordre.indexOf(a.statut) - ordre.indexOf(b.statut) || a.classe.localeCompare(b.classe, "fr") || a.nom.localeCompare(b.nom, "fr"));

  return (
    <section>
      <div className="barre">
        <h2>Noms des élèves</h2>
        <label className="petit"><input type="checkbox" checked={tous} onChange={e => setTous(e.target.checked)} /> Montrer aussi les élèves reconnus</label>
      </div>
      <p>Un même élève peut être écrit différemment d'une application à l'autre. Suivi relie seul les noms identiques ; pour les autres, choisissez l'élève une fois pour toutes.</p>
      {msg && <p className="erreur">{msg}</p>}
      {!lignes.length ? <p className="info">Tous les noms sont reconnus.</p> : (
        <table className="corr">
          <thead><tr><th>Application</th><th>Nom dans l'application</th><th>Classe</th><th>État</th><th>Élève de la liste</th></tr></thead>
          <tbody>
            {lignes.map(e => {
              const autres = c.references.filter(r => !e.candidats.includes(r.id));
              return (
                <tr key={`${e.app}:${e.studentId}`}>
                  <td>{e.appNom}</td>
                  <td>{e.nom}</td>
                  <td>{e.classe}</td>
                  <td><span className={`etat ${e.statut}`}>{libelleStatut[e.statut]}</span></td>
                  <td>
                    <select value={e.refId || ""} onChange={ev => choisir(e.app, e.studentId, ev.target.value === "__ignorer" ? null : ev.target.value)}>
                      <option value="" disabled>Choisir l'élève…</option>
                      {e.candidats.length > 0 && <optgroup label="Proposés">{e.candidats.map(id => <option key={id} value={id}>{nomRef(id)}</option>)}</optgroup>}
                      <optgroup label="Tous les élèves">{autres.map(r => <option key={r.id} value={r.id}>{nomRef(r.id)}</option>)}</optgroup>
                      <option value="__ignorer">Ne pas suivre cet élève (compte de test…)</option>
                    </select>
                  </td>
                </tr>
              );
            })}
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
