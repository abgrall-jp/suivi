import { test } from "node:test";
import assert from "node:assert/strict";
import { noteDeResultat, trimestresCommences } from "./sequenceur.ts";
import { periodesParDefaut } from "./bulletin.ts";

test("note lue dans le score, sinon le pourcentage", () => {
  assert.deepEqual(noteDeResultat("8/10", 80), { note: 8, sur: 10 });
  assert.deepEqual(noteDeResultat("7,5 / 20", 37.5), { note: 7.5, sur: 20 });
  assert.deepEqual(noteDeResultat("", 55), { note: 55, sur: 100 });
  assert.deepEqual(noteDeResultat("8/0", 40), { note: 40, sur: 100 });
  assert.equal(noteDeResultat("", "x"), null);
});

test("trimestres commencés, le plus récent d'abord", () => {
  const per = periodesParDefaut(new Date("2026-10-28T12:00:00Z"));
  assert.deepEqual(trimestresCommences(per, Date.parse("2026-10-28T12:00:00Z")), ["T1"]);
  assert.deepEqual(trimestresCommences(per, Date.parse("2027-01-10T12:00:00Z")), ["T2", "T1"]);
  assert.deepEqual(trimestresCommences(per, Date.parse("2026-08-20T12:00:00Z")), []);
});

test("codes d'entrée de l'élève dans les applications qui en ont", async () => {
  const { codesDeLEleve } = await import("./sequenceur.ts");
  const resultat = [
    { app: "concentre", studentId: "c1__s1", refId: "R1" },
    { app: "concentre", studentId: "c2__s9", refId: "R2" },
    { app: "evalia", studentId: "e1__a", refId: "R1" },
    { app: "quiz", studentId: "q1", refId: "R1" },
  ];
  const lus = [
    { app: { id: "concentre", nom: "Concentré", url: "https://c", libelleCode: "Code de la classe" }, d: {
      classes: [{ id: "c1", name: "5e B", code: "AB12CD" }, { id: "c2", name: "5e C", code: "ZZ99ZZ" }],
      students: [{ id: "c1__s1", classId: "c1", className: "5e B" }, { id: "c2__s9", classId: "c2", className: "5e C" }],
    } },
    { app: { id: "evalia", nom: "Eval IA", url: "https://e", libelleCode: "Mot de passe enseignant" }, d: {
      classes: [{ id: "e1", name: "5B", code: "40" }], students: [{ id: "e1__a", classId: "e1", className: "5B" }],
    } },
    { app: { id: "quiz", nom: "Quiz", url: "https://q" }, d: { classes: [{ id: "q", name: "5B", code: "x" }], students: [{ id: "q1", classId: "q", className: "5B" }] } },
    { app: { id: "memoriser", nom: "Mémoriser", url: "https://m", libelleCode: "Code" }, d: null },
    { app: { id: "organigrammes", nom: "Organigrammes", url: "https://o" }, d: {
      classes: [{ id: "o1", name: "5B" }],
      students: [{ id: "o1_7", classId: "o1", className: "5B", code: "4821", codeLibelle: "Code initial (première connexion)" }, { id: "o1_8", classId: "o1", className: "5B" }],
    } },
  ];
  resultat.push({ app: "organigrammes", studentId: "o1_7", refId: "R1" }, { app: "organigrammes", studentId: "o1_8", refId: "R2" });
  assert.deepEqual(codesDeLEleve("R1", resultat, lus), [
    { appli: "concentre", nom: "Concentré", url: "https://c", libelle: "Code de la classe", classe: "5e B", code: "AB12CD" },
    { appli: "evalia", nom: "Eval IA", url: "https://e", libelle: "Mot de passe enseignant", classe: "5B", code: "40" },
    { appli: "organigrammes", nom: "Organigrammes", url: "https://o", libelle: "Code initial (première connexion)", classe: "5B", code: "4821" },
  ]);
  // Élève qui a déjà choisi son mot de passe : la porte ne donne plus de code, rien n'est montré.
  assert.deepEqual(codesDeLEleve("R2", resultat, lus).map(c => c.appli), ["concentre"]);
  assert.deepEqual(codesDeLEleve("R3", resultat, lus), []);
});
