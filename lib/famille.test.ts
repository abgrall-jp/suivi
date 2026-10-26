import test from "node:test";
import assert from "node:assert/strict";
import { empreinteCode, genererCode, lireJeton, normaliserCode, signerJeton } from "./famille.ts";

test("code : écriture libre ramenée à la même empreinte", () => {
  assert.match(genererCode(), /^[A-Za-z]+-[A-Za-z]+-\d\d-\d$/);
  assert.equal(normaliserCode(" Renard  Tulipe 47 3 "), "renard-tulipe-47-3");
  assert.equal(empreinteCode("Renard-Tulipe-47-3", "s"), empreinteCode("renard tulipe 47 3", "s"));
  assert.notEqual(empreinteCode("Renard-Tulipe-47-3", "s"), empreinteCode("Renard-Tulipe-47-3", "autre"));
});

test("jeton : signé, daté, refusé s'il est modifié ou expiré", () => {
  const j = signerJeton("5b_durand_alice", "s");
  assert.equal(lireJeton(j, "s"), "5b_durand_alice");
  assert.equal(lireJeton(j, "autre"), null);
  assert.equal(lireJeton(j.replace(/^./, c => (c === "a" ? "b" : "a")), "s"), null);
  assert.equal(lireJeton(signerJeton("x", "s", -1000), "s"), null);
});
