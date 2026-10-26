// Applications du site Je peux apprendre.
// « eleves » : l'application enregistre des élèves et des résultats, repris dans le tableau.
// Les autres sont des outils pour l'enseignant (page Activité, plus tard).
// « lecture » : par la porte de liaison de l'application (par défaut), ou directement dans la base du Studio d'Appréciations,
// qui partage le projet Google de Suivi (mêmes comptes enseignants, aucune clé à régler), ou dans la base du Plan de classe IA
// (autre projet Google : compte de service à part, enseignant reconnu par son adresse e-mail).
// « parents: false » : l'application n'a pas d'espace parents (pas de mot de passe parent à lui envoyer).
export type Application = { id: string; code: string; nom: string; url: string; eleves: boolean; lecture?: "porte" | "studio" | "planclasse"; parents?: false };

export const APPLICATIONS: Application[] = [
  { id: "sequenceur", code: "SEQ", nom: "Séquenceur", url: "https://sequenceur.jepeuxapprendre.fr", eleves: true },
  { id: "evalia", code: "EVA", nom: "Eval IA", url: "https://evalia.jepeuxapprendre.fr", eleves: true },
  { id: "edubot", code: "EDU", nom: "Edubot", url: "https://edubot.jepeuxapprendre.fr", eleves: true },
  { id: "cps", code: "CPS", nom: "AI CPS", url: "https://cps.jepeuxapprendre.fr", eleves: true, parents: false },
  { id: "concentre", code: "CON", nom: "Concentré et Attentif", url: "https://concentre.jepeuxapprendre.fr", eleves: true },
  { id: "memoriser", code: "MEM", nom: "Mémoriser c'est facile", url: "https://memoriser.jepeuxapprendre.fr", eleves: true },
  { id: "motscroises", code: "MCR", nom: "Mots croisés", url: "https://motscroises.jepeuxapprendre.fr", eleves: true },
  { id: "textetrous", code: "TAT", nom: "Texte à trous", url: "https://textetrous.jepeuxapprendre.fr", eleves: true },
  { id: "planclasse", code: "PDC", nom: "Plan de classe IA", url: "https://planclasse.jepeuxapprendre.fr", eleves: true, lecture: "planclasse" },
  { id: "appreciations", code: "APP", nom: "Studio d'Appréciations", url: "https://appreciations.jepeuxapprendre.fr", eleves: true, lecture: "studio" },
  { id: "quiz", code: "QUIZ", nom: "Quiz IA", url: "https://quiz.jepeuxapprendre.fr", eleves: true },
  { id: "edublockly", code: "EBK", nom: "EduBlockly Micro:bit", url: "https://edublockly.jepeuxapprendre.fr", eleves: true, parents: false },
  { id: "conception", code: "CNC", nom: "Assistant Conception Pédagogique", url: "https://conception.jepeuxapprendre.fr", eleves: false },
  { id: "maths", code: "MTH", nom: "Générateur de Problèmes de Maths", url: "https://maths.jepeuxapprendre.fr", eleves: false },
  { id: "motsmeles", code: "MML", nom: "Mots mêlés", url: "https://motsmeles.jepeuxapprendre.fr", eleves: false },
  { id: "organigrammes", code: "ORG", nom: "Organigrammes", url: "https://organigrammes.jepeuxapprendre.fr", eleves: false },
  { id: "craft", code: "CRF", nom: "Craft", url: "https://craft.jepeuxapprendre.fr", eleves: false },
  { id: "generateurcraft", code: "GCR", nom: "Générateur Craft", url: "https://generateur-craft.jepeuxapprendre.fr", eleves: false },
];
