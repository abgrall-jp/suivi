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
