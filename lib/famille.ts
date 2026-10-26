// Espace des familles : l'élève et ses parents voient seulement ce que les enseignants ont publié pour cet élève.
// Accès par un code personnel (imprimé par l'enseignant) ; Suivi ne garde que son empreinte.
import crypto from "crypto";
import { genererMotDePasse } from "./parents.ts";

/** Code facile à recopier : « Renard-Tulipe-47-3 » (64 × 64 × 1000 possibilités ; essais limités). */
export function genererCode(): string {
  return `${genererMotDePasse()}-${crypto.randomInt(10)}`;
}

/** Code tapé n'importe comment (« renard tulipe 47 3 ») ramené à une seule écriture. */
export function normaliserCode(code: unknown): string {
  return String(code ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

/** Empreinte rapide du code normalisé, avec le secret du serveur (le code seul ne permet pas de la recalculer). */
export const empreinteCode = (code: string, secret: string) => crypto.createHmac("sha256", secret).update(normaliserCode(code)).digest("hex");

/** Jeton de session de la famille : identifiant de l'élève et date de fin, signés. */
export function signerJeton(refId: string, secret: string, dureeMs = 30 * 24 * 3600e3): string {
  const corps = Buffer.from(JSON.stringify({ r: refId, e: Date.now() + dureeMs })).toString("base64url");
  return `${corps}.${crypto.createHmac("sha256", secret).update(corps).digest("base64url")}`;
}

export function lireJeton(jeton: string, secret: string): string | null {
  const [corps, sig] = String(jeton || "").split(".");
  if (!corps || !sig) return null;
  const attendue = crypto.createHmac("sha256", secret).update(corps).digest();
  const recue = Buffer.from(sig, "base64url");
  if (recue.length !== attendue.length || !crypto.timingSafeEqual(recue, attendue)) return null;
  try {
    const { r, e } = JSON.parse(Buffer.from(corps, "base64url").toString());
    return typeof r === "string" && typeof e === "number" && e > Date.now() ? r : null;
  } catch { return null; }
}
