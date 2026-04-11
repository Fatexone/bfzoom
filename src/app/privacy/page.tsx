import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Politique de confidentialite | BFZoom",
  description:
    "Politique de confidentialite de BFZoom pour l'application web et l'application iPhone.",
};

const sections = [
  {
    title: "1. Responsable du traitement",
    body: [
      "BFZoom est edite par smart idea agency.",
      "Pour toute question relative a la confidentialite ou a tes donnees, tu peux nous contacter a l'adresse support@bfzoom.fr.",
    ],
  },
  {
    title: "2. Donnees que nous pouvons collecter",
    body: [
      "Informations de compte: adresse email, identifiant utilisateur, nom affiche et informations necessaires a l'authentification.",
      "Donnees d'utilisation: historiques techniques de session, informations de credits, logs fonctionnels limites, diagnostics d'erreur et donnees necessaires a la securite de la plateforme.",
      "Contenus de communication: textes envoyes pour traduction, transcription, synthese vocale, chat et AI Practice, uniquement dans la mesure necessaire au fonctionnement du service.",
      "Donnees de paiement: BFZoom ne stocke pas les numeros complets de carte bancaire. Les paiements web sont traites par Stripe et les achats iOS par Apple.",
      "Donnees techniques: type d'appareil, systeme, version de l'application, adresse IP approximate, donnees de connexion reseau et informations de performance utiles au support et a la prevention des abus.",
    ],
  },
  {
    title: "3. Pourquoi nous utilisons ces donnees",
    body: [
      "Fournir les fonctionnalites BFZoom: visioconference traduite, Pocket Interpreter, AI Practice, gestion des credits et support utilisateur.",
      "Securiser les comptes, prevenir la fraude, limiter les abus et maintenir la disponibilite du service.",
      "Ameliorer la stabilite, la qualite audio, la latence, la traduction et l'experience produit.",
      "Respecter nos obligations legales, comptables et contractuelles.",
    ],
  },
  {
    title: "4. Bases juridiques",
    body: [
      "Execution du service lorsque tu utilises BFZoom.",
      "Interet legitime pour la securite, le support, l'amelioration technique et la prevention des abus.",
      "Obligations legales lorsqu'une conservation ou une communication est imposee par la loi.",
    ],
  },
  {
    title: "5. Partage avec des tiers",
    body: [
      "Nous pouvons faire appel a des prestataires techniques necessaires au fonctionnement de BFZoom, par exemple pour l'hebergement, l'authentification, la traduction, la transcription, la synthese vocale, la visioconference, l'analyse des erreurs et les paiements.",
      "Ces prestataires ne recoivent que les donnees necessaires a leur mission et agissent selon nos instructions ou leur propre politique lorsqu'ils sont prestataires de paiement ou de distribution.",
      "Nous ne vendons pas tes donnees personnelles.",
    ],
  },
  {
    title: "6. Conservation",
    body: [
      "Nous conservons les donnees aussi longtemps que necessaire pour fournir BFZoom, gerer tes credits, assurer le support, resoudre les incidents et respecter nos obligations legales.",
      "Certaines donnees techniques, journaux de securite ou informations de facturation peuvent etre conservees plus longtemps lorsque cela est necessaire pour la conformite, la prevention de la fraude ou la defense de nos droits.",
    ],
  },
  {
    title: "7. Securite",
    body: [
      "Nous mettons en oeuvre des mesures techniques et organisationnelles raisonnables pour proteger les comptes, les acces, les donnees de credits et les contenus traites par BFZoom.",
      "Aucun service en ligne ne peut garantir une securite absolue. En cas de question de securite, contacte-nous a support@bfzoom.fr.",
    ],
  },
  {
    title: "8. Tes droits",
    body: [
      "Selon ta situation et la legislation applicable, tu peux demander l'acces, la rectification, la suppression ou la limitation de certaines donnees.",
      "Tu peux aussi nous contacter pour toute question sur tes donnees, sur ton compte ou sur la fermeture de ton acces a BFZoom.",
    ],
  },
  {
    title: "9. Enfants",
    body: [
      "BFZoom n'est pas concu pour etre utilise de maniere autonome par de jeunes enfants. Si tu penses qu'une donnee a ete collectee de maniere inappropriee, contacte-nous afin que nous puissions examiner la situation.",
    ],
  },
  {
    title: "10. Modifications",
    body: [
      "Cette politique peut etre mise a jour afin de refleter les evolutions de BFZoom, de nos prestataires ou de nos obligations. La version publiee sur cette page est la version de reference.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-linear-to-b from-slate-50 via-white to-sky-50 text-slate-900">
      <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
          <Link href="/" className="text-lg font-extrabold tracking-tight sm:text-xl">
            <span className="text-sky-600">BFZoom</span>
            <span className="text-slate-700">.live</span>
          </Link>
          <nav className="hidden gap-4 text-sm font-medium sm:flex">
            <Link href="/" className="transition-colors hover:text-sky-700">
              Accueil
            </Link>
            <Link href="/contact" className="transition-colors hover:text-sky-700">
              Contact
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-lg shadow-slate-200/60 sm:p-10">
          <div className="mb-8 space-y-4">
            <div className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold tracking-wide text-sky-700 uppercase">
              Politique de confidentialite
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              Protection des donnees BFZoom
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
              Cette page explique quelles donnees BFZoom peut traiter lorsque tu utilises
              l&apos;application web, l&apos;application iPhone, la visioconference traduite,
              Pocket Interpreter, le chat et AI Practice.
            </p>
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Derniere mise a jour : 26 mars 2026
            </p>
          </div>

          <div className="grid gap-6">
            {sections.map((section) => (
              <section
                key={section.title}
                className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 sm:p-6"
              >
                <h2 className="mb-3 text-lg font-semibold text-slate-900 sm:text-xl">
                  {section.title}
                </h2>
                <div className="space-y-3">
                  {section.body.map((paragraph) => (
                    <p key={paragraph} className="text-sm leading-6 text-slate-700 sm:text-base">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <section className="mt-8 rounded-2xl border border-sky-200 bg-sky-50 p-5 sm:p-6">
            <h2 className="mb-2 text-lg font-semibold text-slate-900 sm:text-xl">
              Contact confidentialite
            </h2>
            <p className="text-sm leading-6 text-slate-700 sm:text-base">
              Pour toute demande relative a tes donnees ou a la confidentialite, contacte-nous
              a{" "}
              <a href="mailto:support@bfzoom.fr" className="font-semibold text-sky-700 hover:underline">
                support@bfzoom.fr
              </a>
              .
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
