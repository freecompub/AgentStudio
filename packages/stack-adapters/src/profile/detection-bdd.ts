import { LANCEURS_BDD } from "./stack-profile.js";

/**
 * Détection du BDD d'un composant (ADR 0074 §2.5), pour `/stack init` et `/stack doctor`. Pure : elle
 * reçoit les fichiers du composant et le texte de ses manifestes, et ne devine rien. Ce qui est propre
 * à un écosystème tient dans deux tables de données : les marques de chaque lanceur, les noms de
 * manifestes.
 */
export type LanceurBdd = (typeof LANCEURS_BDD)[number];

/** Marques d'un lanceur dans un manifeste : nom de paquet ou de groupe, lu comme un nom entier. */
export const MARQUES_DES_LANCEURS: Record<LanceurBdd, readonly string[]> = {
  reqnroll: ["Reqnroll"],
  specflow: ["SpecFlow"],
  "cucumber-js": ["@cucumber/cucumber"],
  "jest-cucumber": ["jest-cucumber"],
  "cucumber-jvm": ["io.cucumber"],
  "pytest-bdd": ["pytest-bdd", "pytest_bdd"],
  behave: ["behave"],
};

/** Fichiers qui déclarent les dépendances d'un projet, quel que soit l'écosystème. */
export const MANIFESTE = /(^|\/)(package\.json|pyproject\.toml|setup\.cfg|requirements[^/]*\.txt|[^/]+\.csproj|pom\.xml|build\.gradle(\.kts)?)$/i;

/** Noms usuels d'un dossier de définitions d'étapes. */
const DOSSIERS_D_ETAPES = ["steps", "stepdefinitions", "step_definitions", "bindings", "glue"];
const IGNORES = new Set(["node_modules", "bin", "obj", "target", "dist", "vendor"]);
const ignore = (chemin: string) => chemin.split("/").some((s) => s.startsWith(".") || IGNORES.has(s));

export interface FichierLu {
  path: string;
  content: string;
}

export interface DetectionBdd {
  lanceur?: LanceurBdd;
  features?: string;
  etapes?: string;
}

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Une marque se lit comme un nom entier : « behaves » n'est pas behave, « Reqnroll.xUnit » est Reqnroll. */
const porte = (texte: string, marque: string) => new RegExp(`(?<![\\w-])${echapper(marque)}(?![\\w-])`, "i").test(texte);

/** Lanceurs dont une marque apparaît dans l'un des manifestes. */
export function lanceursCites(manifestes: readonly FichierLu[]): LanceurBdd[] {
  return LANCEURS_BDD.filter((l) => manifestes.some((m) => MARQUES_DES_LANCEURS[l].some((x) => porte(m.content, x))));
}

const dossierDe = (f: string) => f.split("/").slice(0, -1).join("/");
/** Dossier parent commun ; `""` s'il n'y en a pas d'autre que la racine. */
function communs(dossiers: readonly string[]): string {
  const parts = dossiers.map((d) => d.split("/"));
  const out: string[] = [];
  for (let i = 0; parts.every((p) => p[i] !== undefined && p[i] === parts[0]![i]); i++) out.push(parts[0]![i]!);
  return out.join("/");
}

export function detecterBdd(i: { fichiers: readonly string[]; manifestes: readonly FichierLu[] }): DetectionBdd {
  const fichiers = i.fichiers.filter((f) => !ignore(f));
  const out: DetectionBdd = {};
  // Plusieurs lanceurs cités : on ne choisit pas.
  const lanceurs = lanceursCites(i.manifestes.filter((m) => !ignore(m.path)));
  if (lanceurs.length === 1) out.lanceur = lanceurs[0]!;
  const parents = [...new Set(fichiers.filter((f) => f.endsWith(".feature")).map(dossierDe))];
  const features = parents.length === 1 ? parents[0]! : parents.length > 1 ? communs(parents) : "";
  if (features) out.features = features;
  // Le dossier d'étapes : le premier segment, en partant de la racine, qui porte un nom usuel.
  const etapes = new Set<string>();
  for (const f of fichiers) {
    const segs = dossierDe(f).split("/");
    const k = segs.findIndex((s) => DOSSIERS_D_ETAPES.includes(s.toLowerCase()));
    if (k >= 0) etapes.add(segs.slice(0, k + 1).join("/"));
  }
  if (etapes.size === 1) out.etapes = [...etapes][0]!;
  return out;
}

/**
 * Ce que `/stack init` ajoute au profil proposé : la section `bdd` pour un couple complet ; pour une
 * moitié, un commentaire qui dit ce qui est trouvé et ce qui manque ; rien sinon (pas de BDD).
 */
export function blocBdd(d: DetectionBdd): string {
  if (d.lanceur && d.features && d.etapes) return `bdd:\n  - lanceur: ${d.lanceur}\n    features: ${d.features}\n    etapes: ${d.etapes}\n`;
  const trouve = [d.lanceur && `lanceur ${d.lanceur}`, d.features && `dossier des .feature ${d.features}`, d.etapes && `dossier des étapes ${d.etapes}`].filter(Boolean);
  if (!trouve.length) return "";
  const manque = [!d.lanceur && "lanceur", !d.features && "dossier des .feature", !d.etapes && "dossier des étapes"].filter(Boolean);
  return `# bdd (ADR 0074) : à compléter. Trouvé : ${trouve.join(", ")}. Introuvable : ${manque.join(", ")}.\n`;
}

/**
 * Au démarrage de skraft (08/11) : pour chaque racine de composant dont la pile ne dit rien du BDD
 * (`bddNonDecide`), les signes qu'il en montre — un lanceur cité par un manifeste, des `.feature`. Un
 * dossier d'étapes seul n'en est pas un : `steps` ou `bindings` servent aussi ailleurs. Chemins relatifs
 * à la racine du projet ; un motif par composant concerné, à montrer tel quel.
 */
export function bddNonDeclare(racines: readonly string[], fichiers: readonly string[], manifestes: readonly FichierLu[]): string[] {
  const sous = <T>(racine: string, xs: readonly T[], chemin: (x: T) => string) => xs.filter((x) => racine === "." || chemin(x).startsWith(`${racine}/`));
  const relatif = (racine: string, p: string) => (racine === "." ? p : p.slice(racine.length + 1));
  const projet = (racine: string, p: string) => (racine === "." ? p : `${racine}/${p}`);
  const motifs: string[] = [];
  for (const racine of racines) {
    const siens = sous(racine, manifestes, (m) => m.path);
    const d = detecterBdd({
      fichiers: sous(racine, fichiers, (f) => f).map((f) => relatif(racine, f)),
      manifestes: siens.map((m) => ({ path: relatif(racine, m.path), content: m.content })),
    });
    const signes: string[] = [];
    if (d.lanceur) {
      const cite = siens.find((m) => lanceursCites([m]).includes(d.lanceur!));
      signes.push(`lanceur ${d.lanceur} cité par \`${cite?.path ?? "un manifeste"}\``);
    }
    if (d.features) signes.push(`des \`.feature\` dans \`${projet(racine, d.features)}\``);
    if (!signes.length) continue;
    motifs.push(
      `${racine === "." ? "Le projet" : `Composant \`${racine}\``} : sa pile ne dit rien du BDD, mais il en montre les signes (${signes.join(" ; ")}). ` +
        "Déclare `bdd` dans sa pile (`lanceur`, `features`, `etapes`), ou `bdd: false` s'il ne fait pas de BDD ; `/stack init` peut le proposer.",
    );
  }
  return motifs;
}
