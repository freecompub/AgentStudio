/**
 * Banc d'essai de skraft : vrai dépôt Git, vraie pile (moteur, hôte, exécuteur d'agents, preuves,
 * interactions persistées), agents simulés par un runtime scripté. Aucun LLM.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  createHookRegistry,
  createInteractionService,
  createJsonEvidenceStore,
  createJsonInteractionStore,
  createRegistry,
  createTaskAgentRunner,
  createUsageRecorder,
} from "@agent-studio/core";
import { sequentialIds, type ScriptedBehavior, type ScriptedRuntime } from "@agent-studio/core/testing";
import { activateInProcess, activateIsolated, bundle, createNodeLauncher, type ExtensionHandle, type HostDeps } from "@agent-studio/extension-host";
import type { StackAdapter } from "@agent-studio/stack-adapters";
import { createJsonTaskStore, createTaskEngine, type TaskRecord } from "@agent-studio/task-engine";
import { openWorkspace, type Workspace } from "@agent-studio/workspace";
import { manifest, skraftExtension, type SkraftState } from "../../src/index.js";

export const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@localhost", ...args], { cwd, encoding: "utf8" }).trim();

export async function put(root: string, rel: string, content: string) {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await writeFile(join(root, rel), content);
}

export const US12 = `# US-12 — Plafonner le bolus proposé

En tant que patient, quand le calcul propose une dose de bolus supérieure au plafond défini par mon médecin,
je veux que la dose proposée soit limitée à ce plafond et qu'une alerte m'explique pourquoi.

## Critères d'acceptation
1. Plafond de 10 U, calcul à 6 U : dose proposée 6 U, pas d'alerte.
2. Plafond de 10 U, calcul à 12,5 U : dose proposée 10 U, alerte « Dose plafonnée à 10 U ».
3. Aucun plafond configuré : dose proposée égale au calcul, pas d'alerte.

## Questions ouvertes
- Le plafond s'applique-t-il par prise ou par jour ?
`;

/** Story difficile : deux questions métier ouvertes (§8.2). */
export const US15 = `# US-15 — Alerter sur un bolus rapproché

En tant que patient, je veux être alerté si je demande un bolus peu après le précédent.

## Critères d'acceptation
1. Bolus demandé 30 min après le précédent : alerte « Bolus rapproché ».
2. Bolus demandé 3 h après le précédent : aucune alerte.

## Questions ouvertes
- Le délai minimal dépend-il de l'insuline utilisée ?
- L'alerte bloque-t-elle la validation ?
`;

export const SIMPLE = `# US-7 — Afficher l'unité

En tant que patient, je veux voir l'unité de la dose.

## Critères d'acceptation
1. La dose est affichée avec « U ».
`;

/** Projet Swift de démonstration (code seulement : S1 ne lance aucun test). */
export async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-studio-skraft-"));
  await put(root, "Package.swift", "// swift-tools-version:5.9\n");
  await put(root, "Sources/Domain/BolusCalculator.swift", "public struct BolusCalculator {}\n");
  await put(root, "Sources/Settings/MaxBolusSetting.swift", "public struct MaxBolusSetting {}\n");
  await put(root, "stories/us-12.md", US12);
  await put(root, "stories/us-7.md", SIMPLE);
  await put(root, "stories/us-15.md", US15);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return root;
}

export const ROLE = (name: string) => `agent-studio.skraft/${name}`;

/** Document de recherche conforme au gabarit (§7.1), citations valides sur le projet de démonstration. */
export function researchDoc(over: Partial<Record<string, string>> = {}): string {
  const body: Record<string, string> = {
    "Périmètre et critères de succès": "Plafonner la dose proposée au maximum défini par le médecin.",
    "Fichiers analysés": "- `Sources/Domain/BolusCalculator.swift:1-1`\n- `Sources/Settings/MaxBolusSetting.swift`",
    "Recherches effectuées": "XCTest : https://developer.apple.com/documentation/xctest",
    "Conventions du projet": "Objets-valeurs immuables dans le domaine.",
    Découvertes: "Le calcul vit dans `Sources/Domain/BolusCalculator.swift:1-1`.",
    "Approches évaluées": "1. Plafond dans le domaine.\n2. Plafond dans l'interface.",
    Recommandation: "Appliquer le plafond dans le domaine.",
    "Passage de relais": "Décision à valider : emplacement du plafond.\n\n### Questions ouvertes\n- Le plafond est-il rappelé au patient ?",
    ...over,
  };
  return ["# Recherche", ...Object.entries(body).map(([h, t]) => `## ${h}\n\n${t}`)].join("\n\n");
}

/** Répond automatiquement aux questions ouvertes (profil PO), avec la réponse donnée. */
export function answerQuestions(app: { interactions: import("@agent-studio/core").InteractionService }, answer = "par prise"): () => void {
  const answered = new Set<string>();
  const tick = async () => {
    for (const q of await app.interactions.pending()) {
      if (!q.title.startsWith("Question ouverte") || answered.has(q.id)) continue;
      answered.add(q.id);
      await app.interactions.respond(q.id, q.options[0]!.id, answer, { role: "po" }).catch(() => answered.delete(q.id));
    }
  };
  const off = app.interactions.onChange(() => void tick());
  void tick();
  return off;
}

/** Agent test simulé : un test unitaire de plus par tour, rouge (symbole manquant) tant que le code n'existe pas. */
export function unitTestWriter(root: string): ScriptedBehavior {
  return async (t) => {
    const { readFile: read } = await import("node:fs/promises");
    const rel = "Tests/UnitTests/BolusCapTests.swift";
    const existing = await read(join(root, rel), "utf8").catch(() => "");
    const n = [...existing.matchAll(/func test/g)].length + 1;
    const tests = [...existing.matchAll(/^  func .*$/gm)].map((m) => m[0]);
    tests.push(`  func testCap${n}() { XCTAssertEqual(BolusCap().max, 10) }`);
    await put(root, rel, `import XCTest\n@testable import Domain\nfinal class BolusCapTests: XCTestCase {\n${tests.join("\n")}\n}\n`);
    await t.callTool("report_phase", { summary: `écrit ${rel}`, files: [rel] });
  };
}

/** Agents simulés : chacun écrit son livrable dans son périmètre puis rend la main. */
export function simulatedAgents(
  runtime: ScriptedRuntime,
  root: string,
  over: Partial<Record<string, ScriptedBehavior>> = {},
  opts: { usage?: boolean } = {},
): ScriptedRuntime {
  const writer = (rel: string, content: string): ScriptedBehavior => async (t) => {
    await put(root, rel, content);
    await t.callTool("report_phase", { summary: `écrit ${rel}`, files: [rel] });
  };
  const behaviors: Record<string, ScriptedBehavior> = {
    "skraft-classifier": async (t) => {
      const proposed = /Niveau proposé par la grille : (\S+)/.exec(t.prompt)?.[1] ?? "medium";
      await t.callTool("submit_difficulty", { level: proposed, justification: "conforme à la grille" });
    },
    "skraft-researcher": async (t) => {
      const slug = /Dossier de travail : \.skraft\/([^/]+)\//.exec(t.prompt)?.[1] ?? "x";
      await writer(`.skraft/${slug}/research/research.md`, researchDoc())(t);
    },
    "skraft-architect-model": async (t) => {
      const slug = /Dossier de travail : \.skraft\/([^/]+)\//.exec(t.prompt)?.[1] ?? "x";
      await writer(`.skraft/${slug}/design/event-model.md`, "`BolusCapped`\n")(t);
    },
    "skraft-architect-decide": async (t) => {
      const slug = /Dossier de travail : \.skraft\/([^/]+)\//.exec(t.prompt)?.[1] ?? "x";
      await writer(`.skraft/${slug}/design/contracts.md`, "`BolusCapped`\n")(t);
    },
    "skraft-acceptance": async (t) => {
      const slug = /Dossier de travail : \.skraft\/([^/]+)\//.exec(t.prompt)?.[1] ?? "x";
      const criteria = [...t.prompt.matchAll(/^\s+(\d+)\. (.+)$/gm)].map((m) => ({ n: m[1]!, text: m[2]! }));
      const feature = criteria.map((c) => `  @ac-${c.n}\n  Scénario: critère ${c.n}\n    Alors ${c.text}\n`).join("\n");
      const tests = criteria.map((c) => `  func testAc${c.n}() { XCTFail(${JSON.stringify(c.text)}) } // ac-${c.n}`).join("\n");
      await put(root, `.skraft/${slug}/distill/features/plafond.feature`, `Fonctionnalité: story\n\n${feature}`);
      await put(root, `.skraft/${slug}/distill/test-plan.md`, "# Plan de test\n");
      await put(root, `.skraft/${slug}/distill/impl-plan.md`, "# Plan d'implémentation\n");
      await writer("Tests/AcceptanceTests/StoryAcceptanceTests.swift", `import XCTest\nfinal class StoryAcceptanceTests: XCTestCase {\n${tests}\n}\n`)(t);
    },
    "skraft-test": unitTestWriter(root),
    "skraft-dev": writer("Sources/Domain/BolusCap.swift", "public struct BolusCap {}\n"),
    ...Object.fromEntries(
      ["cold-reader", "test-integrity", "architecture", "quality-gates"].map((l) => [
        `skraft-lens-${l}`,
        (async (t) => void (await t.callTool("submit_lens_verdict", { lens: l, verdict: "APPROVED", defects: [] }))) as ScriptedBehavior,
      ]),
    ),
  };
  for (const [name, behavior] of Object.entries({ ...behaviors, ...over })) {
    if (!behavior) continue;
    // Usage simulé (D37) : une requête par tour, tokens proportionnels au dossier de passation.
    const measured: ScriptedBehavior = opts.usage
      ? async (t) => {
          t.session.emit({ type: "usage", model: "gpt-5", inputTokens: t.prompt.length, outputTokens: 100, multiplier: 1 });
          await behavior(t);
        }
      : behavior;
    runtime.behave(ROLE(name), measured);
  }
  return runtime;
}

/** Panne simulée : l'opération désignée ne rend jamais la main (plantage du processus). */
export type HangPoint = "readStory" | "changedFiles" | "commit";

function withHang(ws: Workspace, hang: HangPoint | undefined): Workspace {
  if (!hang) return ws;
  const never = () => new Promise<never>(() => {});
  return {
    ...ws,
    files: { ...ws.files, read: (p) => (hang === "readStory" && p.startsWith("stories/") ? never() : ws.files.read(p)) },
    checkpoints: { ...ws.checkpoints, diff: (id) => (hang === "changedFiles" ? never() : ws.checkpoints.diff(id)) },
    repo: { ...ws.repo, commit: (m, o) => (hang === "commit" ? never() : ws.repo.commit(m, o)) },
  };
}

let artifacts: Promise<{ runtimeEntry: string; extDir: string }> | undefined;
function isolatedArtifacts() {
  artifacts ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-studio-skraft-bundles-"));
    const runtimeEntry = join(dir, "runtime", "extension-child.mjs");
    const extDir = join(dir, "skraft");
    await bundle(resolve(import.meta.dirname, "../../../../packages/extension-host/src/child/entry.ts"), runtimeEntry);
    await bundle(resolve(import.meta.dirname, "../../src/entry.ts"), join(extDir, "dist/index.mjs"));
    return { runtimeEntry, extDir };
  })();
  return artifacts;
}

const handles: ExtensionHandle[] = [];
export async function shutdownHosts(): Promise<void> {
  for (const h of handles.splice(0)) await h.deactivate().catch(() => undefined);
}

/**
 * Fausse exécution Swift : chaque test d'acceptance marqué `ac-<n>` est rouge sur assertion tant que le
 * fichier de production `Sources/Domain/BolusCap.swift` n'existe pas, vert ensuite ; chaque test
 * unitaire de `Tests/UnitTests` est rouge sur symbole manquant tant que ce fichier n'existe pas.
 */
async function fakeSwiftRun(opts: { root: string }) {
  const { readdir, readFile: read, access } = await import("node:fs/promises");
  const results: { id: string; file: string; status: "passed" | "failed"; failureKind?: "assertion" | "missing_symbol"; message?: string }[] = [];
  const dir = join(opts.root, "Tests/AcceptanceTests");
  const delivered = await access(join(opts.root, "Sources/Domain/BolusCap.swift")).then(() => true, () => false);
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    const content = await read(join(dir, f), "utf8");
    for (const m of content.matchAll(/func (testAc\d+)/g))
      results.push(delivered
        ? { id: `AcceptanceTests.${f.replace(".swift", "")}/${m[1]}`, file: `Tests/AcceptanceTests/${f}`, status: "passed" }
        : { id: `AcceptanceTests.${f.replace(".swift", "")}/${m[1]}`, file: `Tests/AcceptanceTests/${f}`, status: "failed", failureKind: "assertion", message: "XCTFail" });
  }
  const unitDir = join(opts.root, "Tests/UnitTests");
  for (const f of await readdir(unitDir).catch(() => [] as string[])) {
    const content = await read(join(unitDir, f), "utf8");
    for (const m of content.matchAll(/func (test\w+)/g)) {
      const id = `UnitTests.${f.replace(".swift", "")}/${m[1]}`;
      const file = `Tests/UnitTests/${f}`;
      results.push(delivered ? { id, file, status: "passed" } : { id, file, status: "failed", failureKind: "missing_symbol", message: "cannot find 'BolusCap' in scope" });
    }
  }
  return { results, exitCode: results.some((r) => r.status === "failed") ? 1 : 0, timedOut: false, output: "", durationMs: 1 };
}

/** Pile Swift simulée (aucune chaîne réelle) : tests d'acceptance et unitaires lus sur le disque. */
export function fakeSwiftStack(): StackAdapter {
  return {
    id: "swift",
    layout: { acceptanceTests: ["Tests/AcceptanceTests/**"], unitTests: ["Tests/**"], sources: ["Sources/**"] },
    infrastructureModules: ["Infrastructure"],
    detect: async () => true,
    isTestFile: (p) => /(^|\/)Tests\//.test(p),
    testFilePattern: "(^|\\/)Tests\\/",
    runTests: fakeSwiftRun,
  };
}

export async function assemble(root: string, runtime: ScriptedRuntime, tasksDir: string, opts: { hang?: HangPoint; isolated?: boolean; stack?: StackAdapter } = {}) {
  const workspace = withHang(await openWorkspace(root), opts.hang);
  const usage = createUsageRecorder(join(tasksDir, "usage"));
  const engine = createTaskEngine({
    usage,
    store: createJsonTaskStore(tasksDir),
    checkpoints: workspace.checkpoints,
    clock: { now: () => new Date() },
    ids: sequentialIds(`t${Math.random().toString(36).slice(2, 6)}-`),
  });
  const interactions = createInteractionService({
    store: createJsonInteractionStore(join(tasksDir, "interactions")),
    clock: { now: () => new Date() },
    ids: sequentialIds(`int${Math.random().toString(36).slice(2, 6)}-`),
    deliver: (taskId, option, comment) => engine.dispatch(taskId, { type: "HUMAN_DECISION", decision: option, ...(comment ? { comment } : {}) }),
  });
  const registry = createRegistry();
  const posted: string[] = [];
  const hostDeps: HostDeps = {
    registry,
    engine,
    agents: createTaskAgentRunner({ runtime, root: workspace.root, idleMs: 3_600_000 }),
    workspace,
    stack: opts.stack ?? fakeSwiftStack(),
    interactions,
    chat: { post: (_e, md) => void posted.push(md) },
    evidence: createJsonEvidenceStore(join(tasksDir, "evidence")),
    hooks: createHookRegistry(),
    usage,
    clock: { now: () => new Date() },
    ids: sequentialIds(`e${Math.random().toString(36).slice(2, 6)}-`),
  };
  if (opts.isolated) {
    const { runtimeEntry, extDir } = await isolatedArtifacts();
    handles.push(await activateIsolated({ manifest, directory: extDir, entry: join(extDir, "dist/index.mjs") }, hostDeps, { launcher: createNodeLauncher(), runtimeEntry }));
  } else handles.push(await activateInProcess({ manifest, module: skraftExtension }, hostDeps));
  return { engine, interactions, registry, posted, workspace, usage };
}

export async function until(check: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error("Condition non atteinte à temps");
    await new Promise((r) => setTimeout(r, 25));
  }
}

export const stateOf = (r: TaskRecord | null) => r?.state as SkraftState | undefined;
