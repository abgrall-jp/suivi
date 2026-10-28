import { test } from "node:test";
import assert from "node:assert/strict";
import { colonnesManuelles, dateDansTrimestre, essaiQuiCompte, lireNote, moyenne, noteSur20, periodesParDefaut } from "./bulletin.ts";

test("trimestres de l'année scolaire", () => {
  assert.deepEqual(periodesParDefaut(new Date("2026-10-24")), {
    T1: { debut: "2026-09-01", fin: "2026-11-30" },
    T2: { debut: "2026-12-01", fin: "2027-02-28" },
    T3: { debut: "2027-03-01", fin: "2027-07-14" },
  });
  assert.equal(periodesParDefaut(new Date("2028-01-10")).T2.fin, "2028-02-29");
  assert.equal(periodesParDefaut(new Date("2027-05-02")).T1.debut, "2026-09-01");
});

const t1 = { debut: "2026-09-01", fin: "2026-11-30" };
const d = (s: string) => Date.parse(s);

test("note : moyenne des colonnes, dernier essai du trimestre", () => {
  const essais = {
    "tat:ex1": [{ percent: 40, at: d("2026-09-10") }, { percent: 80, at: d("2026-10-01") }, { percent: 10, at: d("2026-12-15") }],
    "mem:deck": [{ percent: 60, at: d("2026-11-30T20:00:00Z") }],
  };
  assert.equal(noteSur20(essais, ["tat:ex1", "mem:deck"], t1), 14); // (80 + 60) / 2 = 70 % → 14
  assert.equal(noteSur20(essais, ["tat:ex1"], { debut: "2026-12-01", fin: "2027-02-28" }), 2);
});

test("note : colonnes sans résultat ignorées, aucune → pas de note", () => {
  assert.equal(noteSur20({ a: [{ percent: 55, at: null }] }, ["a", "b"], t1), 11);
  assert.equal(noteSur20({}, ["a"], t1), null);
});

test("saisie d'une note", () => {
  assert.equal(lireNote("12,5"), 12.5);
  assert.equal(lireNote(14.26), 14.3);
  assert.equal(lireNote(""), null);
  assert.equal(lireNote("21"), undefined);
  assert.equal(lireNote("abc"), undefined);
  assert.equal(moyenne([12, null, 15]), 13.5);
  assert.equal(moyenne([]), null);
});

test("note saisie à la main : comptée dans la moyenne et repérée", () => {
  const T1 = { debut: "2026-09-01", fin: "2026-11-30" };
  const essais = { "a:1": [{ percent: 50, at: Date.parse("2026-10-01") }], "a:2": [{ percent: 80, at: Date.parse("2026-10-02"), manuelle: true }] };
  assert.equal(noteSur20(essais, ["a:1", "a:2"], T1), 13);
  assert.deepEqual(colonnesManuelles(essais, [{ cle: "a:1" }, { cle: "a:2" }], T1), ["a:2"]);
  // Saisie après la fin du trimestre : datée du dernier jour, donc comptée dans ce trimestre.
  const d = dateDansTrimestre(T1, Date.parse("2027-01-15"));
  assert.equal(noteSur20({ x: [{ percent: 100, at: d }] }, ["x"], T1), 20);
  assert.equal(dateDansTrimestre(T1, Date.parse("2026-10-10")), Date.parse("2026-10-10"));
});

test("note saisie remplacée seulement si l'élève fait mieux ensuite", () => {
  const m = { percent: 60, at: 100, manuelle: true };
  assert.equal(essaiQuiCompte([m, { percent: 80, at: 200 }])?.percent, 80); // mieux, après : remplace
  assert.equal(essaiQuiCompte([m, { percent: 40, at: 200 }])?.percent, 60); // moins bien, après : la note saisie reste
  assert.equal(essaiQuiCompte([{ percent: 90, at: 50 }, m])?.percent, 60); // mieux, mais avant la saisie : la note saisie compte
  assert.equal(essaiQuiCompte([{ percent: 30, at: 50 }, { percent: 70, at: 60 }])?.percent, 70); // sans saisie : le dernier essai
});
