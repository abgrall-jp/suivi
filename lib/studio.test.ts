import { test } from "node:test";
import assert from "node:assert/strict";
import { textesParEleve, trimestreDe } from "./studio.ts";

test("période du Studio → trimestre", () => {
  assert.equal(trimestreDe("Trimestre 1"), "T1");
  assert.equal(trimestreDe("2e trimestre"), "T2");
  assert.equal(trimestreDe("1er Trimestre"), "T1");
  assert.equal(trimestreDe("T3"), "T3");
  assert.equal(trimestreDe("Semestre 1"), null);
  assert.equal(trimestreDe("Année"), null);
  assert.equal(trimestreDe(""), null);
});

test("dernière appréciation de l'élève et du professeur, par élève", () => {
  const eleves = [{ id: "lea", classe: "5A", nom: "MARTIN", prenom: "Léa" }, { id: "hugo", classe: "5A", nom: "DUBOIS", prenom: "Hugo" }];
  const m = textesParEleve([
    { studentName: "Léa Martin", text: "Ancienne", term: "Trimestre 1", mode: "teacher_discipline", timestamp: 1 },
    { studentName: "MARTIN Léa", text: "Récente", term: "Trimestre 1", mode: "teacher_class", timestamp: 5 },
    { studentName: "Léa Martin", text: "Je progresse.", term: "Trimestre 1", mode: "student", timestamp: 3 },
    { studentName: "Léa Martin", text: "Autre trimestre", term: "Trimestre 2", timestamp: 9 },
    { studentName: "Hugo", text: "Nom incomplet : pas sûr", term: "Trimestre 1", timestamp: 2 },
    { studentName: "Hugo Dubois", text: "Sans mode : professeur", term: "Trimestre 1", timestamp: { toMillis: () => 4 } },
  ], "T1", eleves);
  assert.deepEqual(m.get("lea"), { prof: { texte: "Récente", le: 5 }, eleve: { texte: "Je progresse.", le: 3 } });
  assert.deepEqual(m.get("hugo"), { prof: { texte: "Sans mode : professeur", le: 4 } });
});
