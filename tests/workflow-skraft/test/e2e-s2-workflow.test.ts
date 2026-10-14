// Repris de extensions/skraft-workflow/test/e2e-s2-workflow.test.ts (2026-10-10) : teste le workflow en dossier (ADR 0055).
/**
 * Jumeau de `extensions/skraft/test/e2e-s2.test.ts` pour `/skraft-workflow` (ADR 0052, `docs/09`
 * §14 étape 4), dans une extension indépendante de skraft : même
 * scénario US-12, mêmes vérifications sur ce que voient les agents et les humains. Seuls changent
 * la commande, les identifiants d'options et ce qui suit RESEARCH (le workflow s'arrête avant
 * DESIGN et publie le dossier de passation que DESIGN recevrait).
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import type { EtatWorkflow } from "@agent-studio/workflow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptanceWriter, answerQuestions, assemble, createProject, fakeStack, git, put, researchDoc, shutdownHosts, simulatedAgents, unitTestWriter, until } from "./support/harness.js";
import { fin, lancerWorkflow } from "./support/fin.js";

describe("skraft en workflow — critères de S2 (RESEARCH), script isolé", () => {
  let root: string;
  let tasksDir: string;
  beforeEach(async () => {
    root = await createProject();
    await put(root, "src/domain/bolus-calculator.ts", Array.from({ length: 55 }, (_, i) => `// ligne ${i + 1}`).join("\n") + "\n");
    git(root, "commit", "-qam", "calculateur");
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-skraft-tasks-"));
  });
  afterEach(async () => {
    await shutdownHosts();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(tasksDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it.each(["failed", "skipped", "exit", "timeout"] as const)("précontrôle %s : bloque avant le classifieur, sans appel LLM", async (status) => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root);
    const stack = fakeStack();
    stack.runTests = async () => ({
      results: [{ id: "test existant", file: "tests/existing.test.ts", status: status === "failed" || status === "skipped" ? status : "passed" }],
      exitCode: status === "exit" ? 1 : 0, timedOut: status === "timeout", output: "", durationMs: 1,
    });
    const app = await assemble(root, runtime, tasksDir, { stack });
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => app.posted.some((p) => p.includes("bloqué avant tout appel")));
    expect(runtime.history).toEqual([]);
    expect((await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté"))).toBe(false);
  });

  it("la dette de couverture initiale est notifiée mais ne bloque pas le classifieur", async () => {
    await put(root, ".skraft/quality.json", '{"coverage":{"core":90}}\n');
    const runtime = simulatedAgents(new ScriptedRuntime(), root);
    const stack = fakeStack();
    stack.runTests = async () => ({
      results: [], exitCode: 0, timedOut: false, output: "", durationMs: 1,
      coverage: { files: [{ file: "src/domain/bolus-calculator.ts", covered: 1, total: 2, score: 50 }] },
    });
    const app = await assemble(root, runtime, tasksDir, { stack });
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    expect(app.posted.join("\n")).toContain("avertissement non bloquant");
    expect(app.posted.join("\n")).toContain("50 % (minimum 90 %)");
    expect(runtime.history).toHaveLength(1);
  });

  it.each([true, false])("couverture du diff en isolation : ligne modifiée couverte=%s, dette historique inchangée", async (covered) => {
    const before = "export class BolusCalculator {}\n\n\n\n\n\n\n// propriété existante non couverte\n";
    await put(root, "src/domain/bolus-calculator.ts", before);
    await put(root, ".skraft/quality.json", '{"coverage":{"core":90},"mutation":{"active":false}}\n');
    const stack = fakeStack();
    const original = stack.runTests;
    stack.runTests = async (opts) => ({
      ...await original(opts),
      coverage: { files: [
        { file: "src/domain/bolus-calculator.ts", covered: covered ? 1 : 0, total: 2, score: covered ? 50 : 0, lines: [{ number: 1, covered }, { number: 8, covered: false }] },
        { file: "src/domain/bolus-cap.ts", covered: 1, total: 1, score: 100, lines: [{ number: 1, covered: true }] },
      ] },
    });
    let deliverReview = "";
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-dev": async (t) => {
        await put(root, "src/domain/bolus-calculator.ts", before.replace("{}", "{ /* raccordement */ }"));
        await put(root, "src/domain/bolus-cap.ts", "export class BolusCap {}\n");
        await t.callTool("report_phase", { summary: "code", files: [] });
      },
      "skraft-lens-test-integrity": async (t) => {
        if (t.prompt.includes("phase DELIVER")) deliverReview = t.prompt;
        await t.callTool("submit_lens_verdict", { lens: "test-integrity", verdict: "APPROVED", defects: [] });
      },
    });
    const app = await assemble(root, runtime, tasksDir, { stack });
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const q = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith(":medium-hard"))!.id);
    if (covered) {
      await until(async () => app.posted.some((p) => p.includes("Pipeline skraft terminé")), 60_000);
      expect(deliverReview).toContain("Couverture du diff (tâche) : src/domain/bolus-calculator.ts à 100 %");
      expect(app.posted.join("\n")).toContain("avertissement non bloquant");
    } else {
      await until(async () => (await app.interactions.pending()).some((p) => p.detail?.includes("Lignes non couvertes : 1.")), 60_000);
      expect((await app.interactions.pending()).map((p) => p.detail).join("\n")).not.toContain("non couvertes : 8");
    }
  }, 90_000);

  // D5 (docs/12) : une source écrite en DISTILL n'est vue que par la porte de fin de DELIVER. Les
  // scénarios étant verts, rejouer la phase ne ferait travailler personne : le motif va au testeur.
  it("couverture du diff en fin de DELIVER sur une source de DISTILL : correction ciblée par le testeur, puis livré", async () => {
    await put(root, ".skraft/quality.json", '{"coverage":{"core":90},"mutation":{"active":false}}\n');
    const stack = fakeStack();
    const original = stack.runTests;
    // La ligne du squelette n'est couverte qu'une fois le second test unitaire écrit.
    stack.runTests = async (opts) => {
      const unit = await readFile(join(root, "tests/unit/bolus-cap.test.ts"), "utf8").catch(() => "");
      const covered = unit.includes("plafond 2");
      return {
        ...await original(opts),
        coverage: { files: [
          { file: "src/domain/bolus-stub.ts", covered: covered ? 1 : 0, total: 1, score: covered ? 100 : 0, lines: [{ number: 1, covered }] },
          { file: "src/domain/bolus-cap.ts", covered: 1, total: 1, score: 100, lines: [{ number: 1, covered: true }] },
        ] },
      };
    };
    const testPrompts: string[] = [];
    const writeTest = unitTestWriter(root);
    const accept = acceptanceWriter(root);
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-acceptance": async (t) => {
        await put(root, "src/domain/bolus-stub.ts", "export const plafond = (dose: number, max: number) => Math.min(dose, max);\n");
        await accept(t);
      },
      "skraft-test": async (t) => {
        testPrompts.push(t.prompt);
        await writeTest(t);
      },
    });
    const app = await assemble(root, runtime, tasksDir, { stack });
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const q = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith(":medium-hard"))!.id);
    await until(async () => app.posted.some((p) => p.includes("Pipeline skraft terminé")), 60_000);
    const correction = testPrompts.find((p) => p.includes("[couverture#"));
    expect(correction).toMatch(/\[couverture#\d+\.1, major, test\].*src\/domain\/bolus-stub\.ts, lignes non couvertes : 1\..*test qui exerce/s);
  }, 90_000);

  // D5 (docs/12) : revue de DELIVER sans défaut bloquant ni majeur, alors que tout est vert.
  it("revue de DELIVER à défauts mineurs seulement : le développeur les corrige, puis livré", async () => {
    let deliverReviews = 0;
    const devPrompts: string[] = [];
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-dev": async (t) => {
        devPrompts.push(t.prompt);
        // En correction, le développeur renomme : un pas de correction doit modifier le code.
        const corrige = t.prompt.includes("mineur1");
        await put(root, "src/domain/bolus-cap.ts", corrige ? "export class PlafondDeBolus {}\nexport { PlafondDeBolus as BolusCap };\n" : "export class BolusCap {}\n");
        await t.callTool("report_phase", { summary: "code", files: ["src/domain/bolus-cap.ts"] });
      },
      "skraft-lens-cold-reader": async (t) => {
        const premiere = t.prompt.includes("phase DELIVER") && deliverReviews++ === 0;
        await t.callTool("submit_lens_verdict", premiere
          ? { lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "minor", description: "nom vague : BolusCap", target: "code" }] }
          : { lens: "cold-reader", verdict: "APPROVED", defects: [] });
      },
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const q = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith(":medium-hard"))!.id);
    await until(async () => app.posted.some((p) => p.includes("Pipeline skraft terminé")), 60_000);
    expect(devPrompts.some((p) => p.includes("[cold-reader#1.mineur1, minor, code] nom vague : BolusCap"))).toBe(true);
  }, 90_000);

  // D7 (docs/12) : contester n'oblige pas à modifier le code ; la lentille arbitre.
  it("correction de DELIVER où le développeur conteste tout : pas refusé pour « aucun fichier modifié », la lentille arbitre", async () => {
    const lensPrompts: string[] = [];
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-dev": async (t) => {
        if (t.prompt.includes("[cold-reader#1.1")) {
          await t.callTool("report_phase", { summary: "contesté", files: [], responses: [{ defect: "cold-reader#1.1", status: "contested", reason: "Le contrat ratifié impose ce nom." }] });
          return;
        }
        await put(root, "src/domain/bolus-cap.ts", "export class BolusCap {}\n");
        await t.callTool("report_phase", { summary: "code", files: ["src/domain/bolus-cap.ts"] });
      },
      "skraft-lens-cold-reader": async (t) => {
        if (!t.prompt.includes("phase DELIVER")) return void (await t.callTool("submit_lens_verdict", { lens: "cold-reader", verdict: "APPROVED", defects: [] }));
        lensPrompts.push(t.prompt);
        await t.callTool("submit_lens_verdict", lensPrompts.length === 1
          ? { lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", description: "nom vague : BolusCap", target: "code" }] }
          : { lens: "cold-reader", verdict: "APPROVED", defects: [], rulings: [{ defect: "cold-reader#1.1", decision: "accepted", reason: "Le contrat fait foi." }] });
      },
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await fin(app, id, 60_000);
    expect(app.posted.some((p) => p.includes("Pipeline skraft terminé"))).toBe(true);
    expect(lensPrompts[1]).toContain("Le contrat ratifié impose ce nom.");
    const rejets = (await app.trace.list(id)).filter((e) => e.kind === "rejet") as { motifs: string[] }[];
    expect(rejets.flatMap((r) => r.motifs).some((m) => m.startsWith("Aucun fichier de production modifié"))).toBe(false);
  }, 90_000);

  // D9 (docs/12) : après une question bloquante, l'agent repart avec le motif du rejet qu'il corrigeait.
  describe("question bloquante après un rejet : le motif reste (D9)", () => {
    const repondreAuxBlocages = (app: Awaited<ReturnType<typeof assemble>>) => {
      const faites = new Set<string>();
      const tick = async () => {
        for (const p of await app.interactions.pending()) {
          if (!p.title.startsWith("Question de l'agent") || faites.has(p.id)) continue;
          faites.add(p.id);
          await app.interactions.respond(p.id, p.options[0]!.id, undefined, { role: "po" });
        }
      };
      app.interactions.onChange(() => void tick());
      void tick();
    };

    it("RESEARCH", async () => {
      const prompts: string[] = [];
      const runtime = simulatedAgents(new ScriptedRuntime(), root, {
        "skraft-researcher": async (t) => {
          prompts.push(t.prompt);
          if (prompts.length === 2) return void (await t.callTool("report_blocker", { question: "Par prise ?", choices: ["oui", "non"] }));
          const lignes = prompts.length === 1 ? "40-72" : "40-55";
          await put(root, ".skraft/us-12/research/research.md", researchDoc({ Découvertes: `Le calcul vit dans \`src/domain/bolus-calculator.ts:${lignes}\`.` }));
          await t.callTool("report_phase", { summary: "recherche écrite", files: [".skraft/us-12/research/research.md"] });
        },
      });
      const app = await assemble(root, runtime, tasksDir);
      answerQuestions(app);
      repondreAuxBlocages(app);
      const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
      await fin(app, id, 60_000);
      expect(prompts[2]).toContain("bolus-calculator.ts:40-72");
    }, 90_000);

    it("DISTILL", async () => {
      const prompts: string[] = [];
      const accept = acceptanceWriter(root);
      const runtime = simulatedAgents(new ScriptedRuntime(), root, {
        "skraft-acceptance": async (t) => {
          prompts.push(t.prompt);
          if (prompts.length === 2) return void (await t.callTool("report_blocker", { question: "Par prise ?", choices: ["oui", "non"] }));
          await accept(t);
          if (prompts.length === 1) await rm(join(root, ".skraft/us-12/distill/test-plan.md"));
        },
      });
      const app = await assemble(root, runtime, tasksDir);
      answerQuestions(app);
      repondreAuxBlocages(app);
      const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
      await fin(app, id, 60_000);
      expect(prompts[2]).toContain("Plan de test absent : .skraft/us-12/distill/test-plan.md");
    }, 90_000);

    it("DELIVER", async () => {
      const prompts: string[] = [];
      const runtime = simulatedAgents(new ScriptedRuntime(), root, {
        "skraft-dev": async (t) => {
          prompts.push(t.prompt);
          if (prompts.length === 2) return void (await t.callTool("report_blocker", { question: "Par prise ?", choices: ["oui", "non"] }));
          if (prompts.length > 1) await put(root, "src/domain/bolus-cap.ts", "export class BolusCap {}\n");
          await t.callTool("report_phase", { summary: "code", files: [] });
        },
      });
      const app = await assemble(root, runtime, tasksDir);
      answerQuestions(app);
      repondreAuxBlocages(app);
      const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
      await fin(app, id, 60_000);
      expect(prompts[2]).toContain("Aucun fichier de production modifié");
    }, 90_000);
  });

  it("revue de DELIVER « changements demandés » sans aucun défaut : escalade, personne à qui l'adresser", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-lens-cold-reader": async (t) => {
        await t.callTool("submit_lens_verdict", t.prompt.includes("phase DELIVER")
          ? { lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [] }
          : { lens: "cold-reader", verdict: "APPROVED", defects: [] });
      },
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const q = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith(":medium-hard"))!.id);
    await until(async () => (await app.interactions.pending()).some((p) => p.title.includes("Revue sans défaut à corriger")), 60_000);
  }, 90_000);

  // D15 (docs/12) : après « relancer », le premier agent de la phase reçoit le motif de l'escalade.
  it("relancer DELIVER : le premier pas reçoit le motif de l'escalade (D15)", async () => {
    let relance = false;
    const testPrompts: string[] = [];
    const ecrire = unitTestWriter(root);
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-test": async (t) => {
        testPrompts.push(t.prompt);
        await ecrire(t);
      },
      "skraft-lens-cold-reader": async (t) => {
        await t.callTool("submit_lens_verdict", t.prompt.includes("phase DELIVER") && !relance
          ? { lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [] }
          : { lens: "cold-reader", verdict: "APPROVED", defects: [] });
      },
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.includes("Revue sans défaut à corriger")), 60_000);
    relance = true;
    const avant = testPrompts.length;
    const q = (await app.interactions.pending()).find((p) => p.title.includes("Revue sans défaut à corriger"))!;
    await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith("relancer"))!.id, undefined, { role: "architecte" });
    await fin(app, id, 60_000);
    expect(testPrompts[avant]).toContain("Revue « changements demandés » sans défaut bloquant ni majeur à corriger");
  }, 90_000);

  // D11 (docs/12) : la trace doit se découper comme celle de l'extension pour que le banc compare.
  it("sans question ouverte, aucune étape ROUTE : comme l'extension, on passe directement à DESIGN", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root);
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-7.md");
    await fin(app, id, 60_000);
    // `w.etape` ne laisse rien dans la trace : on lit les étapes annoncées dans le journal du workflow.
    const etat = (await app.engine.status(id))!.state as EtatWorkflow;
    const etapes = etat.journal.filter((e) => e.appel === "etape").map((e) => ("clair" in e.args ? (e.args.clair as { nom: string }).nom : "?"));
    expect(etapes).toContain("DONE");
    expect(etapes).not.toContain("ROUTE");
  }, 90_000);

  it("plans de DISTILL incomplets : rejet sous « plan de test », avant toute exécution (option C de docs/15 §4.5)", async () => {
    let essais = 0;
    const accept = acceptanceWriter(root);
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-acceptance": async (t) => {
        await accept(t);
        if (essais++ === 0) {
          await put(root, ".skraft/us-12/distill/impl-plan.md", "1. ac-1\n");
          await put(root, ".skraft/us-12/distill/test-plan.md", "# Plan de test\n");
        }
      },
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await fin(app, id, 60_000);
    const rejets = (await app.trace.list(id)).filter((e) => e.kind === "rejet");
    expect(rejets).toContainEqual(expect.objectContaining({ porte: "plan de test", motifs: [
      "impl-plan.md ne cite pas le critère 2 (ac-2) : chaque critère y a sa place dans l'ordre de livraison.",
      "impl-plan.md ne cite pas le critère 3 (ac-3) : chaque critère y a sa place dans l'ordre de livraison.",
      "test-plan.md ne désigne aucun walking skeleton : marque au moins un scénario par une ligne « - @ac-<n> : walking skeleton — <raison> ».",
    ] }));
  }, 90_000);

  it("plan de test absent : rejet tracé sous sa propre porte, pas sous « valeurs » (D11)", async () => {
    let essais = 0;
    const accept = acceptanceWriter(root);
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-acceptance": async (t) => {
        await accept(t);
        if (essais++ === 0) await rm(join(root, ".skraft/us-12/distill/test-plan.md"));
      },
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await fin(app, id, 60_000);
    const rejets = (await app.trace.list(id)).filter((e) => e.kind === "rejet");
    expect(rejets).toContainEqual(expect.objectContaining({ porte: "plan de test", motifs: ["Plan de test absent : .skraft/us-12/distill/test-plan.md"] }));
  }, 90_000);

  it("verdict REJECTED : rejet tracé sous la porte « revue », avec les lentilles qui rejettent (D11)", async () => {
    const rejette = (lens: string) => async (t: { prompt: string; callTool: (n: string, a: unknown) => Promise<unknown> }) => {
      await t.callTool("submit_lens_verdict", t.prompt.includes("phase DESIGN")
        ? { lens, verdict: "REJECTED", defects: lens === "test-integrity" ? [{ severity: "blocker", description: "conception hors sujet", target: "deliverable" }] : [] }
        : { lens, verdict: "APPROVED", defects: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-lens-test-integrity": rejette("test-integrity"), "skraft-lens-architecture": rejette("architecture") });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Phase DESIGN")), 60_000);
    const rejets = (await app.trace.list(id)).filter((e) => e.kind === "rejet");
    expect(rejets.at(-1)).toMatchObject({ porte: "revue", motifs: ["test-integrity : REJECTED — conception hors sujet", "architecture : REJECTED"] });
  }, 90_000);

  it("citation hors limites rejetée avec le motif exact, corrigée au réessai ; questions posées ; réponses dans le dossier de DESIGN", async () => {
    const researchPrompts: string[] = [];
    const researcher: ScriptedBehavior = async (t) => {
      researchPrompts.push(t.prompt);
      const bad = researchPrompts.length === 1;
      await put(
        root,
        ".skraft/us-12/research/research.md",
        researchDoc({ Découvertes: bad ? "Le calcul vit dans `src/domain/bolus-calculator.ts:40-72`." : "Le calcul vit dans `src/domain/bolus-calculator.ts:40-55`." }),
      );
      await t.callTool("report_phase", { summary: "recherche écrite", files: [".skraft/us-12/research/research.md"] });
    };
    let designBrief = "";
    const model: ScriptedBehavior = async (t) => {
      designBrief = t.prompt;
      await put(root, ".skraft/us-12/design/event-model.md", "`BolusCapped`\n");
      await t.callTool("report_phase", { summary: "modèle", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-researcher": researcher, "skraft-architect-model": model });
    const app = await assemble(root, runtime, tasksDir);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;

    // Difficulté confirmée : medium-hard, RESEARCH exécutée.
    await until(async () => (await app.interactions.pending()).length === 1);
    const [difficulty] = await app.interactions.pending();
    expect(difficulty!.title).toMatch(/^Difficulté de US-12 : /);
    await app.interactions.respond(difficulty!.id, difficulty!.options.find((o) => o.id.endsWith(":medium-hard"))!.id);

    // Présélection par le code dans le dossier de passation de RESEARCH.
    await until(async () => researchPrompts.length >= 1);
    expect(researchPrompts[0]).toContain("Fichiers utiles (présélection) :");
    expect(researchPrompts[0]).toContain("src/domain/bolus-calculator.ts");

    // Porte citations : rejet précis, relance ciblée, puis questions posées à la fin de RESEARCH.
    await until(async () => (await app.interactions.pending()).filter((p) => p.title.startsWith("Question ouverte")).length === 2);
    expect(researchPrompts).toHaveLength(2);
    expect(researchPrompts[1]).toContain("Rejet précédent :");
    expect(researchPrompts[1]).toContain("`src/domain/bolus-calculator.ts:40-72` : plage hors du fichier, qui compte 55 lignes.");
    // Le rejeu est tracé avec sa porte et son motif exact (docs/10 §4.3).
    const rejets = (await app.trace.list(id)).filter((e) => e.kind === "rejet");
    expect(rejets).toEqual([expect.objectContaining({ porte: "citations", motifs: ["`src/domain/bolus-calculator.ts:40-72` : plage hors du fichier, qui compte 55 lignes."] })]);
    const questions = (await app.interactions.pending()).filter((p) => p.title.startsWith("Question ouverte"));
    expect(questions.map((q) => q.detail)).toEqual(["Le plafond s'applique-t-il par prise ou par jour ?", "Le plafond est-il rappelé au patient ?"]);
    expect(questions[0]).toMatchObject({ freeText: true, requiredRoles: ["po", "developpeur", "architecte", "administrateur"] });
    // Comme l'extension (stade ROUTE) : les questions ouvertes sont une étape à part (docs/10 §3).
    expect((await app.engine.status(id))!.phase).toBe("ROUTE");
    // RESEARCH est commitée avant les questions, avec le message du réducteur.
    expect(git(root, "log", "--format=%s", "-1")).toBe("docs(skraft): research de us-12");

    // Un testeur ne peut pas trancher une question métier (§11) ; le PO répond, puis reporte l'autre.
    const option = (q: (typeof questions)[number], action: string) => q.options.find((o) => o.id.endsWith(`:${action}`))!.id;
    await expect(app.interactions.respond(questions[0]!.id, option(questions[0]!, "answer"), "par prise", { role: "testeur" })).rejects.toThrow(/PO \/ BA/);
    await app.interactions.respond(questions[0]!.id, option(questions[0]!, "answer"), "par prise", { role: "po" });
    await app.interactions.respond(questions[1]!.id, option(questions[1]!, "defer"), undefined, { role: "po" });

    // DESIGN reçoit les réponses et la phase RESEARCH dans son dossier de passation.
    await until(async () => designBrief !== "");
    expect(designBrief).toContain("Réponses de l'utilisateur :");
    expect(designBrief).toContain("Le plafond s'applique-t-il par prise ou par jour ? → par prise");
    expect(designBrief).toContain("Le plafond est-il rappelé au patient ? → (question reportée par l'utilisateur)");
    expect(designBrief).toContain("RESEARCH : .skraft/us-12/research/research.md");
    await until(async () => (await app.engine.status(id))?.status === "finished", 60_000);
    expect(app.posted.at(-1)).toContain("Phases exécutées : RESEARCH, DESIGN, DISTILL, DELIVER");
  }, 120_000);

  it("recherche sans document : rejet explicite, escalade après le budget", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-researcher": async (t) => void (await t.callTool("report_phase", { summary: "rien", files: [] })),
    });
    const app = await assemble(root, runtime, tasksDir);
    await app.registry.command("skraft-workflow")!.handler("--auto stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Phase RESEARCH")), 60_000);
    const [escalade] = await app.interactions.pending();
    expect(escalade!.title).toBe("Phase RESEARCH : Document de recherche absent : .skraft/us-12/research/research.md");
    expect(escalade!.requiredRoles).toEqual(["developpeur", "architecte", "administrateur"]);
  }, 60_000);
});
