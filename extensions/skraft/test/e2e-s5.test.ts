/**
 * DELIVER sur la pile simulée : porte de fin de scénario et mutation par scénario. Le bout en bout
 * sur une vraie chaîne Swift a été retiré avec Swift (ADR 0061).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { type StackAdapter } from "@agent-studio/stack-adapters";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, fakeStack, git, put, shutdownHosts, simulatedAgents, stateOf, unitTestWriter, until } from "./support/harness.js";

describe("skraft — porte de fin de scénario (pile simulée)", () => {
  let root: string;
  let tasksDir: string;
  beforeEach(async () => {
    root = await createProject();
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-skraft-tasks-"));
  });
  afterEach(async () => {
    await shutdownHosts();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(tasksDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("mutation sous le seuil du domaine : scénario refusé avec les survivants, repris en sessions séparées, puis livré", async () => {
    // Mutation par scénario, demandée par la barre du projet (ADR 0049) ; par défaut elle tourne en fin de DELIVER.
    await put(root, ".agent-studio/projet.yaml", "qualite:\n  mutation:\n    moment: scenario\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "barre de qualité : mutation par scénario");
    const roles: string[] = [];
    const testPrompts: string[] = [];
    const writeTest = unitTestWriter(root);
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-test": async (t) => {
        testPrompts.push(t.prompt);
        await writeTest(t);
      },
    });
    let mutation = 0;
    const stack: StackAdapter = {
      ...fakeStack(),
      mutation: async () => {
        mutation++;
        const survived = mutation === 1 ? [{ line: 1, operator: "RemoveSideEffects" }] : [];
        return { score: mutation === 1 ? 50 : 100, files: [{ file: "src/domain/bolus-cap.ts", score: mutation === 1 ? 50 : 100, survived }] };
      },
      architecture: async () => ({ modules: [{ name: "Domain", imports: [] }], violations: [] }),
    };
    const app = await assemble(root, runtime, tasksDir, { stack });
    answerQuestions(app);
    await app.registry.command("skraft")!.handler("--auto stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => ["DONE", "ESCALATED", "ABORTED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 60_000);
    for (const h of runtime.history) roles.push(runtime.configs.get(h.id)!.role.split("/")[1]!);

    const s = stateOf(await app.engine.status(id))!;
    expect(s.stage).toBe("DONE");
    expect(testPrompts).toHaveLength(2);
    expect(testPrompts[1]).toContain("Mutation : src/domain/bolus-cap.ts à 50 % (minimum 100 %) ; mutants survivants : ligne 1 (RemoveSideEffects).");
    expect(s.deliver?.granularity).toBe("session-per-step");
    expect(s.deliver?.notes).toEqual([
      "Scénario ac-1 : repris en sessions séparées après un échec.",
      "Couverture non mesurée : la commande de test du projet n'en produit pas.",
      "Qualité de forme non mesurée : le projet n'a pas de linter configuré pour cette stack.",
      "Format non mesuré : la pile du projet ne déclare pas de commande `format`.",
      "Scénario ac-2 : déjà vert avant son premier pas ; le code d'un pas précédent l'a fait passer sans test rouge qui le demande.",
      "Scénario ac-3 : déjà vert avant son premier pas ; le code d'un pas précédent l'a fait passer sans test rouge qui le demande.",
    ]);
    // Après la reprise : sessions séparées pour le vert puis le nettoyage.
    const deliverRoles = roles.filter((r) => r === "skraft-test" || r === "skraft-dev");
    expect(deliverRoles).toEqual(["skraft-test", "skraft-dev", "skraft-test", "skraft-dev", "skraft-dev"]);
    expect(mutation).toBe(2);
  }, 90_000);

  // Décision du 08/11 : la mutation est jugée sur les lignes modifiées par la story, comme la couverture.
  it("mutation sur les seules lignes modifiées : un survivant ancien d'un fichier touché ne bloque pas, il est noté", async () => {
    const dev = async (t: Parameters<Parameters<ScriptedRuntime["behave"]>[1]>[0]) => {
      await put(root, "src/domain/bolus-cap.ts", "export class BolusCap {}\n");
      // La story ajoute la ligne 2 à un fichier existant ; la ligne 1 est d'avant.
      await put(root, "src/domain/bolus-calculator.ts", "export class BolusCalculator {}\nexport const PLAFOND = 1;\n");
      await t.callTool("report_phase", { summary: "plafond", files: ["src/domain/bolus-cap.ts", "src/domain/bolus-calculator.ts"] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-dev": dev });
    const stack: StackAdapter = {
      ...fakeStack(),
      mutation: async () => ({
        score: 50,
        files: [{ file: "src/domain/bolus-calculator.ts", score: 50, killed: 1, total: 2, killedLines: [2], survived: [{ line: 1, operator: "RemoveSideEffects" }] }],
      }),
      architecture: async () => ({ modules: [{ name: "Domain", imports: [] }], violations: [] }),
    };
    const app = await assemble(root, runtime, tasksDir, { stack });
    answerQuestions(app);
    await app.registry.command("skraft")!.handler("--auto stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => ["DONE", "ESCALATED", "ABORTED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 60_000);
    const s = stateOf(await app.engine.status(id))!;
    expect(s.stage).toBe("DONE");
    expect(s.deliver?.notes).toContain(
      "Mutation hors du changement : src/domain/bolus-calculator.ts, 1 mutant(s) survivant(s) sur des lignes que la story ne modifie pas (ligne 1 (RemoveSideEffects)) ; non jugés.",
    );
  }, 90_000);
});
