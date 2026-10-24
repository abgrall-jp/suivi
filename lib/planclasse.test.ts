import { test } from "node:test";
import assert from "node:assert/strict";
import { plansDe, remarquesParEleve, type PlanPublie } from "./planclasse.ts";

test("remarques du trimestre, par élève, sans doublon", () => {
  const eleves = [{ id: "lea", classe: "5A", nom: "MARTIN", prenom: "Léa" }];
  const r = { studentName: "Léa Martin", date: "2026-10-02", sessionNumber: "3", text: "Bavarde avec sa voisine." };
  const plans: PlanPublie[] = [
    { teacherEmail: "Jean@Ecole.fr", className: "5e A", studentRemarks: {
      "lea martin": [r, { studentName: "Léa Martin", date: "2026-09-20", text: "Très investie." }, { studentName: "Léa Martin", date: "2026-12-05", text: "T2" }],
      "7": [r],
    } },
    { teacherEmail: "autre@ecole.fr", className: "5e A", studentRemarks: { x: [{ studentName: "Léa Martin", date: "2026-10-01", text: "Pas à Jean" }] } },
  ];
  const mien = plansDe(plans, "jean@ecole.fr");
  assert.equal(mien.length, 1);
  assert.deepEqual(remarquesParEleve(mien, { debut: "2026-09-01", fin: "2026-11-30" }, eleves).get("lea"), [
    { date: "2026-09-20", seance: "", texte: "Très investie." },
    { date: "2026-10-02", seance: "Séance 3", texte: "Bavarde avec sa voisine." },
  ]);
});
