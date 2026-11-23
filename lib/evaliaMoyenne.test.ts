import test from "node:test";
import assert from "node:assert/strict";
import { fusionnerEvalIA } from "./evaliaMoyenne.ts";

const app = (ids: string[]) => ({ id: "evalia", nom: "Eval IA", exercices: ids.map(id => ({ id, titre: `T ${id} (${id.endsWith("quiz") ? "QCM IA" : "Chatbot"})` })) });

test("quiz coef 1 + chatbot coef 2 : une colonne moyenne", () => {
  const essais = new Map<string, Record<string, any[]>>([["e1", {
    "evalia:t1~ai-quiz": [{ percent: 60, score: "6/10", at: 10 }],
    "evalia:t1~chatbot": [{ percent: 90, score: "18/20", at: 20 }],
  }]]);
  const a = app(["t1~ai-quiz", "t1~chatbot", "t2~chatbot"]);
  const r = fusionnerEvalIA([a], [a], essais);
  assert.deepEqual(r.applications[0].exercices.map(x => x.id), ["t1~moyenne", "t2~chatbot"]);
  const m = essais.get("e1")!["evalia:t1~moyenne"][0];
  assert.equal(Math.round(m.percent * 10) / 10, 80); // (60 + 90*2) / 3
  assert.equal(m.score, "16/20");
  assert.equal(m.parts.length, 2);
  assert.ok(essais.get("e1")!["evalia:t1~ai-quiz"]); // anciennes colonnes gardées pour les bulletins existants
});

test("un seul des deux : la partie manquante compte 0 (comme dans Eval IA) ; provisoire se propage", () => {
  const essais = new Map<string, Record<string, any[]>>([["e1", { "evalia:t1~chatbot": [{ percent: 50, score: "10/20", at: 5, provisoire: true }] }]]);
  const a = app(["t1~ai-quiz", "t1~chatbot"]);
  fusionnerEvalIA([a], [a], essais);
  const m = essais.get("e1")!["evalia:t1~moyenne"][0];
  assert.equal(Math.round(m.percent * 10) / 10, 33.3); assert.equal(m.provisoire, true); assert.equal(m.parts.length, 2);
});
