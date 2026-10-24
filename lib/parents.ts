// Mots de passe des parents : un par parent, le même dans toutes les applications.
// Suivi ne garde que l'empreinte (scrypt) et l'envoie aux applications ; le mot de passe en clair ne part que par e-mail.
import crypto from "crypto";

const MOTS = [
  "Arbre", "Avion", "Balle", "Bateau", "Biche", "Bougie", "Cactus", "Castor", "Cerise", "Chat", "Citron", "Colline", "Comete", "Corail",
  "Dauphin", "Domino", "Dragon", "Etoile", "Falaise", "Fusee", "Girafe", "Glacier", "Hibou", "Jardin", "Kiwi", "Lama", "Lapin", "Lune",
  "Mangue", "Marmotte", "Melon", "Mouette", "Nuage", "Olive", "Orange", "Panda", "Papillon", "Pirate", "Planete", "Plume", "Poire",
  "Pomme", "Prairie", "Radis", "Renard", "Riviere", "Robot", "Sable", "Sapin", "Soleil", "Tigre", "Tomate", "Tortue", "Tulipe",
  "Vague", "Vanille", "Violon", "Volcan", "Zebre", "Ecureuil", "Flocon", "Grenade", "Moulin", "Phare",
];

/** Mot de passe facile à recopier : « Renard-Tulipe-47 » (64 × 64 × 100 possibilités ; les applications limitent les essais). */
export function genererMotDePasse(): string {
  const m = () => MOTS[crypto.randomInt(MOTS.length)];
  return `${m()}-${m()}-${String(crypto.randomInt(100)).padStart(2, "0")}`;
}

/** Empreinte au format attendu par les applications : scrypt:<sel hex>:<empreinte hex>. */
export function empreinte(motDePasse: string): string {
  const sel = crypto.randomBytes(16);
  return `scrypt:${sel.toString("hex")}:${crypto.scryptSync(motDePasse, sel, 32).toString("hex")}`;
}

export function correspond(motDePasse: string, e: string): boolean {
  const [, sel, attendue] = String(e).split(":");
  if (!sel || !attendue) return false;
  const calculee = crypto.scryptSync(motDePasse, Buffer.from(sel, "hex"), 32);
  const b = Buffer.from(attendue, "hex");
  return b.length === calculee.length && crypto.timingSafeEqual(calculee, b);
}

export const emailValide = (e: string) => /^[^\s@;,]{1,64}@[^\s@;,]{1,190}\.[a-z]{2,}$/i.test(e);
