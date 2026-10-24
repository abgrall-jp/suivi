// Essai de bout en bout de Suivi (port 3300) : connexion, choix, liaison, tableau, correspondances, liste de l'établissement.
import { createRequire } from 'module';
const require = createRequire('/home/user/suivi/package.json');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const P = 'gen-lang-client-0301284188';
const adm = initializeApp({ projectId: P }, 'suivi-test');
const db = getFirestore(adm, 'suivi-eu');
const B = 'http://127.0.0.1:3300';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
let ok = 0, ko = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ', n); } else { ko++; console.log('  ÉCHEC', n, x !== undefined ? JSON.stringify(x).slice(0, 600) : ''); } };

// Base de Suivi vide au départ.
for (const c of ['enseignants', 'eleves', 'correspondances', 'codes', 'bulletins', 'classes', 'reglages']) { const s = await db.collection(c).get(); await Promise.all(s.docs.map(d => d.ref.delete())); }

async function compte(email, verifie = true) {
  try { const u = await getAuth(adm).getUserByEmail(email); await getAuth(adm).deleteUser(u.uid); } catch {}
  await fetch(`${AUTH}/accounts:signUp?key=x`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'secret12', returnSecureToken: true }) });
  if (verifie) { const u = await getAuth(adm).getUserByEmail(email); await getAuth(adm).updateUser(u.uid, { emailVerified: true }); }
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=x`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'secret12', returnSecureToken: true }) }).then(r => r.json());
  return r.idToken;
}
const appel = (jeton) => async (chemin, body) => {
  const r = await fetch(B + chemin, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = {}; try { data = await r.json(); } catch {}
  return { status: r.status, data };
};

console.log('Connexion');
t('sans jeton : refusé', (await appel(null)('/api/moi')).status === 401);
t('adresse non confirmée : refusée', (await appel(await compte('nonverifie@ecole.fr', false))('/api/moi')).status === 403);
const jean = appel(await compte('jean@ecole.fr'));
const moi = await jean('/api/moi');
t('première ouverture : aucune application choisie', moi.status === 200 && moi.data.choisies === null, moi.data);
t('catalogue : Mémoriser et Texte à trous prêtes, Edubot bientôt', ['memoriser', 'textetrous'].every(id => moi.data.catalogue.find(a => a.id === id).prete) && !moi.data.catalogue.find(a => a.id === 'edubot').prete);
t('pas administrateur', moi.data.isAdmin === false);

console.log('Choix et liaison');
await jean('/api/choix', { applications: ['memoriser', 'edubot', 'inconnue'] });
t('choix enregistré, application inconnue écartée', JSON.stringify((await jean('/api/moi')).data.choisies) === '["memoriser","edubot"]');
t('application pas prête : refus clair', (await jean('/api/apps/relier', { app: 'edubot' })).status === 409);
const rm = await jean('/api/apps/relier', { app: 'memoriser' });
t('Mémoriser reliée avec l’adresse de connexion', rm.status === 200 && rm.data.nom === 'M. Jean Martin', rm);
const rt = await jean('/api/apps/relier', { app: 'textetrous' });
t('Texte à trous reliée et ajoutée aux choix', rt.status === 200 && (await jean('/api/moi')).data.choisies.includes('textetrous'), rt);
t('autre adresse sans code : refusée', (await jean('/api/apps/relier', { app: 'textetrous', email: 'autre@ecole.fr', code: '123456' })).status === 403);
t('code sans serveur de mails : refus clair', (await jean('/api/apps/code', { app: 'textetrous', email: 'autre@ecole.fr' })).status === 503);
const marie = appel(await compte('marie@ecole.fr'));
await marie('/api/choix', { applications: ['memoriser'] });
t('adresse inconnue dans l’application : refus clair', (await marie('/api/apps/relier', { app: 'memoriser' })).status === 404);

console.log('Tableau (sans liste de l’établissement)');
let tab = (await jean('/api/tableau')).data;
t('liste provisoire', tab.provisoire === true, tab);
const alice = tab.eleves.find(e => e.nom === 'Durand' && e.prenom === 'Alice');
t('Alice : même élève dans les deux applications', !!alice && alice.resultats['memoriser:deck_verbes']?.percent === 50 && alice.resultats['textetrous:ex1']?.percent === 90, tab.eleves);
t('essais multiples : le plus récent', alice?.resultats['textetrous:ex1']?.score === '9/10');
t('exercice sans résultat masqué', !tab.applications.find(a => a.id === 'textetrous').exercices.some(x => x.id === 'ex2'));
t('« Bob L. » à vérifier ; « Test Prof », inconnu, devient un nouvel élève', tab.aVerifier === 1, tab.aVerifier);
t('Bob (Texte à trous) pas encore compté', !tab.eleves.some(e => e.resultats['textetrous:ex1']?.percent === 70));

console.log('Correspondances');
let corr = (await jean('/api/correspondances')).data;
const bobL = corr.eleves.find(e => e.app === 'textetrous' && e.studentId === 's2');
const bobRef = corr.references.find(r => r.nom === 'Leroy');
t('« Bob L. » : Bob Leroy proposé', bobL?.statut === 'a_verifier' && bobL.candidats.includes(bobRef?.id), bobL);
t('confirmer Bob', (await jean('/api/correspondances', { app: 'textetrous', studentId: 's2', refId: bobRef.id })).status === 200);
t('ignorer le compte de test', (await jean('/api/correspondances', { app: 'textetrous', studentId: 's3', refId: null })).status === 200);
t('élève d’une autre application : refusé', (await jean('/api/correspondances', { app: 'textetrous', studentId: 'st_alice', refId: bobRef.id })).status === 404);
t('application non reliée : refusé', (await marie('/api/correspondances', { app: 'textetrous', studentId: 's2', refId: bobRef.id })).status === 403);
await new Promise(r => setTimeout(r, 100));
tab = (await jean('/api/tableau')).data;
t('plus rien à vérifier', tab.aVerifier === 0, tab.aVerifier);
t('Bob a maintenant son résultat de Texte à trous', tab.eleves.find(e => e.id === bobRef.id)?.resultats['textetrous:ex1']?.percent === 70, tab.eleves);
t('le compte de test n’apparaît pas', !tab.eleves.some(e => /test/i.test(e.nom + e.prenom)));

console.log('Liste de l’établissement');
t('non administrateur : refusé', (await jean('/api/admin/eleves', { texte: 'a;b;c' })).status === 403);
const admin = appel(await compte('admin@ecole.fr'));
t('ligne incomplète : refus avec le numéro de ligne', /Ligne 2/.test((await admin('/api/admin/eleves', { texte: 'Classe;Nom;Prénom\n5B;DURAND\n' })).data.error || ''));
const imp = await admin('/api/admin/eleves', { texte: 'Classe;Nom;Prénom\n5B;DURAND;Alice\n5B;LEROY;Bob\n5B;PETIT;Chloé\n' });
t('3 élèves importés', imp.data.nombre === 3, imp);
await new Promise(r => setTimeout(r, 100));
tab = (await jean('/api/tableau')).data;
t('liste définitive', tab.provisoire === false);
const aliceRef = tab.eleves.find(e => e.id === '5b_durand_alice');
t('Alice rapprochée de la liste, résultats des deux applications', aliceRef?.resultats['memoriser:deck_verbes']?.percent === 50 && aliceRef?.resultats['textetrous:ex1']?.percent === 90, tab.eleves);
t('« Bob L. » à revérifier contre la liste officielle', tab.aVerifier === 1, tab.aVerifier);
corr = (await jean('/api/correspondances')).data;
t('Bob Leroy proposé avec l’identifiant de la liste', corr.eleves.find(e => e.studentId === 's2')?.candidats.includes('5b_leroy_bob'));
await jean('/api/correspondances', { app: 'textetrous', studentId: 's2', refId: '5b_leroy_bob' });
t('élève inconnu de la liste : refusé', (await jean('/api/correspondances', { app: 'textetrous', studentId: 's2', refId: 'fantome' })).status === 400);
tab = (await jean('/api/tableau')).data;
t('Bob : Mémoriser 0 % et Texte à trous 70 %', tab.eleves.find(e => e.id === '5b_leroy_bob')?.resultats['textetrous:ex1']?.percent === 70 && tab.eleves.find(e => e.id === '5b_leroy_bob')?.resultats['memoriser:deck_verbes']?.percent === 0);
t('Chloé (sans compte dans les applications) absente du tableau', !tab.eleves.some(e => e.prenom === 'Chloé'));

console.log('Bulletin (1er trimestre, 5e B)');
let bu = (await jean('/api/bulletin')).data;
t('classe proposée : 5e B', JSON.stringify(bu.classes) === '[{"cle":"5b","nom":"5B"}]', bu.classes);
t('deux colonnes proposées', bu.colonnesDispo?.length === 2, bu.colonnesDispo);
t('trimestres de l’année', bu.periodes?.T1?.debut === '2026-09-01');
t('note avant de choisir les colonnes : refus clair', (await jean('/api/bulletin/eleve', { trimestre: 'T1', classe: '5B', refId: '5b_durand_alice', finale: 12 })).status === 409);
t('trimestre incorrect : refusé', (await jean('/api/bulletin?trimestre=T4&classe=5B')).status === 400);
await jean('/api/bulletin/colonnes', { trimestre: 'T1', classe: '5e B', colonnes: bu.colonnesDispo, externes: [{ id: 'oral', titre: 'Oral' }] });
bu = (await jean('/api/bulletin?trimestre=T1&classe=5B')).data;
const ligne = (id) => bu.eleves.find(e => e.id === id);
t('Alice : (50 % + 90 %) / 2 = 14 / 20', ligne('5b_durand_alice')?.calculee === 14, bu.eleves);
t('Bob : (0 % + 70 %) / 2 = 7 / 20', ligne('5b_leroy_bob')?.calculee === 7);
t('Chloé (aucun résultat) : dans le bulletin, sans note', ligne('5b_petit_chloe')?.calculee === null);
t('2e trimestre : pas encore de note', (await jean('/api/bulletin/colonnes', { trimestre: 'T2', classe: '5B', colonnes: bu.colonnesDispo })).status === 200 && (await jean('/api/bulletin?trimestre=T2&classe=5B')).data.eleves.every(e => e.calculee === null));
t('note définitive saisie avec une virgule', (await jean('/api/bulletin/eleve', { trimestre: 'T1', classe: '5B', refId: '5b_durand_alice', finale: '15,5', externes: { oral: '12' }, appreciation: 'Très bon trimestre.' })).status === 200);
t('note hors barème : refusée', (await jean('/api/bulletin/eleve', { trimestre: 'T1', classe: '5B', refId: '5b_durand_alice', finale: 25 })).status === 400);
t('élève d’une autre classe : refusé', (await jean('/api/bulletin/eleve', { trimestre: 'T1', classe: '4A', refId: '5b_durand_alice', finale: 12 })).status === 404);
const fig = await jean('/api/bulletin/figer', { trimestre: 'T1', classe: '5B' });
t('figer : seule la note de Bob est posée (Chloé n’a pas de note)', fig.data.figees === 1, fig.data);
bu = (await jean('/api/bulletin?trimestre=T1&classe=5B')).data;
t('Alice garde 15,5, l’oral et l’appréciation', ligne('5b_durand_alice').finale === 15.5 && ligne('5b_durand_alice').externes.oral === 12 && ligne('5b_durand_alice').appreciation === 'Très bon trimestre.', ligne('5b_durand_alice'));
t('Bob : note figée à 7', ligne('5b_leroy_bob').finale === 7 && !!ligne('5b_leroy_bob').figeeLe);
await jean('/api/bulletin/eleve', { trimestre: 'T1', classe: '5B', refId: '5b_leroy_bob', finale: null });
bu = (await jean('/api/bulletin?trimestre=T1&classe=5B')).data;
t('note effacée : retour à la note calculée', ligne('5b_leroy_bob').finale === null && ligne('5b_leroy_bob').calculee === 7);
await jean('/api/bulletin/eleve', { trimestre: 'T1', classe: '5B', refId: '5b_leroy_bob', finale: 8 });

console.log('Prof principal');
t('pas encore prof principal : refusé', (await marie('/api/pp/bulletin?trimestre=T1&classe=5B')).status === 403);
t('non administrateur : ne peut pas nommer', (await jean('/api/admin/pp', { classe: '5e B', emails: 'jean@ecole.fr' })).status === 403);
t('administrateur nomme Marie pour la 5e B', (await admin('/api/admin/pp', { classe: '5e B', emails: 'marie@ecole.fr' })).status === 200);
t('Marie voit sa classe', JSON.stringify((await marie('/api/pp')).data.classes) === '[{"cle":"5b","nom":"5e B"}]');
const pp = (await marie('/api/pp/bulletin?trimestre=T1&classe=5B')).data;
const mJean = pp.matieres?.find(m => m.email === 'jean@ecole.fr');
t('Marie voit les notes de Jean', mJean?.notes['5b_durand_alice']?.note === 15.5 && mJean.notes['5b_durand_alice'].definitive && mJean.notes['5b_leroy_bob'].note === 8, pp);
t('… avec l’oral et l’appréciation', mJean?.notes['5b_durand_alice']?.externes?.oral === 12 && mJean.notes['5b_durand_alice'].appreciation === 'Très bon trimestre.');
t('moyenne générale', pp.eleves?.find(e => e.id === '5b_durand_alice')?.moyenne === 15.5 && pp.eleves.find(e => e.id === '5b_petit_chloe')?.moyenne === null);
t('Marie ne peut pas modifier les notes de Jean', (await marie('/api/bulletin/eleve', { trimestre: 'T1', classe: '5B', refId: '5b_durand_alice', finale: 2 })).status !== 200 && (await marie('/api/pp/bulletin?trimestre=T1&classe=5B')).data.matieres.find(m => m.email === 'jean@ecole.fr').notes['5b_durand_alice'].note === 15.5);
t('Jean n’est pas prof principal', (await jean('/api/pp/bulletin?trimestre=T1&classe=5B')).status === 403);
t('dates de trimestre incorrectes : refusées', (await admin('/api/admin/trimestres', { T1: { debut: '2026-12-01', fin: '2026-09-01' } })).status === 400);
t('dates de trimestre enregistrées', (await admin('/api/admin/trimestres', { T1: { debut: '2026-09-01', fin: '2026-10-02' }, T2: { debut: '2026-10-03', fin: '2027-02-28' }, T3: { debut: '2027-03-01', fin: '2027-07-04' } })).status === 200);
bu = (await jean('/api/bulletin?trimestre=T1&classe=5B')).data;
t('nouvelles dates (fin le 2 oct.) : Alice n’a plus que son 1er essai de Texte à trous, 40 % = 8 / 20', ligne('5b_durand_alice').calculee === 8, ligne('5b_durand_alice'));
await db.doc('reglages/trimestres').delete();

console.log('Délier');
await jean('/api/apps/retirer', { app: 'textetrous' });
tab = (await jean('/api/tableau')).data;
t('Texte à trous retirée du tableau', !tab.applications.some(a => a.id === 'textetrous'));
console.log(`\n${ok} réussis, ${ko} échecs`);
process.exit(ko ? 1 : 0);
