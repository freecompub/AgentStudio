import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { z } from "zod";
import type { FailureKind, TestResult } from "../protocols.js";

/** Sous-ensemble du rapport JSON de Vitest (format compatible Jest) dont on a besoin. */
const reportSchema = z.object({
  testResults: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      message: z.string().optional().default(""),
      assertionResults: z.array(
        z.object({
          fullName: z.string(),
          status: z.string(),
          failureMessages: z.array(z.string()).optional().default([]),
        }),
      ),
    }),
  ),
});

/**
 * Motifs communs aux familles de lanceurs de tests. Ils servent aussi aux profils de stack
 * (lecteur `junit-xml`), où l'outil n'est pas connu d'avance : un motif propre à Vitest y
 * classerait tout échec en « mauvaise raison », et la porte RED refuserait des rouges légitimes.
 */
const MISSING_SYMBOL =
  /is not defined|is not a function|is not a constructor|Cannot find module|Failed to load url|Failed to resolve import|does not provide an export named|has no exported member|cannot find .+ in scope|use of unresolved identifier|NameError|ModuleNotFoundError|undefined reference/i;
const ASSERTION =
  /AssertionError|XCTAssert\w*|expect\(.*\)\.|^\s*Expected:|expected .+ to |assertion failed|assert\w*\(|Assert\.\w+/im;
// Codes de couleur ANSI éventuellement présents dans les messages.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * Raison d'un échec. Seuls « assertion » et « symbole manquant » sont de bonnes raisons
 * d'être rouge (§8.3) ; tout le reste (syntaxe, crash de setup) est une mauvaise raison.
 */
export function classifyFailure(message: string): FailureKind {
  const m = message.replace(ANSI, "");
  if (MISSING_SYMBOL.test(m)) return "missing_symbol";
  if (ASSERTION.test(m)) return "assertion";
  return "other_error";
}

function toStatus(s: string): TestResult["status"] {
  if (s === "passed") return "passed";
  if (s === "failed") return "failed";
  return "skipped"; // skipped, pending, todo, disabled
}

export function parseVitestReport(raw: unknown, root: string): TestResult[] {
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Rapport de tests illisible (format Vitest JSON attendu)");
  // Vitest rapporte des chemins réels : une racine passant par un lien symbolique (macOS,
  // où /var pointe vers /private/var) donnerait des identifiants « ../../../private/var/… ».
  let racine = root;
  try {
    racine = realpathSync(root);
  } catch {
    /* racine inexistante : on garde le chemin fourni */
  }
  const results: TestResult[] = [];
  for (const file of parsed.data.testResults) {
    const rel = (isAbsolute(file.name) ? relative(racine, file.name) : file.name).replaceAll("\\", "/");
    if (file.assertionResults.length === 0) {
      // La suite n'a pas pu être chargée (module introuvable, erreur de syntaxe…).
      if (file.status === "failed")
        results.push({ id: rel, file: rel, status: "failed", failureKind: classifyFailure(file.message), message: clip(file.message) });
      continue;
    }
    for (const a of file.assertionResults) {
      const status = toStatus(a.status);
      const r: TestResult = { id: `${rel} > ${a.fullName}`, file: rel, status };
      if (status === "failed") {
        const msg = a.failureMessages.join("\n");
        r.failureKind = classifyFailure(msg);
        r.message = clip(msg);
      }
      results.push(r);
    }
  }
  return results;
}

function clip(s: string): string {
  const clean = s.replace(ANSI, "");
  return clean.length > 2000 ? `${clean.slice(0, 2000)}…` : clean;
}
