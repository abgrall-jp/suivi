// Fausse porte de liaison « Texte à trous » (port 3201), noms écrits autrement que dans Mémoriser.
import http from 'http';
const donnees = {
  teacher: { id: 't_jean', name: 'Jean Martin' },
  classes: [{ id: 'c1', name: '5ème B' }],
  students: [
    { id: 's1', name: 'DURAND Alice', classId: 'c1', className: '5ème B' },
    { id: 's2', name: 'Bob L.', classId: 'c1', className: '5ème B' },
    { id: 's3', name: 'Test Prof', classId: 'c1', className: '5ème B' },
  ],
  exercises: [{ id: 'ex1', title: 'Le présent' }, { id: 'ex2', title: 'Sans résultat' }],
  results: [
    { id: 'r1', studentId: 's1', exerciseId: 'ex1', exerciseTitle: 'Le présent', percent: 40, score: '4/10', completedAt: 1000 },
    { id: 'r2', studentId: 's1', exerciseId: 'ex1', exerciseTitle: 'Le présent', percent: 90, score: '9/10', completedAt: 2000 },
    { id: 'r3', studentId: 's2', exerciseId: 'ex1', exerciseTitle: 'Le présent', percent: 70, score: '7/10', completedAt: 1500 },
  ],
};
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (s, d) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
  if (req.headers['x-suivi-cle'] !== 'cle-tat') return json(401, { error: 'Clé refusée.' });
  const email = (u.searchParams.get('email') || '').toLowerCase();
  if (u.pathname === '/api/suivi/enseignant') return json(200, { teacher: ['jean@ecole.fr', 'autre@ecole.fr'].includes(email) ? donnees.teacher : null });
  if (u.pathname === '/api/suivi/donnees') return email === 'jean@ecole.fr' || email === 'autre@ecole.fr' ? json(200, donnees) : json(404, { error: 'Inconnu' });
  json(404, { error: 'nope' });
}).listen(3201, '127.0.0.1');
