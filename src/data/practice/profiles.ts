export type PracticeProfile = {
  id: string;
  name: string;
  description: string;
  signals: {
    roles?: string[];
    keywords?: string[];
  };
};

export const practiceProfiles: PracticeProfile[] = [
  {
    id: "executive",
    name: "Leader stratégique",
    description:
      "Tu incarnes une posture de direction : tu coordonnes des équipes, tu mobilises les parties prenantes et tu présentes des résultats chiffrés.",
    signals: {
      roles: ["CEO", "Directeur", "CTO", "VP", "leadership"],
      keywords: ["vision", "résultats", "investisseurs"],
    },
  },
  {
    id: "creator",
    name: "Créateur de contenu",
    description:
      "Tu conçois des formats, expérimentes des narrations originales et tu cherches des façons ludiques de partager ton expertise.",
    signals: {
      roles: ["Content", "Créatif", "Designer", "Motion"],
      keywords: ["storytelling", "format", "community"],
    },
  },
  {
    id: "coach",
    name: "Coach & formateur",
    description:
      "Tu appliques la pédagogie active : tu poses des questions, challenge les idées et inspires une transformation rapide.",
    signals: {
      roles: ["Coach", "Formateur", "Facilitateur"],
      keywords: ["énergique", "challenge", "progrès"],
    },
  },
  {
    id: "default",
    name: "Profil BFZoom",
    description: "Une posture polyvalente pour continuer d’expérimenter et garder l’esprit explorateur.",
    signals: {
      roles: ["BFZoomer", "Collaborateur"],
      keywords: ["collaboration", "tech", "expérimenter"],
    },
  },
];
