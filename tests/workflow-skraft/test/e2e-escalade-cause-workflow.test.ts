/**
 * Escalade d'un scénario selon sa cause (ADR 0066, révisé le 07/11), jumeau du test de l'extension.
 * Le code sait pourquoi le scénario échoue, et propose ce qui peut réussir :
 * - un test qui passait avant DELIVER et que la story fait échouer : l'humain le déclare obsolète ;
 *   il sort des portes, le cycle se termine, et le bilan rappelle de le mettre à jour (comme les
 *   défauts hors du changement) ;
 * - des lignes du scénario non couvertes : l'humain les exempte (dérogation, ADR 0065).
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import type { StackAdapter } from "@agent-studio/stack-adapters";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, fakeStack, git, put, shutdownHosts, simulatedAgents, until } from "./support/harness.js";
import { fin, lancerWorkflow } from "./support/fin.js";

const CODE = "src/domain/bolus-cap.ts";
const ANCIEN = "tests/legacy/bolus.test.ts > la dose proposée est celle du calcul";
type App = Awaited<ReturnType<typeof assemble>>;

/** Un test plus ancien que la story : vert tant que le plafond n'existe pas, rouge ensuite. */
function pileAvecTestAncien(): StackAdapter {
  const stack = fakeStack();
  const run = stack.runTests;
  stack.runTests = async (opts) => {
    const r = await run(opts);
    const plafond = await readFile(join(opts.root, CODE), "utf8").then(() => true, () => false);
    const ancien = plafond
      ? { id: ANCIEN, file: "tests/legacy/bolus.test.ts", status: "failed" as const, failureKind: "assertion" as const, message: "expected 10 to be 12.5" }
      : { id: ANCIEN, file: "tests/legacy/bolus.test.ts", status: "passed" as const };
    return { ...r, results: [...r.results, ancien], exitCode: plafond ? 1 : r.exitCode };
  };
  return stack;
}

/** La ligne 1 du code du scénario n'est jamais couverte (code défensif inatteignable). */
function pileLigneNonCouverte(): StackAdapter {
  const stack = fakeStack();
  const run = stack.runTests;
  stack.runTests = async (opts) => ({ ...(await run(opts)), coverage: { files: [{ file: CODE, covered: 0, total: 1, score: 0, lines: [{ number: 1, covered: false }] }] } });
  return stack;
}

async function escalade(app: App) {
  await until(async () => (await app.interactions.pending()).some((p) => p.title === "Pipeline skraft bloqué (DELIVER)"), 60_000);
  return (await app.interactions.pending()).find((p) => p.title === "Pipeline skraft bloqué (DELIVER)")!;
}

const choix = (q: { options: { id: string }[] }) => q.options.map((o) => o.id.split(":").at(-1));
const arbitrages = async (app: App, id: string) =>
  ((await app.trace.list(id)).filter((e) => e.kind === "arbitrage") as { porte: string; élément: string; décision: string; par: string; raison: string }[]).map((a) => [a.porte, a.élément, a.décision, a.par, a.raison]);

describe("skraft en workflow — escalade d'un scénario selon sa cause (ADR 0066)", () => {
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

  it("test existant obsolète : l'escalade le nomme et propose de le déclarer obsolète ; il sort des portes, le cycle se termine, le bilan rappelle de le mettre à jour", async () => {
    const app = await assemble(root, simulatedAgents(new ScriptedRuntime(), root), tasksDir, { stack: pileAvecTestAncien() });
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");

    const q = await escalade(app);
    expect(q.detail).toContain(`Tests qui passaient avant DELIVER et que la story fait échouer : ${ANCIEN}`);
    expect(choix(q)).toEqual(["obsolete", "relancer", "sauter", "abandonner"]);
    expect(q.options[0]!.label).toBe("Déclarer ces tests obsolètes et continuer");
    await app.interactions.respond(q.id, q.options[0]!.id, "la story plafonne la dose", { role: "architecte" });

    await fin(app, id, 90_000);
    expect(await arbitrages(app, id)).toContainEqual(["tests existants", ANCIEN, "obsolète", "humain", "la story plafonne la dose"]);
    const livraison = git(root, "log", "--format=%H %s").split("\n").find((l) => l.endsWith("feat(us-12): livraison de la story"))!.split(" ")[0]!;
    expect(git(root, "show", `${livraison}:.skraft/us-12/deliver/derogations.md`)).toContain(ANCIEN);
    const bilan = app.posted.at(-1)!;
    expect(bilan).toContain("À corriger après le cycle");
    expect(bilan).toContain(`- mettre à jour ${ANCIEN} : déclaré obsolète au scénario ac-1 (la story plafonne la dose).`);
  }, 120_000);

  it("lignes non couvertes du scénario : l'escalade propose d'exempter ces lignes ; dérogation tracée et commitée, le scénario repart et passe", async () => {
    await put(root, ".agent-studio/projet.yaml", "qualite:\n  couverture:\n    domaine: 100\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "barre de qualité");
    const app = await assemble(root, simulatedAgents(new ScriptedRuntime(), root), tasksDir, { stack: pileLigneNonCouverte() });
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");

    const q = await escalade(app);
    expect(q.detail).toContain(`Lignes du scénario non couvertes : ${CODE}:1`);
    expect(choix(q)).toEqual(["exempter", "relancer", "sauter", "abandonner"]);
    expect(q.options[0]!.label).toBe("Exempter ces lignes et continuer");
    await app.interactions.respond(q.id, q.options[0]!.id, "garde défensive", { role: "architecte" });

    await fin(app, id, 90_000);
    expect(await arbitrages(app, id)).toContainEqual(["couverture du diff", `${CODE}:1`, "dérogation", "humain", "garde défensive"]);
    const livraison = git(root, "log", "--format=%H %s").split("\n").find((l) => l.endsWith("feat(us-12): livraison de la story"))!.split(" ")[0]!;
    expect(git(root, "show", `${livraison}:.skraft/us-12/deliver/derogations.md`)).toContain(`${CODE}:1`);
  }, 120_000);
});
