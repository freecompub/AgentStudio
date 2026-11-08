/**
 * BDD (ADR 0074), jumeau du test de l'extension : le TDD toujours, le BDD au choix. Sur une pile en BDD,
 * le `.feature` de DISTILL va au projet (dossier `features` du couple), le titre de chaque scénario
 * commence par son critère, et le gel couvre le `.feature` et ses étapes ; DELIVER garde sa boucle TDD.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import type { StackAdapter } from "@agent-studio/stack-adapters";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, fakeStack, git, implPlanDe, put, shutdownHosts, simulatedAgents, testPlanDe, until } from "./support/harness.js";
import { fin, lancerWorkflow } from "./support/fin.js";

const FEATURES = "tests/features";
/** Pile simulée en BDD : le `.feature` dans `tests/features`, ses étapes (les tests lancés) dans `tests/acceptance`. */
function pileBdd(): StackAdapter {
  const s = fakeStack();
  return { ...s, layout: { ...s.layout, acceptanceTests: [...s.layout.acceptanceTests, `${FEATURES}/**`] }, bdd: [{ lanceur: "cucumber-js", features: FEATURES, etapes: "tests/acceptance" }] };
}

/** Agent d'acceptance qui suit la consigne BDD du dossier ; `titres: false`, il oublie le critère dans les titres. */
const acceptanceBdd = (root: string, o: { titres: boolean }): ScriptedBehavior => async (t) => {
  const slug = /Dossier de travail : \.skraft\/([^/]+)\//.exec(t.prompt)?.[1] ?? "x";
  const dossier = /Écris le `\.feature` dans (\S+)/.exec(t.prompt)?.[1];
  if (!dossier) throw new Error("consigne BDD absente du dossier de passation");
  const criteria = [...t.prompt.matchAll(/^\s+(\d+)\. (.+)$/gm)].map((m) => ({ n: m[1]!, text: m[2]! }));
  const feature = criteria.map((c) => `  @ac-${c.n}\n  Scénario: ${o.titres ? `AC-${c.n} ` : ""}critère ${c.n}\n    Alors ${c.text}\n`).join("\n");
  await put(root, `${dossier}/plafond.feature`, `# language: fr\nFonctionnalité: story\n\n${feature}`);
  await put(root, `.skraft/${slug}/distill/test-plan.md`, testPlanDe(criteria.map((c) => c.n)));
  await put(root, `.skraft/${slug}/distill/impl-plan.md`, implPlanDe(criteria.map((c) => c.n), "tests/acceptance/story.acceptance.test.ts"));
  const etapes = criteria.map((c) => `it("ac-${c.n}", () => expect.fail(${JSON.stringify(c.text)}));`).join("\n");
  await put(root, "tests/acceptance/story.acceptance.test.ts", `import { expect, it } from "vitest";\n\n${etapes}\n`);
  await t.callTool("report_phase", { summary: "scénarios et étapes", files: [`${dossier}/plafond.feature`, "tests/acceptance/story.acceptance.test.ts"] });
};

type App = Awaited<ReturnType<typeof assemble>>;

describe("skraft en workflow — BDD au choix (ADR 0074)", () => {
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

  it("pile en BDD : le .feature de DISTILL va au projet, titres AC-n ; la story est livrée et le .feature commité", async () => {
    const app = await assemble(root, simulatedAgents(new ScriptedRuntime(), root, { "skraft-acceptance": acceptanceBdd(root, { titres: true }) }), tasksDir, { stack: pileBdd() });
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await fin(app, id, 120_000);
    expect(git(root, "show", `HEAD:${FEATURES}/plafond.feature`)).toMatch(/Scénario: AC-1 critère 1/);
    expect(git(root, "ls-files", ".skraft/us-12/distill/features")).toBe("");
  }, 180_000);

  it("titres sans critère : DISTILL refusée par la porte gherkin, qui nomme le scénario", async () => {
    const app = await assemble(root, simulatedAgents(new ScriptedRuntime(), root, { "skraft-acceptance": acceptanceBdd(root, { titres: false }) }), tasksDir, { stack: pileBdd() });
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await until(async () => ((await app.trace.list(id)).filter((e) => e.kind === "rejet") as { porte: string }[]).some((r) => r.porte === "gherkin"), 90_000);
    const rejet = ((await app.trace.list(id)).filter((e) => e.kind === "rejet") as { porte: string; motifs: string[] }[]).find((r) => r.porte === "gherkin")!;
    expect(rejet.motifs[0]).toMatch(/tests\/features\/plafond\.feature : le titre du scénario « critère 1 » \(@ac-1\) doit commencer par « AC-1 »/);
  }, 180_000);
});
