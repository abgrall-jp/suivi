import { test } from "node:test";
import assert from "node:assert/strict";
import { correspond, empreinte, genererMotDePasse } from "./parents.ts";

test("mot de passe lisible, empreinte vérifiable, jamais le mot de passe en clair", () => {
  const m = genererMotDePasse();
  assert.match(m, /^[A-Z][a-z]+-[A-Z][a-z]+-\d{2}$/);
  const e = empreinte(m);
  assert.match(e, /^scrypt:[0-9a-f]{32}:[0-9a-f]{64}$/);
  assert.ok(!e.includes(m));
  assert.ok(correspond(m, e));
  assert.ok(!correspond(m + "x", e));
  assert.notEqual(empreinte(m), e); // sel différent à chaque fois
});
