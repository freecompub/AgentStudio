// Repris de extensions/skraft-workflow/test/e2e-s4-workflow.test.ts (2026-10-10) : teste le workflow en dossier (ADR 0055).
/**
 * Jumeau de `extensions/skraft/test/e2e-s4.test.ts` pour `/skraft-workflow` (DISTILL) : fixtures
 * valeurs et RED d'acceptance traitées, empreinte des tests d'acceptance enregistrée. Vrai Vitest
 * sur un projet TypeScript. On lit la valeur rendue par le workflow au lieu de l'état du réducteur.
 */
import { execFileSync } from "node:child_process";
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { createTypeScriptAdapter } from "@agent-studio/stack-adapters";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, put, shutdownHosts, simulatedAgents, until, US12 } from "./support/harness.js";

const NODE_MODULES = resolve(import.meta.dirname, "../../../node_modules");

async function createTsProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-studio-skraft-ts-"));
  await symlink(NODE_MODULES, join(root, "node_modules"));
  await put(root, ".gitignore", "node_modules\n");
  await put(root, "package.json", '{"name":"bolus","type":"module","devDependencies":{"vitest":"*"}}\n');
  await put(root, "src/bolus.ts", "export const proposeDose = (calcul: number): number => calcul;\n");
  await put(root, "tests/bolus.test.ts", 'import { it, expect } from "vitest";\nimport { proposeDose } from "../src/bolus";\nit("comportement existant", () => expect(proposeDose(7)).toBe(7));\n');
  await put(root, "stories/us-12.md", US12);
  for (const args of [["init", "-q", "-b", "main"], ["add", "-A"], ["-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qm", "init"]])
    execFileSync("git", args, { cwd: root });
  return root;
}

const FEATURE = (v2: string) => `Fonctionnalité: Plafonner le bolus proposé

  @ac-1
  Scénario: dose sous le plafond
    Soit un plafond de 10 U et un calcul à 6 U
    Alors la dose proposée est 6 U sans alerte

  @ac-2
  Scénario: dose au-dessus du plafond
    Soit un plafond de 10 U et un calcul à ${v2}
    Alors la dose proposée est 10 U avec l'alerte « Dose plafonnée à 10 U »

  @ac-3
  Scénario: aucun plafond
    Alors la dose proposée égale le calcul
`;

const ACCEPTANCE = `import { it, expect } from "vitest";
import * as bolus from "../../src/bolus";
const cap = (bolus as Record<string, any>).capBolus;
it("ac-1 dose sous le plafond (10 U, 6 U)", () => expect(cap(6, 10)).toEqual({ dose: 6, alert: null }));
it("ac-2 dose plafonnée (12,5 U)", () => expect(cap(12.5, 10)).toEqual({ dose: 10, alert: "Dose plafonnée à 10 U" }));
it("ac-3 aucun plafond", () => expect(bolus.proposeDose(7)).toBe(7));
`;

describe("skraft en workflow — critères de S4 (DISTILL)", () => {
  let root: string;
  let tasksDir: string;
  beforeEach(async () => {
    root = await createTsProject();
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-skraft-tasks-"));
  });
  afterEach(async () => {
    await shutdownHosts();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(tasksDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("portes puis refus de revue : ajout d'un test en DISTILL, gel final accepté à l'entrée de DELIVER", async () => {
    const prompts: string[] = [];
    let deliverPrompt = "";
    let revuesDistill = 0;
    const acceptance: ScriptedBehavior = async (t) => {
      prompts.push(t.prompt);
      const attempt = prompts.length;
      await put(root, ".skraft/us-12/distill/features/plafond.feature", FEATURE(attempt === 1 ? "12 U" : "12,5 U"));
      await put(root, ".skraft/us-12/distill/impl-plan.md", "1. ac-1\n2. ac-2\n3. ac-3\n");
      await put(
        root,
        ".skraft/us-12/distill/test-plan.md",
        `# Plan\n- @ac-1 : walking skeleton — le cas nominal traverse le cas d'usage.\n${attempt >= 3 ? "- @ac-3 : role: regression — justification : le comportement « aucun plafond » existe déjà.\n" : ""}`,
      );
      await put(root, "tests/acceptance/plafond.test.ts", ACCEPTANCE);
      if (attempt === 4)
        await put(root, "tests/acceptance/complement.test.ts", `import { it, expect } from "vitest";\nit("ac-2 complément", () => expect(0).toBe(1));\n`);
      await t.callTool("report_phase", { summary: "scénarios", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-architect-model": async (t) => {
        await put(root, ".skraft/us-12/design/event-model.md", "`BolusCapped`\n");
        await t.callTool("report_phase", { summary: "m", files: [] });
      },
      "skraft-acceptance": acceptance,
      "skraft-lens-test-integrity": async (t) => {
        if (!t.prompt.includes("phase DISTILL"))
          return void await t.callTool("submit_lens_verdict", { lens: "test-integrity", verdict: "APPROVED", defects: [] });
        revuesDistill++;
        await t.callTool("submit_lens_verdict", {
          lens: "test-integrity", verdict: revuesDistill === 1 ? "CHANGES_REQUESTED" : "APPROVED",
          defects: revuesDistill === 1 ? [{ severity: "major", target: "test", description: "Ajouter le cas complémentaire.", file: "tests/acceptance/plafond.test.ts" }] : [],
        });
      },
      // Arrêt au premier pas de DELIVER : le test d'origine s'arrête à la fin de DISTILL.
      "skraft-test": async (t) => {
        deliverPrompt = t.prompt;
        t.hang();
      },
    });
    const app = await assemble(root, runtime, tasksDir, { stack: createTypeScriptAdapter() });
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const difficulty = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(difficulty.id, difficulty.options.find((o) => o.id.endsWith(":medium"))!.id);
    const id = (await app.engine.list())[0]!.id;

    // DELIVER commence : son premier agent reçoit le gel et la non-régression dans son dossier.
    await until(async () => deliverPrompt !== "", 120_000);
    expect(prompts).toHaveLength(4);
    expect(prompts[3]).not.toContain("Les tests d'acceptance sont gelés");
    // 1. porte valeurs : « 12 U » au lieu de « 12,5 U »
    expect(prompts[1]).toContain("La valeur « 12,5 U » du critère 2 n'apparaît pas dans le scénario @ac-2 (.skraft/us-12/distill/features/plafond.feature).");
    // 2. porte RED : ac-3 déjà vert sans justification
    expect(prompts[2]).toContain("« tests/acceptance/plafond.test.ts > ac-3 aucun plafond » (critère 3) passe déjà");
    expect(prompts[0]).toContain("Tests d'acceptance à écrire dans : tests/acceptance/**");

    expect(deliverPrompt).toContain("Tests d'acceptance requalifiés en non-régression :\n  - tests/acceptance/plafond.test.ts > ac-3 aucun plafond");
    expect(deliverPrompt).toContain("Les tests d'acceptance sont gelés : ne les modifie jamais.");
    expect(git(root, "log", "--format=%s", "-1")).toBe("docs(skraft): distill de us-12");
    const evidence = await import("@agent-studio/core").then(({ createJsonEvidenceStore }) => createJsonEvidenceStore(join(tasksDir, "evidence")).list(id));
    const redRuns = evidence.filter((e) => e.phase === "DISTILL_RED");
    expect(redRuns.at(-1)?.failing.map((f) => [f.id, f.failureKind])).toEqual([
      ["tests/acceptance/complement.test.ts > ac-2 complément", "assertion"],
      ["tests/acceptance/plafond.test.ts > ac-1 dose sous le plafond (10 U, 6 U)", "missing_symbol"],
      ["tests/acceptance/plafond.test.ts > ac-2 dose plafonnée (12,5 U)", "missing_symbol"],
    ]);
  }, 180_000);
});
