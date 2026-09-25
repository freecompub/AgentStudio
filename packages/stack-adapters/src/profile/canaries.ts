import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { FailureKind, ProcessRunner, TestResult } from "../protocols.js";
import type { Constat } from "./constat.js";
import { lireTests } from "./read-report.js";
import { JETON_MARQUE, type CanaryKind, type StackProfile } from "./stack-profile.js";
import { substituer } from "./tokens.js";

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

/** Ce que la porte RED fait d'un classement : l'accepte comme rouge, ou le rejette. */
const ACCEPTE_PAR_LA_PORTE_RED: readonly FailureKind[] = ["assertion", "missing_symbol"];

const nomme = (k: FailureKind | undefined) => k ?? "non classé";

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
        `${prefixe} : la commande n'a produit aucun rapport, donc aucun résultat à classer. ` +
        `Dans un langage compilé, c'est attendu — un symbole manquant empêche la compilation — mais un profil ne sait pas encore lire les erreurs de compilation : ` +
        `la porte RED ne verra jamais ce rouge pourtant légitime.`,
    };
  }

  if (o.results.length === 0)
    return {
      gravite: o.kind === "syntax" ? "avertissement" : "probleme",
      message: `${prefixe} : le lanceur ne l'a pas vu. Le fichier écrit ne correspond à rien de ce que la commande découvre — vérifiez son emplacement dans \`canaries\`, et les motifs de \`layout\`.`,
    };

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

  const obtenu = echecs[0]!.failureKind;

  if (o.kind === "syntax") {
    if (obtenu !== undefined && ACCEPTE_PAR_LA_PORTE_RED.includes(obtenu))
      return {
        gravite: "probleme",
        message: `${prefixe} : une erreur de syntaxe est classée \`${obtenu}\`. La porte RED tient ce classement pour un rouge légitime : du code qui ne compile pas la franchirait. Resserrez les motifs de classement du lecteur.`,
      };
    if (obtenu === undefined)
      return {
        gravite: "avertissement",
        message: `${prefixe} : l'échec n'est pas classé. La porte RED ne le prendra pas pour un rouge légitime — mais elle ne dira pas non plus pourquoi elle refuse.`,
      };
    return { gravite: "ok", message: `${prefixe} : une erreur de syntaxe est classée \`${obtenu}\`, et non comme un rouge légitime.` };
  }

  if (obtenu === o.kind) return { gravite: "ok", message: `${prefixe} : classé \`${obtenu}\`, comme attendu.` };

  // Confondre `assertion` et `missing_symbol` ne trompe aucune porte : les deux sont acceptées.
  if (obtenu !== undefined && ACCEPTE_PAR_LA_PORTE_RED.includes(obtenu))
    return {
      gravite: "avertissement",
      message: `${prefixe} : classé \`${obtenu}\` au lieu de \`${o.kind}\`. Sans conséquence pour les portes, qui acceptent les deux comme un rouge légitime, mais les messages d'échec seront trompeurs.`,
    };

  return {
    gravite: "probleme",
    message: `${prefixe} : classé \`${nomme(obtenu)}\` au lieu de \`${o.kind}\`. La porte RED refuse ce classement : un rouge légitime serait rejeté et le cycle TDD bloqué.`,
  };
}

export interface RunCanariesDeps {
  runner: ProcessRunner;
  /**
   * Racine d'une **copie isolée** du projet — un `git worktree` temporaire (§8.6, point 4).
   * Jamais le répertoire du projet : les canaris y sont écrits, et l'un d'eux ne compile pas.
   */
  sandboxRoot: string;
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
  constats.push({
    gravite: "ok",
    message: `La commande de test s'exécute et son rapport est lisible : ${initial.results.length} test(s) relevé(s).`,
  });

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
    const chemin = resolve(deps.sandboxRoot, relatif);
    // Le schéma refuse déjà les chemins remontants ; on le revérifie ici, parce que c'est ici
    // qu'un fichier est réellement écrit.
    const dehors = relative(deps.sandboxRoot, chemin);
    if (dehors.startsWith("..") || resolve(deps.sandboxRoot, dehors) !== chemin) {
      constats.push({ gravite: "probleme", message: `Canari \`${gabarit.kind}\` : \`${gabarit.file}\` sort de la copie isolée ; il n'a pas été écrit.` });
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

async function lancer(profile: StackProfile, deps: RunCanariesDeps): Promise<Lancement> {
  // Le rapport est écrit hors de la copie isolée : il ne doit pas se retrouver dans le diff.
  const rapport = join(tmpdir(), `agent-studio-canari-${randomBytes(6).toString("hex")}.${profile.tests.report === "junit-xml" ? "xml" : "json"}`);
  try {
    const r = await deps.runner.run(profile.tests.command[0]!, substituer(profile.tests.command.slice(1), rapport, []), {
      cwd: deps.sandboxRoot,
      timeoutMs: deps.timeoutMs ?? 5 * 60_000,
      ...(deps.onOutput ? { onOutput: deps.onOutput } : {}),
    });
    const sortie = `${r.stdout}${r.stderr}`.slice(-20_000);
    const brut = r.timedOut ? null : await readFile(rapport, "utf8").catch(() => null);
    if (brut === null) return { rapportLu: false, results: [], exitCode: r.exitCode, sortie };
    try {
      return { rapportLu: true, results: lireTests(profile.tests.report, brut, deps.sandboxRoot), exitCode: r.exitCode, sortie };
    } catch {
      // Un rapport présent mais illisible vaut un rapport absent : rien n'en est tiré.
      return { rapportLu: false, results: [], exitCode: r.exitCode, sortie };
    }
  } finally {
    await rm(rapport, { force: true });
  }
}
