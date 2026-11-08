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
