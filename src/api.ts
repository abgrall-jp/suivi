import { auth } from "./firebase.ts";

// Chargements en cours, pour la barre de progression en haut de la page.
let enCours = 0;
const abonnes = new Set<(n: number) => void>();
const signaler = (d: number) => { enCours += d; abonnes.forEach(f => f(enCours)); };
export function suivreChargements(f: (n: number) => void) { abonnes.add(f); return () => { abonnes.delete(f); }; }

/** Appel du serveur de Suivi avec le jeton de l'enseignant connecté (silencieux : sans barre de progression). */
export async function api<T = any>(chemin: string, body?: unknown, silencieux = false): Promise<T> {
  if (silencieux) return appel<T>(chemin, body);
  signaler(1);
  try { return await appel<T>(chemin, body); } finally { signaler(-1); }
}

async function appel<T>(chemin: string, body?: unknown): Promise<T> {
  const jeton = await auth.currentUser?.getIdToken();
  const envoyer = () => fetch(chemin, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Connexion coupée (réseau du téléphone, serveur qui redémarre) : une lecture est retentée une fois après 2 secondes.
  let r: Response;
  try { r = await envoyer(); } catch {
    if (body !== undefined) throw new Error("Le serveur n'a pas répondu (connexion coupée). Vérifiez la connexion et réessayez.");
    await new Promise(ok => setTimeout(ok, 2000));
    try { r = await envoyer(); } catch { throw new Error("Le serveur n'a pas répondu (connexion coupée). Vérifiez la connexion, puis rechargez la page."); }
  }
  let data: any = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error(data?.error || `Erreur ${r.status}`);
  return data as T;
}

export type AppCatalogue = { id: string; code: string; nom: string; url: string; eleves: boolean; prete: boolean };
export type Moi = {
  email: string; nom: string; isAdmin: boolean; choisies: string[] | null; mails: boolean;
  apps: Record<string, { email: string; nomDansAppli: string; relieeLe: string }>;
  catalogue: AppCatalogue[];
};
export type Tableau = {
  provisoire: boolean;
  applications: { id: string; code: string; nom: string; erreur: string | null; exercices: { id: string; titre: string }[] }[];
  eleves: { id: string; classe: string; nom: string; prenom: string; resultats: Record<string, { percent: number; score: string; at: number | null; manuelle?: boolean }>; autres?: Record<string, { percent: number; score: string; at: number | null; manuelle?: boolean }> }[];
  aVerifier: number;
  masquees: string[];
  publiees?: Record<string, string>;
  lu: number;
};
export type Correspondances = {
  provisoire: boolean;
  exclus: { eleves: string[]; classes: string[]; inclus?: string[] };
  references: { id: string; classe: string; nom: string; prenom: string; suivi?: boolean }[];
  eleves: { app: string; appNom: string; studentId: string; nom: string; classe: string; statut: "confirme" | "auto" | "a_verifier" | "aucun" | "ignore"; refId: string | null; candidats: string[]; exclu?: boolean }[];
};
