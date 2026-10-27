import { test } from "node:test";
import assert from "node:assert/strict";
import { classeEstUnNom, cleClasse, comparer, decider, lireListe, type EleveRef } from "./correspondance.ts";

const refs: EleveRef[] = [
  { id: "lea", classe: "5A", nom: "MARTIN", prenom: "Léa" },
  { id: "hugo", classe: "5A", nom: "DUBOIS", prenom: "Hugo" },
  { id: "theo", classe: "5B", nom: "LAMBERT", prenom: "Théo" },
  { id: "theo2", classe: "5B", nom: "LEROY", prenom: "Théo" },
  { id: "jm", classe: "5A", nom: "Le Gall", prenom: "Jean-Marc" },
];

test("classes écrites différemment", () => {
  assert.equal(cleClasse("5e A"), "5a");
  assert.equal(cleClasse("5ème A"), "5a");
  assert.equal(cleClasse("5A"), "5a");
});

test("même nom dans les deux ordres, sans accents ni majuscules : sûr", () => {
  assert.deepEqual(decider("Lea Martin", "5A", refs), { statut: "auto", refId: "lea" });
  assert.deepEqual(decider("MARTIN Léa", "", refs), { statut: "auto", refId: "lea" });
  assert.deepEqual(decider("jean marc le gall", "5e A", refs), { statut: "auto", refId: "jm" });
});

test("initiale du nom ou faute de frappe : à vérifier", () => {
  assert.deepEqual(decider("Léa M.", "5A", refs), { statut: "a_verifier", candidats: ["lea"] });
  assert.deepEqual(decider("Hugo Duboiss", "5A", refs), { statut: "a_verifier", candidats: ["hugo"] });
});

test("prénom seul partagé par deux élèves : les deux sont proposés", () => {
  assert.deepEqual(decider("Théo", "5B", refs), { statut: "a_verifier", candidats: ["theo", "theo2"] });
});

test("autre classe : jamais sûr", () => {
  assert.equal(comparer("Léa Martin", "4C", refs[0]), "probable");
});

test("même nom chez un seul élève, classe écrite autrement : sûr", () => {
  assert.deepEqual(decider("Léa Martin", "2nde 1", refs), { statut: "auto", refId: "lea" });
});

test("inconnu : aucun", () => {
  assert.deepEqual(decider("Zoé Durand", "5A", refs), { statut: "aucun" });
});

test("liste collée depuis un tableur", () => {
  const { eleves, erreurs } = lireListe("Classe;Nom;Prénom\n5A;MARTIN;Léa\n5A\tDUBOIS\tHugo\n5B;LAMBERT\n5A;MARTIN;Léa\n");
  assert.equal(eleves.length, 2);
  assert.equal(eleves[0].id, "5a_martin_lea");
  assert.deepEqual(erreurs, ["Ligne 4 : il faut la classe, le nom et le prénom."]);
});

test("e-mails des parents, facultatifs", () => {
  const { eleves, erreurs } = lireListe("5A;MARTIN;Léa;Papa@mail.fr;maman@mail.fr\n5A;DUBOIS;Hugo;;\n5A;PETIT;Zoé;pas-un-mail\n");
  assert.equal(eleves[0].email1, "papa@mail.fr");
  assert.equal(eleves[0].email2, "maman@mail.fr");
  assert.equal(eleves[1].email1, "");
  assert.deepEqual(erreurs, ["Ligne 3 : adresse e-mail incorrecte (pas-un-mail)."]);
});

test("classe qui n'est que le nom de l'élève", () => {
  assert.equal(classeEstUnNom("LE LOCH", "Marie LE LOCH"), true);
  assert.equal(classeEstUnNom("BATAILLE PENALVA", "Léa Bataille Penalva"), true);
  assert.equal(classeEstUnNom("5e B", "Alice Durand"), false);
  assert.equal(classeEstUnNom("Élèves", "Alice Durand"), false);
  assert.equal(classeEstUnNom("", "Alice Durand"), false);
});
