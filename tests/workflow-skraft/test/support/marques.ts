/** Pile « par marques » : chaque scénario et chaque test unitaire demandent leur propre code. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StackAdapter } from "@agent-studio/stack-adapters";
import { fakeStack, put } from "./harness.js";

export const UNIT = "tests/unit/bolus-cap.test.ts";
export const CODE = "src/domain/bolus-cap.ts";

/**
 * Pile où un test ne passe que si le code porte sa marque (`// ac-1`, `// plafond 1`) : chaque
 * scénario demande son propre cycle, et un nouveau test unitaire est rouge.
 */
export function pileParMarques(root: string): StackAdapter {
  return {
    ...fakeStack(),
    runTests: async () => {
      const lire = (p: string) => readFile(join(root, p), "utf8").catch(() => "");
      const code = await lire(CODE);
      const results: { id: string; file: string; status: "passed" | "failed"; failureKind?: "assertion"; message?: string }[] = [];
      const ajouter = (file: string, nom: string) =>
        results.push(code.includes(`// ${nom}\n`) ? { id: `${file} > ${nom}`, file, status: "passed" } : { id: `${file} > ${nom}`, file, status: "failed", failureKind: "assertion", message: "AssertionError" });
      const acc = "tests/acceptance/story.acceptance.test.ts";
      for (const m of (await lire(acc)).matchAll(/^it\("(ac-\d+)"/gm)) ajouter(acc, m[1]!);
      for (const m of (await lire(UNIT)).matchAll(/^it\("([^"]+)"/gm)) ajouter(UNIT, m[1]!);
      return { results, exitCode: results.some((r) => r.status === "failed") ? 1 : 0, timedOut: false, output: "", durationMs: 1 };
    },
  };
}

/** Développeur qui marque le scénario en cours et chaque test unitaire écrit. */
export const developpeur = (root: string) => async (t: { prompt: string; callTool: (n: string, a: unknown) => Promise<unknown> }) => {
  const scenario = /Scénario en cours : (ac-\d+)/.exec(t.prompt)?.[1];
  const tests = [...(await readFile(join(root, UNIT), "utf8").catch(() => "")).matchAll(/^it\("([^"]+)"/gm)].map((m) => m[1]!);
  const avant = await readFile(join(root, CODE), "utf8").catch(() => "export class BolusCap { max = 10; }\n");
  const marques = [...(scenario ? [scenario] : []), ...tests].filter((m) => !avant.includes(`// ${m}\n`));
  await put(root, CODE, avant + marques.map((m) => `// ${m}\n`).join(""));
  await t.callTool("report_phase", { summary: "code", files: [CODE] });
};

