"use strict";
// Fichier de démarrage avec compteurs de consommation (lus par Suivi, onglet « Consommation »).
// Dans cPanel > Setup Node.js App, « Application startup file » : dist/demarrer.cjs au lieu de dist/server.cjs.
// Il branche les compteurs (conso.cjs) sur le serveur Express de l'application, puis lance dist/server.cjs sans le modifier.
// Pour revenir en arrière : remettre dist/server.cjs comme fichier de démarrage.
const APPLI = "__APPLI__";
try {
  const Module = require("module");
  const installer = require("./conso.cjs");
  const charger = Module._load;
  let enveloppe = null;
  Module._load = function (demande, parent, principal) {
    const m = charger.apply(this, arguments);
    if (demande !== "express" || typeof m !== "function") return m;
    if (!enveloppe) {
      let fait = false;
      enveloppe = function () {
        const app = m.apply(this, arguments);
        if (!fait) {
          fait = true;
          try { installer(app, APPLI); } catch (e) { console.error("Compteurs de consommation non chargés :", e && e.message); }
        }
        return app;
      };
      Object.assign(enveloppe, m);
      Object.setPrototypeOf(enveloppe, Object.getPrototypeOf(m));
    }
    return enveloppe;
  };
} catch (e) {
  console.error("Compteurs de consommation non chargés :", e && e.message);
}
// Certaines applications se croient « en développement » si le fichier lancé ne s'appelle pas server.cjs.
const serveur = require("path").join(__dirname, "server.cjs");
if (/demarrer\.cjs$/.test(process.argv[1] || "")) process.argv[1] = serveur;
require(serveur);
