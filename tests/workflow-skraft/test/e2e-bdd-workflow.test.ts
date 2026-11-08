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
import { answerQuestions, assemble, createProject, fakeStack, git, implPlanDe, put, shutdownHosts, simulatedAgents, testPlanDe, unitTestWriter, until } from "./support/harness.js";
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

  // Run du 08/11 : le dossier `features` contient déjà les scénarios d'une story précédente.
  const US1 = (titre: string) => `# language: fr\nFonctionnalité: chiffrage\n\n  @ac-1\n  Scénario: ${titre}\n    Alors la somme est de 13.50 euros\n`;
  const avecUs1 = async (titre: string) => {
    await put(root, `${FEATURES}/aaa-us1.feature`, US1(titre));
    git(root, "add", "-A");
    git(root, "commit", "-qm", "us-1");
  };
  /** Agent d'acceptance qui, comme au run du 08/11, renomme aussi les scénarios de l'US-1. */
  const renommeUs1: ScriptedBehavior = async (t) => {
    await acceptanceBdd(root, { titres: true })(t);
    await put(root, `${FEATURES}/aaa-us1.feature`, US1("AC-1 Le client chiffre une ligne"));
  };

  it("story précédente en BDD : ses titres ne sont pas jugés, la story est livrée, son .feature reste intact", async () => {
    await avecUs1("Le client chiffre une ligne");
    const app = await assemble(root, simulatedAgents(new ScriptedRuntime(), root, { "skraft-acceptance": acceptanceBdd(root, { titres: true }) }), tasksDir, { stack: pileBdd() });
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await fin(app, id, 120_000);
    expect(((await app.trace.list(id)).filter((e) => e.kind === "rejet") as { porte: string }[]).map((r) => r.porte)).not.toContain("gherkin");
    expect(git(root, "show", `HEAD:${FEATURES}/aaa-us1.feature`)).toBe(US1("Le client chiffre une ligne").trimEnd());
  }, 180_000);

  it("un scénario d'une story précédente modifié : DISTILL refusée, le motif le nomme", async () => {
    await avecUs1("Le client chiffre une ligne");
    const app = await assemble(root, simulatedAgents(new ScriptedRuntime(), root, { "skraft-acceptance": renommeUs1 }), tasksDir, { stack: pileBdd() });
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await until(async () => ((await app.trace.list(id)).filter((e) => e.kind === "rejet") as { porte: string }[]).some((r) => r.porte === "gherkin"), 90_000);
    const rejet = ((await app.trace.list(id)).filter((e) => e.kind === "rejet") as { porte: string; motifs: string[] }[]).find((r) => r.porte === "gherkin")!;
    expect(rejet.motifs).toContain(
      `${FEATURES}/aaa-us1.feature : le scénario « Le client chiffre une ligne » existait avant DISTILL et a été modifié ou supprimé. Il appartient à une story précédente : n'y touche pas ; si cette story change ce comportement, pose la question.`,
    );
  }, 180_000);

  it("DELIVER reçoit le scénario de la story, pas celui d'une story précédente au même critère", async () => {
    await avecUs1("AC-1 Ancien critère de l'US-1");
    const prompts: string[] = [];
    const testeur: ScriptedBehavior = async (t) => {
      prompts.push(t.prompt);
      await unitTestWriter(root)(t);
    };
    const app = await assemble(root, simulatedAgents(new ScriptedRuntime(), root, { "skraft-acceptance": acceptanceBdd(root, { titres: true }), "skraft-test": testeur }), tasksDir, { stack: pileBdd() });
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await fin(app, id, 120_000);
    const ac1 = prompts.find((p) => /Scénario en cours : ac-1\b/.test(p))!;
    expect(ac1).toContain("Scénario: AC-1 critère 1");
    expect(ac1).not.toContain("Ancien critère de l'US-1");
  }, 180_000);

  it("tests d'une story précédente : ni pris pour des critères de la story, ni comptés comme scénarios par DELIVER", async () => {
    await put(root, "tests/acceptance/us1.acceptance.test.ts", `import { it } from "vitest";\n\nit("ac-1", () => {});\n`);
    git(root, "add", "-A");
    git(root, "commit", "-qm", "us-1");
    // L'US-1 est livrée : son test passe toujours.
    const base = pileBdd();
    const pile: StackAdapter = {
      ...base,
      runTests: async (o) => {
        const r = await base.runTests(o);
        const results = r.results.map((x) => (x.file.endsWith("us1.acceptance.test.ts") ? { id: x.id, file: x.file, status: "passed" as const } : x));
        return { ...r, results, exitCode: results.some((x) => x.status === "failed") ? 1 : 0 };
      },
    };
    const app = await assemble(root, simulatedAgents(new ScriptedRuntime(), root, { "skraft-acceptance": acceptanceBdd(root, { titres: true }) }), tasksDir, { stack: pile });
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    const bilan = await fin(app, id, 120_000);
    expect(((await app.trace.list(id)).filter((e) => e.kind === "rejet") as { porte: string }[]).map((r) => r.porte)).not.toContain("RED d'acceptance");
    expect(bilan.livraison!.scenarios.map((s) => s[0]).sort()).toEqual(["ac-1", "ac-2", "ac-3"]);
  }, 180_000);

  // Décision du 08/11 : une pile muette sur le BDD, dans un projet qui en montre les signes, ne démarre pas.
  const avecSignesBdd = async () => {
    await put(root, "features/panier.feature", "Fonctionnalité: panier\n");
    await put(root, "package.json", '{ "name": "demo", "type": "module", "devDependencies": { "@cucumber/cucumber": "10" } }\n');
    git(root, "add", "-A");
    git(root, "commit", "-qm", "signes de BDD");
  };
  const MOTIF = "Le projet : sa pile ne dit rien du BDD, mais il en montre les signes (lanceur cucumber-js cité par `package.json` ; des `.feature` dans `features`).";

  it("BDD non déclaré mais signes présents : bloqué avant tout appel d'agent, le motif dit quoi déclarer", async () => {
    await avecSignesBdd();
    const runtime = simulatedAgents(new ScriptedRuntime(), root);
    const app = await assemble(root, runtime, tasksDir, { stack: { ...fakeStack(), bddNonDecide: ["."] } });
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => app.posted.some((p) => p.includes("bloqué avant tout appel")));
    expect(runtime.history).toEqual([]);
    expect(app.posted.join("\n")).toContain(MOTIF);
  }, 60_000);

  it("`bdd: false` déclaré (aucune racine non décidée) : le même projet démarre", async () => {
    await avecSignesBdd();
    const runtime = simulatedAgents(new ScriptedRuntime(), root);
    const app = await assemble(root, runtime, tasksDir, { stack: { ...fakeStack(), bddNonDecide: [] } });
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    expect(app.posted.join("\n")).not.toContain("ne dit rien du BDD");
  }, 60_000);
});
