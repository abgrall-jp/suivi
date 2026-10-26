import { auth } from "./firebase.ts";

/** Appel du serveur de Suivi avec le jeton de l'enseignant connecté. */
export async function api<T = any>(chemin: string, body?: unknown): Promise<T> {
  const jeton = await auth.currentUser?.getIdToken();
  const r = await fetch(chemin, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
  eleves: { id: string; classe: string; nom: string; prenom: string; resultats: Record<string, { percent: number; score: string; at: number | null }> }[];
  aVerifier: number;
  masquees: string[];
  publiees?: Record<string, string>;
  lu: number;
};
export type Correspondances = {
  provisoire: boolean;
  exclus: { eleves: string[]; classes: string[] };
  references: { id: string; classe: string; nom: string; prenom: string }[];
  eleves: { app: string; appNom: string; studentId: string; nom: string; classe: string; statut: "confirme" | "auto" | "a_verifier" | "aucun" | "ignore"; refId: string | null; candidats: string[]; exclu?: boolean }[];
};
