import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FailureKind, ProcessRunner, TestResult } from "../protocols.js";
import { cheminSous } from "./chemin-sur.js";
import type { Constat } from "./constat.js";
import { executerTests } from "./execution-tests.js";
import { JETON_MARQUE, type CanaryKind, type StackProfile } from "./stack-profile.js";

/**
 * Canaris de `/stack doctor` (§8.6). Le code écrit un test dont il connaît d'avance la bonne
 * réponse, lance la commande que le profil déclare, et vérifie que l'échec obtenu porte le
 * classement attendu. Aucun LLM n'intervient : l'oracle est ici.
 *
 * Ce que ces canaris protègent tient en une phrase. Les portes RED tiennent `assertion` et
 * `missing_symbol` pour des rouges légitimes, et `other_error` pour un échec à rejeter. Si le
 * lecteur d'un projet range une erreur de syntaxe dans l'une des deux premières, **du code qui
 * ne compile pas franchit la porte** ; s'il range un symbole manquant dans la troisième, un
 * cycle TDD correct est refusé. Les deux erreurs sont silencieuses sans canari.
 */

export interface CanaryObservation {
  kind: CanaryKind;
  /** Le lanceur a-t-il produit un rapport lisible ? Faux quand la suite n'a même pas compilé. */
  rapportLu: boolean;
  /** Résultats portant la marque du canari, et eux seuls. */
  results: readonly TestResult[];
}

/**
 * Ce que la porte RED fait d'un classement. Elle ne **rejette** que `other_error`
 * (`extensions/tdd/src/effects.ts`) : tout le reste franchit la porte, **y compris un échec non
 * classé**. Écrire la règle dans ce sens-là, et non en énumérant les classements acceptés, évite
 * de croire qu'un `undefined` serait refusé — il ne l'est pas.
 */
const REJETE_PAR_LA_PORTE_RED = (k: FailureKind | undefined) => k === "other_error";
const FRANCHIT_LA_PORTE_RED = (k: FailureKind | undefined) => !REJETE_PAR_LA_PORTE_RED(k);

const nomme = (k: FailureKind | undefined) => k ?? "non classé";
const liste = (ks: Iterable<FailureKind | undefined>) => [...new Set([...ks].map(nomme))].map((k) => `\`${k}\``).join(", ");

export function jugerCanari(o: CanaryObservation): Constat {
  const prefixe = `Canari \`${o.kind}\``;

  if (!o.rapportLu) {
    if (o.kind === "syntax")
      return {
        gravite: "ok",
        message: `${prefixe} : la suite n'a pas compilé et aucun rapport n'a été produit. C'est le comportement sûr — rien n'a pu être classé à tort.`,
      };
    return {
      gravite: "probleme",
      message:
        `${prefixe} : la commande n'a produit aucun rapport, et aucune erreur de compilation n'a pu être lue. ` +
        `Sur un langage compilé, c'est attendu — un symbole absent arrête la compilation — mais il faut alors déclarer \`buildErrors\` ` +
        `pour que ces erreurs soient lues ; sans quoi la porte RED ne verra jamais ce rouge pourtant légitime.`,
    };
  }

  if (o.results.length === 0) {
    // Le rapport est complet et ne mentionne pas le canari. Pour `syntax`, c'est le cas le plus
    // dangereux de tous : le lanceur a rendu une suite verte alors qu'un fichier ne compile pas,
    // et la porte GREEN, qui ne regarde que `failed === 0`, attesterait un vert sur du code qui
    // ne se construit pas. Que la cause soit un emplacement non découvert ou un fichier
    // silencieusement ignoré, on ne peut pas les distinguer — et l'une des deux est grave.
    if (o.kind === "syntax")
      return {
        gravite: "probleme",
        message: `${prefixe} : le rapport est complet et ne mentionne pas ce canari, alors qu'il ne compile pas. Soit le lanceur ignore silencieusement un fichier cassé — et une suite « verte » ne prouverait alors plus rien —, soit l'emplacement déclaré n'est pas découvert. Les deux demandent correction.`,
      };
    return {
      gravite: "probleme",
      message: `${prefixe} : le lanceur ne l'a pas vu. Le fichier écrit ne correspond à rien de ce que la commande découvre — vérifiez son emplacement dans \`canaries\`, et les motifs de \`layout\`.`,
    };
  }

  if (o.kind === "passed") {
    const rates = o.results.filter((r) => r.status !== "passed");
    return rates.length === 0
      ? { gravite: "ok", message: `${prefixe} : un test trivial passe, et le rapport le dit.` }
      : {
          gravite: "probleme",
          message: `${prefixe} : un test qui ne fait qu'affirmer le vrai ne passe pas (${rates.map((r) => r.status).join(", ")}). La commande déclarée ou son rapport est en cause, avant toute question de classement.`,
        };
  }

  const echecs = o.results.filter((r) => r.status === "failed");
  if (echecs.length === 0)
    return {
      gravite: "probleme",
      message: `${prefixe} : ce canari doit échouer, et il passe. Le rapport ne reflète pas ce que la commande a exécuté.`,
    };

  // TOUS les échecs portant la marque sont jugés, et le pire l'emporte. Ne regarder que le
  // premier laisserait passer le cas qui compte : un rapport dont la première entrée est un
  // `other_error` de chargement et la seconde une `assertion` serait déclaré sain, alors que la
  // porte s'arrête sur la première entrée qui l'arrange.
  const classes = new Set(echecs.map((e) => e.failureKind));

  if (o.kind === "syntax") {
    const dangereux = [...classes].filter(FRANCHIT_LA_PORTE_RED);
    if (dangereux.length > 0)
      return {
        gravite: "probleme",
        message:
          `${prefixe} : une erreur de syntaxe ressort classée ${liste(dangereux)}. La porte RED ne rejette que \`other_error\` : ` +
          `ce classement la franchit, donc du code qui ne compile pas passerait pour un rouge légitime. Resserrez les motifs du lecteur.`,
      };
    return { gravite: "ok", message: `${prefixe} : une erreur de syntaxe est classée \`other_error\`, donc rejetée par la porte RED.` };
  }

  // Un classement que la porte rejette est un problème en sens inverse : le rouge est légitime,
  // et le cycle TDD se trouverait bloqué.
  const rejetes = [...classes].filter(REJETE_PAR_LA_PORTE_RED);
  if (rejetes.length > 0)
    return {
      gravite: "probleme",
      message: `${prefixe} : classé ${liste(rejetes)} au lieu de \`${o.kind}\`. La porte RED refuse ce classement : un rouge légitime serait rejeté et le cycle TDD bloqué.`,
    };

  // Un échec non classé franchit la porte, mais le lecteur n'a alors rien reconnu : la
  // classification qu'on cherchait à éprouver n'a pas eu lieu.
  if (classes.has(undefined))
    return {
      gravite: "probleme",
      message: `${prefixe} : l'échec n'est pas classé du tout. Le lecteur n'a reconnu ni assertion ni symbole manquant, et la porte RED l'acceptera sans savoir pourquoi.`,
    };

  if (classes.size === 1 && classes.has(o.kind)) return { gravite: "ok", message: `${prefixe} : classé \`${o.kind}\`, comme attendu.` };

  // Reste la confusion entre les deux classements que la porte accepte tous deux : inexact, sans
  // conséquence pour les portes.
  return {
    gravite: "avertissement",
    message: `${prefixe} : classé ${liste(classes)} au lieu de \`${o.kind}\`. Sans conséquence pour les portes, qui acceptent ces classements comme un rouge légitime, mais les messages d'échec seront trompeurs.`,
  };
}

export interface CanariBddObservation {
  rapportLu: boolean;
  /** Résultats portant la marque du canari, et eux seuls. */
  results: readonly TestResult[];
  /** Le dossier `features` du couple éprouvé, pour les messages. */
  features: string;
}

/**
 * Canari BDD (ADR 0074 §3) : un scénario dont une étape n'a pas de définition n'a rien vérifié.
 * La porte de DISTILL refuse `other_error` et les tests ignorés, et rien d'autre : ce scénario doit
 * donc ressortir dans l'un des deux. Réussi, ou classé comme un rouge légitime, il franchit la porte.
 */
export function jugerCanariBdd(o: CanariBddObservation): Constat {
  const prefixe = `Canari BDD (\`${o.features}\`, étape sans définition)`;
  if (!o.rapportLu)
    return {
      gravite: "avertissement",
      message: `${prefixe} : la commande n'a produit aucun rapport. Rien n'a pu passer à tort, mais une étape manquante fera échouer toute la suite, et la porte ne saura pas dire laquelle.`,
    };
  if (o.results.length === 0)
    return {
      gravite: "avertissement",
      message:
        `${prefixe} : le lanceur n'a pas exécuté le .feature écrit dans \`${o.features}\`. Soit ce dossier n'est pas découvert — et les scénarios de DISTILL n'y tourneront pas —, ` +
        `soit le lanceur n'exécute un .feature que si les définitions d'étapes le chargent. Dans le second cas, ce qu'il fait d'une étape sans définition n'est pas vérifié.`,
    };
  if (o.results.some((r) => r.status === "passed"))
    return {
      gravite: "probleme",
      message: `${prefixe} : le scénario est rendu réussi. Un scénario qui n'a rien vérifié passerait pour vert : configurez le lanceur pour qu'une étape non définie fasse échouer le test.`,
    };
  const franchissent = o.results.filter((r) => r.status === "failed" && FRANCHIT_LA_PORTE_RED(r.failureKind));
  if (franchissent.length > 0)
    return {
      gravite: "probleme",
      message:
        `${prefixe} : l'échec est classé ${liste(franchissent.map((r) => r.failureKind))}. La porte ne refuse que \`other_error\` : ` +
        `ce scénario passerait pour un rouge légitime alors qu'il n'a rien vérifié. Resserrez les motifs du lecteur.`,
    };
  return { gravite: "ok", message: `${prefixe} : le scénario est refusé par la porte (échec \`other_error\` ou test ignoré).` };
}

/** Le .feature du canari BDD : Gherkin ne dépend d'aucun langage ; la langue est imposée, une autre par défaut ne lirait pas ces mots-clés. */
const featureCanari = (marque: string) =>
  `# language: en\nFeature: ${marque} canary\n\n  Scenario: ${marque} canary\n    When the step ${marque} has no definition at all\n`;

export interface RunCanariesDeps {
  runner: ProcessRunner;
  /**
   * Racine d'une **copie isolée** du projet — un `git worktree` temporaire (§8.6, point 4).
   * Jamais le répertoire du projet : les canaris y sont écrits, et l'un d'eux ne compile pas.
   */
  sandboxRoot: string;
  /**
   * Racine du projet d'origine, où sont installés les `outils` du profil (ADR 0075). La copie Git ne
   * les a pas : ils sont ignorés par Git. Absente, ceux de la copie.
   */
  racineDesOutils?: string;
  timeoutMs?: number;
  onOutput?: (chunk: string) => void;
}

export interface CanaryRun {
  constats: Constat[];
  observations: CanaryObservation[];
}

/**
 * Vérifie un profil en l'exécutant : un relevé initial, puis un canari à la fois. Un seul canari
 * est présent par exécution — sinon celui qui ne compile pas empêcherait les autres de s'exécuter.
 */
export async function runCanaries(profile: StackProfile, deps: RunCanariesDeps): Promise<CanaryRun> {
  const constats: Constat[] = [];
  const observations: CanaryObservation[] = [];

  const initial = await lancer(profile, deps);
  if (!initial.rapportLu) {
    constats.push({
      gravite: "probleme",
      message: `La commande de test ne produit aucun rapport lisible (code ${initial.exitCode}). Tant qu'il manque, aucune porte ne peut juger quoi que ce soit ; les canaris n'ont pas été lancés.${initial.sortie ? `\n\n\`\`\`\n${initial.sortie.slice(-1500)}\n\`\`\`` : ""}`,
    });
    return { constats, observations };
  }
  // Un rapport lisible mais vide n'est pas un bon résultat : la commande n'a rien trouvé à
  // exécuter — mauvaise configuration, mauvais répertoire, motif de découverte à côté. Le compter
  // comme favorable laisserait doctor conclure « aucun problème » sans avoir rien mesuré.
  constats.push(
    initial.results.length === 0
      ? {
          gravite: "avertissement",
          message:
            "La commande de test s'exécute et son rapport est lisible, mais **il ne contient aucun test**. La commande ne découvre rien : vérifiez sa configuration et le répertoire depuis lequel elle est lancée.",
        }
      : { gravite: "ok", message: `La commande de test s'exécute et son rapport est lisible : ${initial.results.length} test(s) relevé(s).` },
  );

  // Canari BDD : écrit par le code, dans le dossier `features` de chaque couple déclaré.
  for (const couple of profile.bdd ?? []) {
    const marque = `c${randomBytes(4).toString("hex")}`;
    const chemin = await cheminSous(deps.sandboxRoot, join(couple.features, `${marque}.feature`));
    if (chemin === null) {
      constats.push({ gravite: "probleme", message: `Canari BDD : \`${couple.features}\` sort de la copie isolée une fois les liens symboliques résolus ; il n'a pas été écrit.` });
      continue;
    }
    await mkdir(dirname(chemin), { recursive: true });
    await writeFile(chemin, featureCanari(marque));
    try {
      const run = await lancer(profile, deps);
      // Un lanceur peut changer la casse du titre (`C1A2…Canary`) : la marque est cherchée sans elle.
      const sienne = (r: TestResult) => `${r.id} ${r.file}`.toLowerCase().includes(marque);
      constats.push(jugerCanariBdd({ rapportLu: run.rapportLu, results: run.results.filter(sienne), features: couple.features }));
    } finally {
      await rm(chemin, { force: true });
    }
  }

  if (profile.canaries.length === 0) {
    constats.push({
      gravite: "avertissement",
      message:
        "Aucun canari déclaré : le classement des échecs n'est pas vérifié. Sans lui, rien ne garantit qu'une erreur de syntaxe sera distinguée d'une assertion fausse — c'est de cette distinction que dépendent les portes RED.",
    });
    return { constats, observations };
  }

  for (const gabarit of profile.canaries) {
    const marque = `c${randomBytes(4).toString("hex")}`;
    const relatif = gabarit.file.replaceAll(JETON_MARQUE, marque);
    // Résolution des liens symboliques, et pas seulement du texte du chemin : le dépôt peut
    // porter un lien que `git worktree` reproduit, et `tests/x.py` n'a alors aucun `..` tout en
    // désignant un fichier de l'utilisateur. Voir `chemin-sur.ts`.
    const chemin = await cheminSous(deps.sandboxRoot, relatif);
    if (chemin === null) {
      constats.push({
        gravite: "probleme",
        message: `Canari \`${gabarit.kind}\` : \`${gabarit.file}\` sort de la copie isolée une fois les liens symboliques résolus ; il n'a pas été écrit. Un lien du dépôt détourne-t-il cet emplacement ?`,
      });
      continue;
    }

    await mkdir(dirname(chemin), { recursive: true });
    await writeFile(chemin, gabarit.content.replaceAll(JETON_MARQUE, marque));
    try {
      const run = await lancer(profile, deps);
      const observation: CanaryObservation = {
        kind: gabarit.kind,
        rapportLu: run.rapportLu,
        results: run.results.filter((r) => r.id.includes(marque) || r.file.includes(marque)),
      };
      observations.push(observation);
      constats.push(jugerCanari(observation));
    } finally {
      await rm(chemin, { force: true });
    }
  }

  return { constats, observations };
}

interface Lancement {
  rapportLu: boolean;
  results: TestResult[];
  exitCode: number | null;
  sortie: string;
}

/** Même lancement que l'adaptateur (`executerTests`) : ce que les canaris éprouvent est ce que les portes reçoivent. */
async function lancer(profile: StackProfile, deps: RunCanariesDeps): Promise<Lancement> {
  try {
    const e = await executerTests(profile, deps.runner, {
      cwd: deps.sandboxRoot,
      ...(deps.racineDesOutils ? { racineDesOutils: deps.racineDesOutils } : {}),
      timeoutMs: deps.timeoutMs ?? 5 * 60_000,
      ...(deps.onOutput ? { onOutput: deps.onOutput } : {}),
    });
    return { rapportLu: e.results !== null, results: e.results ?? [], exitCode: e.exitCode, sortie: e.sortie };
  } catch {
    // Un rapport présent mais illisible vaut un rapport absent : rien n'en est tiré.
    return { rapportLu: false, results: [], exitCode: null, sortie: "" };
  }
}
