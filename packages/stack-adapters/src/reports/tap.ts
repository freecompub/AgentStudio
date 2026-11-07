import { isAbsolute } from "node:path";
import { parse as parseYaml } from "yaml";
import { relatifDepuis } from "../chemin-relatif.js";
import type { TestResult } from "../protocols.js";
import { classifyFailure } from "../typescript/vitest-report.js";

/**
 * Lecteur TAP, versions 13 et 14 (ADR 0072, point 3) : `node --test`, `prove`, `bats` et la plupart
 * des lanceurs qui ne savent pas écrire de JUnit.
 *
 * - `ok` réussi, `not ok` en échec ; `# SKIP` et `# TODO` ignorés : un échec attendu n'est pas un
 *   rouge, et les portes refusent les tests ignorés comme pour les autres formats ;
 * - sous-tests indentés (quatre espaces par niveau) : les blocs qui ont des enfants (`describe`)
 *   ne sont pas des tests, et leurs titres préfixent l'identifiant (`parent > test`) ;
 * - bloc YAML de diagnostic (`---` … `...`) : `message` ou `error`, et le fichier par `location`.
 *   `node --test` ne donne `location` qu'aux échecs : un test sans fichier prend celui du bloc
 *   parent qui le donne, sinon il reste vide ;
 * - `Bail out!` : un échec pour la suite.
 */
const LIGNES_MAX = 200_000;
const RESULTAT = /^(not ok|ok)\b(?:\s+\d+)?(?:\s+-)?\s*(.*)$/;

export function parseTap(texte: string, root: string): TestResult[] {
  const lignes = texte.split(/\r?\n/, LIGNES_MAX);
  const out: (TestResult & { niveau: number })[] = [];
  /** Titres des sous-tests ouverts, par niveau (`# Subtest: …`). */
  const titres: string[] = [];
  /** Résultats vus à chaque niveau dans le bloc courant, et l'indice du premier. */
  const vus: number[] = [];
  const debut: number[] = [];

  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i]!;
    const contenu = ligne.trimStart();
    const niveau = Math.floor((ligne.length - contenu.length) / 4);

    const sousTest = /^# Subtest: (.*)$/.exec(contenu);
    if (sousTest) {
      titres[niveau] = sousTest[1]!.trim();
      titres.length = niveau + 1;
      continue;
    }
    if (contenu.startsWith("Bail out!")) {
      out.push({ niveau, id: "Bail out!", file: "", status: "failed", failureKind: "other_error", message: contenu.slice("Bail out!".length).trim() });
      continue;
    }
    const r = RESULTAT.exec(contenu);
    if (!r) continue;

    // Bloc de diagnostic éventuel, juste sous le résultat.
    const { diag, fin } = lireDiagnostic(lignes, i + 1);
    i = fin;

    const [, etat, reste] = r;
    const m = /^(.*?)(?:\s+#\s*(.*))?$/.exec(reste!)!;
    const titre = m[1]!.trim();
    const directive = m[2] ?? "";
    const fichier = fichierDe(diag, root);

    // Un bloc qui a des enfants n'est pas un test : il ne fait que transmettre son fichier.
    const parent = (vus[niveau + 1] ?? 0) > 0;
    if (parent) {
      for (let k = debut[niveau + 1]!; k < out.length; k++) if (!out[k]!.file && fichier) out[k]!.file = fichier;
      vus[niveau + 1] = 0;
    }
    if ((vus[niveau] ?? 0) === 0) debut[niveau] = out.length;
    vus[niveau] = (vus[niveau] ?? 0) + 1;
    if (parent) continue;

    const id = [...titres.slice(0, niveau), titre].join(" > ");
    if (/^(skip|todo)\b/i.test(directive)) {
      out.push({ niveau, id, file: fichier, status: "skipped" });
      continue;
    }
    if (etat === "ok") {
      out.push({ niveau, id, file: fichier, status: "passed" });
      continue;
    }
    const message = texteDe(diag, "message") ?? texteDe(diag, "error");
    const nom = texteDe(diag, "name");
    out.push({
      niveau,
      id,
      file: fichier,
      status: "failed",
      failureKind: classifyFailure(nom && message ? `${nom}: ${message}` : (message ?? "")),
      ...(message !== undefined ? { message } : {}),
    });
  }
  return out.map(({ niveau: _, ...r }) => r);
}

/** Lignes `---` … `...` qui suivent un résultat ; illisible, le bloc est ignoré. */
function lireDiagnostic(lignes: string[], depuis: number): { diag: Record<string, unknown> | null; fin: number } {
  if (lignes[depuis]?.trim() !== "---") return { diag: null, fin: depuis - 1 };
  const marge = lignes[depuis]!.length - lignes[depuis]!.trimStart().length;
  const corps: string[] = [];
  let k = depuis + 1;
  for (; k < lignes.length && lignes[k]!.trim() !== "..."; k++) corps.push(lignes[k]!.slice(marge));
  try {
    const v: unknown = parseYaml(corps.join("\n"));
    return { diag: v && typeof v === "object" ? (v as Record<string, unknown>) : null, fin: k };
  } catch {
    return { diag: null, fin: k };
  }
}

const texteDe = (diag: Record<string, unknown> | null, cle: string): string | undefined => {
  const v = diag?.[cle];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

/** `location: '/racine/tests/a.test.mjs:5:3'` (ou `file`) → `tests/a.test.mjs`. */
function fichierDe(diag: Record<string, unknown> | null, root: string): string {
  const brut = texteDe(diag, "location") ?? texteDe(diag, "file");
  if (!brut) return "";
  const chemin = brut.replace(/^file:\/\//, "").replace(/(?::\d+){1,2}$/, "");
  return isAbsolute(chemin) ? relatifDepuis(root, chemin) : chemin;
}
