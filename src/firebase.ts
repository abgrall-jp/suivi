import { initializeApp } from "firebase/app";
import {
  getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signOut,
} from "firebase/auth";

// La configuration est donnée par le serveur (window.__FIREBASE_CONFIG__) : le navigateur ne sert qu'à se connecter.
const config = (window as any).__FIREBASE_CONFIG__ || {};
const app = initializeApp(config);
export const auth = getAuth(app);
auth.languageCode = "fr";
if (config.emulators?.authPort) connectAuthEmulator(auth, `http://${location.hostname}:${config.emulators.authPort}`, { disableWarnings: true });

export const connexionGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());
export const connexionEmail = (email: string, mdp: string) => signInWithEmailAndPassword(auth, email, mdp);
export async function inscriptionEmail(email: string, mdp: string) {
  const c = await createUserWithEmailAndPassword(auth, email, mdp);
  await sendEmailVerification(c.user);
  return c;
}
export const motDePasseOublie = (email: string) => sendPasswordResetEmail(auth, email);
export const deconnexion = () => signOut(auth);
