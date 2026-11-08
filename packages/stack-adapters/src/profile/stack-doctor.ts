import type { Constat } from "./constat.js";
import type { StackProfile } from "./stack-profile.js";
import { libelleDetect } from "./detect.js";
import { lanceursCites, MARQUES_DES_LANCEURS, type FichierLu } from "./detection-bdd.js";

/**
 * Outillage des profils (J5) : proposer un profil d'après ce qu'un projet porte, et diagnostiquer
 * celui qu'il déclare. Les deux fonctions sont **pures** — elles reçoivent ce qu'on a lu du
 * disque et rendent un texte ou des constats, sans rien exécuter.
 */

export interface IndicesDuProjet {
  /** Chemins relatifs présents à la racine, tels qu'on les a listés. */
  fichiers: readonly string[];
  /** Dépendances déclarées (package.json…), qui disent le lanceur de tests mieux qu'un fichier. */
  dependances: readonly string[];
  /** Tous les fichiers, relatifs à la même racine : où sont les `.feature` et les étapes (ADR 0074). */
  arborescence?: readonly string[];
  /** Texte des manifestes (dépendances) : quel lanceur BDD le projet emploie (ADR 0074). */
  manifestes?: readonly FichierLu[];
}

/** Ce que `/stack init` écrirait, ou `null` quand rien n'est reconnu — on ne devine pas. */
export function proposeProfile(indices: IndicesDuProjet): string | null {
  const a = (f: string) => indices.fichiers.includes(f);
  const dep = (d: string) => indices.dependances.includes(d);

  if (dep("vitest")) return MODELES.typescript;
  if (a("pyproject.toml") || a("setup.cfg")) return MODELES.python;
  return null;
}

export type { Constat, Gravite } from "./constat.js";

/** Genres de canaris sans lesquels le diagnostic laisse un trou connu. */
const ESSENTIELS = ["passed", "assertion", "syntax"] as const;

export interface DiagnosticDeps {
  /** Le programme est-il lançable (présent dans le PATH, ou installé localement) ? */
  programmeTrouvable(programme: string): boolean;
  /** Au moins un fichier correspond-il à ce motif ? */
  cheminExiste(glob: string): boolean;
  /** Les fichiers de `detect` sont-ils présents ? Sinon le profil ne reconnaîtrait pas son projet. */
  fichiersDeDetectionPresents: boolean;
  /** Manifestes du composant (dépendances), pour vérifier que le lanceur BDD déclaré y est cité. Absents : non vérifié. */
  manifestes?: readonly FichierLu[];
}

/**
 * Ce que `/stack doctor` rapporte. Un programme introuvable est un **problème** : la commande
 * échouera. Un emplacement vide n'est qu'un **avertissement** : un projet peut n'avoir pas encore
 * de tests d'acceptance. Les constats favorables sont inclus, pour que le rapport se lise.
 */
export function diagnoseProfile(profile: StackProfile, deps: DiagnosticDeps): Constat[] {
  const constats: Constat[] = [];

  if (deps.fichiersDeDetectionPresents)
    constats.push({ gravite: "ok", message: `Le projet porte bien ${profile.detect.map(libelleDetect).join(" ou ")}.` });
  else
    constats.push({
      gravite: "probleme",
      message: `Aucun des fichiers de \`detect\` n'est présent (${profile.detect.map(libelleDetect).join(", ")}) : ce profil ne reconnaîtrait pas ce projet.`,
    });

  for (const [section, c] of [
    ["tests", profile.tests],
    ["lint", profile.lint],
    ["mutation", profile.mutation],
  ] as const) {
    if (!c) continue;
    const programme = c.command[0]!;
    if (deps.programmeTrouvable(programme)) constats.push({ gravite: "ok", message: `\`${programme}\` est lançable (${section}).` });
    else
      constats.push({
        gravite: "probleme",
        message: `\`${programme}\` est introuvable : la commande \`${section}\` échouera. Installez-le, ou corrigez la commande.`,
      });
  }

  for (const [nom, globs] of Object.entries(profile.layout)) {
    if (globs.length === 0) continue;
    const vus = globs.filter((g) => deps.cheminExiste(g));
    if (vus.length === globs.length) constats.push({ gravite: "ok", message: `\`${nom}\` : ${globs.join(", ")}.` });
    else
      constats.push({
        gravite: "avertissement",
        message: `\`${nom}\` : aucun fichier ne correspond à ${globs.filter((g) => !vus.includes(g)).join(", ")}. Normal si le projet n'en a pas encore.`,
      });
  }

  // BDD déclaré (ADR 0074) : ses dossiers existent-ils, son lanceur est-il cité par un manifeste ?
  for (const c of profile.bdd ?? []) {
    const features = c.features.replace(/\/+$/, "");
    const etapes = c.etapes.replace(/\/+$/, "");
    constats.push(
      deps.cheminExiste(`${features}/**/*.feature`)
        ? { gravite: "ok", message: `BDD : des \`.feature\` dans \`${features}\`.` }
        : { gravite: "avertissement", message: `BDD : aucun \`.feature\` dans \`${features}\`. Normal si aucune story n'y est encore ; sinon, le dossier déclaré n'est pas le bon.` },
      deps.cheminExiste(`${etapes}/**`)
        ? { gravite: "ok", message: `BDD : le dossier des étapes \`${etapes}\` existe.` }
        : { gravite: "avertissement", message: `BDD : le dossier des étapes \`${etapes}\` est vide ou absent. Normal si aucune story n'y est encore.` },
    );
    if (deps.manifestes)
      constats.push(
        lanceursCites(deps.manifestes).includes(c.lanceur)
          ? { gravite: "ok", message: `BDD : le lanceur \`${c.lanceur}\` est cité par un manifeste du projet.` }
          : { gravite: "avertissement", message: `BDD : le lanceur \`${c.lanceur}\` n'est cité par aucun manifeste du projet (${MARQUES_DES_LANCEURS[c.lanceur].join(", ")}). Est-il installé ?` },
      );
  }

  if (!profile.lint) constats.push({ gravite: "avertissement", message: "Aucun linter déclaré : la qualité de forme ne sera pas mesurée." });
  if (!profile.mutation) constats.push({ gravite: "avertissement", message: "Aucun outil de mutation déclaré : la porte de mutation ne sera pas disponible." });
  // Le trio `passed` / `assertion` / `syntax` est le minimum utile : sans `syntax`, rien ne
  // vérifie qu'une erreur de compilation ne passe pas pour un rouge légitime, et c'est de cette
  // distinction que dépendent les portes RED. Se contenter de signaler une liste VIDE laisserait
  // passer un profil qui ne déclare qu'un canari `passed`, dont doctor dirait « aucun problème ».
  const manquants = ESSENTIELS.filter((k) => !profile.canaries.some((c) => c.kind === k));
  if (manquants.length > 0)
    constats.push({
      gravite: "avertissement",
      message:
        profile.canaries.length === 0
          ? "Aucun canari déclaré : le classement des échecs ne sera pas vérifié, alors que les portes RED en dépendent."
          : `Canaris manquants : ${manquants.map((k) => `\`${k}\``).join(", ")}. Sans eux, ce que ces genres éprouvent n'est pas vérifié — \`syntax\` en particulier est le seul à prouver qu'une erreur de compilation ne passe pas pour un rouge légitime.`,
    });
  if (!profile.architecture)
    constats.push({ gravite: "avertissement", message: "Pas de section `architecture` : la règle de dépendance ne sera pas vérifiée (aucune analyse des imports)." });
  if (profile.infrastructureModules.length === 0)
    constats.push({
      gravite: "avertissement",
      message: "`infrastructureModules` est vide : la règle de dépendance n'aura rien à vérifier.",
    });

  return constats;
}

/** Modèles proposés. Ils doivent rester valides : un test les relit à chaque exécution. */
const MODELES = {
  typescript: `id: typescript
detect: [{ fichier: package.json, contient: '"vitest"' }]
tests:
  command: [vitest, run, --reporter=json, "--outputFile={rapport}"]
  report: vitest-json
lint:
  command: [eslint, --format, json, "--", "{fichiers}"]
  report: eslint-json
layout:
  acceptanceTests: ["tests/acceptance/**"]
  unitTests: ["tests/**", "src/**/*.test.ts"]
  sources: ["src/**"]
infrastructureModules: [Infrastructure, Interface, UI, API, react, express, next]
canaries:
  - kind: passed
    file: src/canari_{marque}.test.ts
    content: |
      import { expect, test } from "vitest";
      test("canari {marque}", () => { expect(1).toBe(1); });
  - kind: assertion
    file: src/canari_{marque}.test.ts
    content: |
      import { expect, test } from "vitest";
      test("canari {marque}", () => { expect(1).toBe(2); });
  - kind: missing_symbol
    file: src/canari_{marque}.test.ts
    content: |
      import { test } from "vitest";
      test("canari {marque}", () => { fonctionAbsente_{marque}(); });
  - kind: syntax
    file: src/canari_{marque}.test.ts
    content: |
      import { test } from "vitest";
      test("canari {marque}", () => { :::
`,
  python: `id: python
detect: [pyproject.toml]
tests:
  command: [pytest, "--junit-xml={rapport}"]
  report: junit-xml
# Aucune section lint ici : ruff ne produit pas le format qu'attend le lecteur eslint-json, et
# aucun lecteur ruff-json n'est encore écrit. La déclarer donnerait une porte qui ne mesure jamais
# rien sans jamais le dire — n'annoncer un lecteur qu'une fois écrit.
layout:
  acceptanceTests: ["tests/acceptance/**"]
  unitTests: ["tests/**"]
  sources: ["src/**"]
infrastructureModules: [django, flask, sqlalchemy]
canaries:
  - kind: passed
    file: tests/test_canari_{marque}.py
    content: |
      def test_{marque}(): assert True
  - kind: assertion
    file: tests/test_canari_{marque}.py
    content: |
      def test_{marque}(): assert 1 == 2
  - kind: missing_symbol
    file: tests/test_canari_{marque}.py
    content: |
      def test_{marque}(): fonction_absente_{marque}()
  - kind: syntax
    file: tests/test_canari_{marque}.py
    content: |
      def test_{marque}( :::
`,
} as const;
