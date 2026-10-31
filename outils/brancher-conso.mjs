// Branche dist/conso.cjs dans le dist/server.cjs d'une application : node outils/brancher-conso.mjs <server.cjs> <sortie> <id>
import fs from 'fs';
const [src, dst, id] = process.argv.slice(2);
let t = fs.readFileSync(src, 'utf8');
const re = /^([ \t]*)(?:var|const|let) app = \(0, import_express\.default\)\(\);\n/m;
const m = re.exec(t);
if (!m || re.exec(t.slice(m.index + m[0].length))) throw new Error('point d\'insertion introuvable ou multiple : ' + src);
if (t.includes('conso.cjs')) throw new Error('déjà branché');
const ligne = `${m[1]}try { require("./conso.cjs")(app, ${JSON.stringify(id)}); } catch (e) { console.error("Compteurs de consommation non charg\\xE9s :", e && e.message); }\n`;
t = t.slice(0, m.index + m[0].length) + ligne + t.slice(m.index + m[0].length);
fs.writeFileSync(dst, t);
console.log(id, 'ok, ligne', t.slice(0, m.index).split('\n').length + 1);
