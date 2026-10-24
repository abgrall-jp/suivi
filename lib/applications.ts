// Applications du site Je peux apprendre.
// « eleves » : l'application enregistre des élèves et des résultats, repris dans le tableau.
// Les autres sont des outils pour l'enseignant (page Activité, plus tard).
export type Application = { id: string; code: string; nom: string; url: string; eleves: boolean };

export const APPLICATIONS: Application[] = [
  { id: "sequenceur", code: "SEQ", nom: "Séquenceur", url: "https://sequenceur.jepeuxapprendre.fr", eleves: true },
  { id: "evalia", code: "EVA", nom: "Eval IA", url: "https://evalia.jepeuxapprendre.fr", eleves: true },
  { id: "edubot", code: "EDU", nom: "Edubot", url: "https://edubot.jepeuxapprendre.fr", eleves: true },
  { id: "cps", code: "CPS", nom: "AI CPS", url: "https://cps.jepeuxapprendre.fr", eleves: true },
  { id: "concentre", code: "CON", nom: "Concentré et Attentif", url: "https://concentre.jepeuxapprendre.fr", eleves: true },
  { id: "memoriser", code: "MEM", nom: "Mémoriser c'est facile", url: "https://memoriser.jepeuxapprendre.fr", eleves: true },
  { id: "motscroises", code: "MCR", nom: "Mots croisés", url: "https://motscroises.jepeuxapprendre.fr", eleves: true },
  { id: "textetrous", code: "TAT", nom: "Texte à trous", url: "https://textetrous.jepeuxapprendre.fr", eleves: true },
  { id: "planclasse", code: "PDC", nom: "Plan de classe IA", url: "https://planclasse.jepeuxapprendre.fr", eleves: true },
  { id: "appreciations", code: "APP", nom: "Studio d'Appréciations", url: "https://appreciations.jepeuxapprendre.fr", eleves: true },
  { id: "quiz", code: "QUIZ", nom: "Quiz IA", url: "https://quiz.jepeuxapprendre.fr", eleves: true },
  { id: "conception", code: "CNC", nom: "Assistant Conception Pédagogique", url: "https://conception.jepeuxapprendre.fr", eleves: false },
  { id: "maths", code: "MTH", nom: "Générateur de Problèmes de Maths", url: "https://maths.jepeuxapprendre.fr", eleves: false },
  { id: "motsmeles", code: "MML", nom: "Mots mêlés", url: "https://motsmeles.jepeuxapprendre.fr", eleves: false },
  { id: "organigrammes", code: "ORG", nom: "Organigrammes", url: "https://organigrammes.jepeuxapprendre.fr", eleves: false },
  { id: "craft", code: "CRF", nom: "Craft", url: "https://craft.jepeuxapprendre.fr", eleves: false },
  { id: "generateurcraft", code: "GCR", nom: "Générateur Craft", url: "https://generateur-craft.jepeuxapprendre.fr", eleves: false },
];
