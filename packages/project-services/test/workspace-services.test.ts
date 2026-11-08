import { fixedClock, MemoryEvidenceStore, MemoryInteractionStore, MemoryTaskSessionStore, ScriptedRuntime, sequentialIds } from "@agent-studio/core/testing";
import { manifest as tddManifest, tddExtension } from "@agent-studio/ext-tdd";
import { MemoryTaskStore } from "@agent-studio/task-engine";
import type { Workspace } from "@agent-studio/workspace";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createUsageRecorder } from "@agent-studio/core";
import { describe, expect, it } from "vitest";
import type { InteractionDto, TaskCardDto } from "../src/dto.js";
import { workspaceServicesFactory } from "../src/workspace-services.js";

function fakeWorkspace(): Workspace {
  let n = 0;
  return {
    root: "/projets/demo",
    files: { read: async () => "", write: async () => {}, ensureDir: async () => {}, list: async () => [] },
    checkpoints: {
      create: async (label) => ({ id: `cp-${++n}`, sha: "s", head: "h", label, createdAt: "" }),
      list: async () => [],
      diff: async () => ({ files: [], patch: "" }),
      rollback: async () => {},
    },
    repo: {
      // Ce double ne sait pas ouvrir de copie isolée : échouer vaut mieux que rendre une racine vide.
      worktree: async () => { throw new Error("copie isolée non fournie par ce double"); },
      head: async () => "h", commit: async () => null, sync: async () => ({ pulled: 0, pushed: 0 }), switchBranch: async () => {} },
  };
}

async function setup(store = new MemoryTaskStore(), runtime = new ScriptedRuntime(), interactionStore = new MemoryInteractionStore(), taskSessionStore = new MemoryTaskSessionStore()) {
  const usageRecorder = createUsageRecorder(await mkdtemp(join(tmpdir(), "agent-studio-usage-")));
  runtime.behave("diabeo.tdd/tdd-planner", async (t) => {
    t.session.emit({ type: "usage", model: "gpt-5", inputTokens: 1200, outputTokens: 80, multiplier: 1 });
    await t.callTool("submit_plan", { steps: [{ id: "s1", behavior: "plafonne la dose" }] });
  });
  let runtimeLoads = 0;
  const cards: TaskCardDto[] = [];
  const pending: InteractionDto[][] = [];
  const posts: string[] = [];
  const notifications: string[] = [];
  const services = await workspaceServicesFactory({
    extensions: [{ kind: "in-process", manifest: tddManifest, module: tddExtension }],
    stacks: [{ id: "typescript", layout: { acceptanceTests: ["tests/acceptance/**"], unitTests: ["tests/**"], sources: ["src/**"] }, infrastructureModules: ["Infrastructure"],  detect: async () => true, isTestFile: (p) => p.startsWith("tests/"), testFilePattern: "^tests/", runTests: async () => ({ results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 }) }],
    tasksDir: "/inutile",
    taskStore: store,
    evidenceStore: new MemoryEvidenceStore(),
    interactionStore,
    taskSessionStore,
    usageRecorder,
    clock: fixedClock(),
    ids: sequentialIds("id-"),
  })({
    workspace: fakeWorkspace(),
    runtime: async () => (runtimeLoads++, runtime),
    onTask: (c) => cards.push(c),
    onInteractions: (p) => pending.push(p),
    onPost: (ext, md) => posts.push(`${ext}: ${md}`),
    notify: (title, body) => notifications.push(`${title} | ${body}`),
  });
  // Comme le contrôleur : purge des sessions et reprise des tâches une fois les services construits.
  await services.demarrer?.();
  return { services, cards, pending, posts, notifications, getLoads: () => runtimeLoads, store };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
};

describe("Services d'un projet (J2)", () => {
  async function ouvrir(opts: { profil?: string; projet?: string; allowedPrograms?: string[]; confirmer?: "allow-once" | "deny"; fichiers?: string[]; contenus?: Record<string, string> }) {
    const racine = await mkdtemp(join(tmpdir(), "agent-studio-profil-projet-"));
    const cleanup = () => rm(racine, { recursive: true, force: true });
    for (const [rel, contenu] of Object.entries(opts.contenus ?? {})) {
      await mkdir(dirname(join(racine, rel)), { recursive: true });
      await writeFile(join(racine, rel), contenu);
    }
    if (opts.profil !== undefined || opts.projet !== undefined) await mkdir(join(racine, ".agent-studio"), { recursive: true });
    if (opts.profil !== undefined) await writeFile(join(racine, ".agent-studio", "stack.yaml"), opts.profil);
    if (opts.projet !== undefined) await writeFile(join(racine, ".agent-studio", "projet.yaml"), opts.projet);
    const posts: string[] = [];
    const ecrits: string[] = [];
    const services = await workspaceServicesFactory({
      extensions: [],
      stacks: [
        {
          id: "typescript",
          layout: { acceptanceTests: [], unitTests: ["tests/**"], sources: ["src/**"] },
          infrastructureModules: ["Infrastructure"],
          detect: async () => true,
          isTestFile: () => false,
          testFilePattern: "^tests/",
          runTests: async () => ({ results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 }),
        },
      ],
      ...(opts.allowedPrograms ? { allowedPrograms: opts.allowedPrograms } : {}),
      tasksDir: "/inutile",
      taskStore: new MemoryTaskStore(),
      evidenceStore: new MemoryEvidenceStore(),
      interactionStore: new MemoryInteractionStore(),
      taskSessionStore: new MemoryTaskSessionStore(),
      clock: fixedClock(),
      ids: sequentialIds("id-"),
    })({
      workspace: {
        ...fakeWorkspace(),
        root: racine,
        files: { ...fakeWorkspace().files, read: (rel: string) => readFile(join(racine, rel), "utf8"), list: async () => opts.fichiers ?? [], write: async (rel, c) => void ecrits.push(`${rel}\n${c}`) },
      },
      runtime: async () => new ScriptedRuntime(),
      onTask: () => {},
      onInteractions: () => {},
      onPost: (_e, md) => posts.push(md),
      ...(opts.confirmer ? { confirmer: { confirm: async () => opts.confirmer! } } : {}),
    });
    return { services, posts, ecrits, racine, cleanup };
  }

  const PROFIL_VALIDE = `
id: python
detect: [pyproject.toml]
tests:
  command: [pytest, "--junit-xml={rapport}"]
  report: junit-xml
layout:
  unitTests: ["tests/**"]
  sources: ["src/**"]
infrastructureModules: [django]
`;

  it("un profil déclaré par le projet l'emporte sur la détection", async () => {
    const { services, posts, cleanup } = await ouvrir({ profil: PROFIL_VALIDE, allowedPrograms: ["pytest"] });
    try {
      // La stack est celle du profil, pas l'adaptateur TypeScript qui prétendait reconnaître.
      expect(posts.join("\n")).toMatch(/profil/i);
      expect(posts.join("\n")).toMatch(/python/);
    } finally {
      await services.dispose();
      await cleanup();
    }
  });

  it("un profil refusé est expliqué dans la conversation, et la détection reprend la main", async () => {
    // Le champ et la valeur fautive doivent être nommés : l'auteur du profil doit savoir quoi corriger.
    const { services, posts, cleanup } = await ouvrir({ profil: PROFIL_VALIDE.replace("pytest", "curl"), allowedPrograms: ["pytest"] });
    try {
      expect(posts.join("\n")).toMatch(/curl/);
      expect(posts.join("\n")).toMatch(/refus/i);
    } finally {
      await services.dispose();
      await cleanup();
    }
  });

  it("la commande /stack est routable dès qu'un projet est ouvert, sans aucune extension", async () => {
    // Elle appartient au cœur : elle décrit le projet, pas le travail d'une extension.
    const { services, posts, cleanup } = await ouvrir({ confirmer: "deny" });
    expect(services.commands().map((c) => c.invocation)).toContain("stack");
    expect(await services.route("/stack")).toEqual({ kind: "handled" });
    expect(posts.at(-1)).toMatch(/typescript/);
    await cleanup();
  });

  it("/stack doctor décrit le profil déclaré, et dit ce qu'il n'a pas vérifié", async () => {
    const { services, posts, cleanup } = await ouvrir({ profil: PROFIL_VALIDE, allowedPrograms: ["pytest"], confirmer: "deny" });
    await services.route("/stack doctor");
    expect(posts.at(-1)).toMatch(/Diagnostic du profil/);
    expect(posts.at(-1)).toMatch(/canari/i);
    await cleanup();
  });

  it("/stack init propose un profil puis n'écrit rien quand l'utilisateur refuse", async () => {
    const { services, posts, ecrits, cleanup } = await ouvrir({ confirmer: "deny", fichiers: ["pyproject.toml", "tests/test_a.py"] });
    await services.route("/stack init");
    expect(posts.at(-2)).toMatch(/```yaml/);
    expect(posts.at(-1)).toMatch(/rien n'a été écrit/i);
    expect(ecrits).toEqual([]);
    await cleanup();
  });

  it("/stack init écrit le profil après accord, à l'emplacement versionné", async () => {
    const { services, ecrits, cleanup } = await ouvrir({ confirmer: "allow-once", fichiers: ["pyproject.toml"] });
    await services.route("/stack init");
    expect(ecrits).toHaveLength(1);
    // Fichier de projet (ADR 0071) : le profil va dans la section pile.
    expect(ecrits[0]).toMatch(/^\.agent-studio\/projet\.yaml\n/);
    expect(ecrits[0]).toMatch(/pile:\n\s+id: python/);
    await cleanup();
  });

  it("/stack init garde la section qualite d'un projet.yaml existant", async () => {
    const { services, ecrits, cleanup } = await ouvrir({ confirmer: "allow-once", fichiers: ["pyproject.toml"], projet: "# barre de l'équipe\nqualite:\n  couverture:\n    reste: 70\n" });
    await services.route("/stack init");
    expect(ecrits).toHaveLength(1);
    expect(ecrits[0]).toContain("# barre de l'équipe");
    expect(ecrits[0]).toMatch(/qualite:\n\s+couverture:\n\s+reste: 70/);
    expect(ecrits[0]).toMatch(/pile:\n\s+id: python/);
    await cleanup();
  });

  it("/stack init sur un dépôt mixte (ADR 0074) : un composant par sous-projet reconnu, jusqu'à 4 niveaux ; dépendances et dossiers cachés écartés ; la section qualite gardée", async () => {
    const fichiers = [
      "services/api/pyproject.toml",
      "web/package.json",
      "a/b/c/d/pyproject.toml",
      "a/b/c/d/e/pyproject.toml",
      "node_modules/x/pyproject.toml",
      ".git/hooks/pyproject.toml",
      "README.md",
    ];
    const { services, ecrits, cleanup } = await ouvrir({ confirmer: "allow-once", fichiers, projet: "qualite:\n  couverture:\n    reste: 70\n" });
    // `web/package.json` n'est pas sur le disque : sans dépendance `vitest` lisible, `web` n'est pas reconnu.
    await services.route("/stack init");
    expect(ecrits).toHaveLength(1);
    const ecrit = ecrits[0]!;
    expect(ecrit).toMatch(/^\.agent-studio\/projet\.yaml\n/);
    expect(ecrit).toMatch(/qualite:\n\s+couverture:\n\s+reste: 70/);
    expect(ecrit).not.toMatch(/^pile:/m);
    expect([...ecrit.matchAll(/racine: (\S+)/g)].map((m) => m[1])).toEqual(["a/b/c/d", "services/api"]);
    await cleanup();
  });

  it("/stack init détecte le BDD (ADR 0074 §2.5) : lanceur cité par un manifeste, dossier des .feature, dossier des étapes", async () => {
    const fichiers = ["pyproject.toml", "tests/features/panier.feature", "tests/steps/test_panier.py", "src/panier.py"];
    const { services, ecrits, cleanup } = await ouvrir({ confirmer: "allow-once", fichiers, contenus: { "pyproject.toml": 'dependencies = ["pytest-bdd>=7"]\n' } });
    await services.route("/stack init");
    expect(ecrits[0]).toMatch(/bdd:\n\s+- lanceur: pytest-bdd\n\s+features: tests\/features\n\s+etapes: tests\/steps/);
    await cleanup();
  });

  it("/stack init sur un sous-projet en BDD : chemins relatifs à sa racine", async () => {
    const fichiers = ["services/api/pyproject.toml", "services/api/features/a.feature", "services/api/features/steps/test_a.py", "web/README.md"];
    const { services, ecrits, cleanup } = await ouvrir({ confirmer: "allow-once", fichiers, contenus: { "services/api/pyproject.toml": 'dependencies = ["behave"]\n' } });
    await services.route("/stack init");
    expect(ecrits[0]).toMatch(/racine: services\/api/);
    expect(ecrits[0]).toMatch(/lanceur: behave\n\s+features: features\n\s+etapes: features\/steps/);
    await cleanup();
  });

  it("/stack doctor vérifie le BDD déclaré : dossiers présents, lanceur cité par un manifeste", async () => {
    const profil = `${PROFIL_VALIDE}bdd:\n  - { lanceur: pytest-bdd, features: tests/features, etapes: tests/steps }\n`;
    const fichiers = ["pyproject.toml", "tests/features/a.feature", "tests/steps/test_a.py"];
    const { services, posts, cleanup } = await ouvrir({ profil, allowedPrograms: ["pytest"], confirmer: "deny", fichiers, contenus: { "pyproject.toml": 'dependencies = ["pytest-bdd"]\n' } });
    await services.route("/stack doctor");
    expect(posts.at(-1)).toContain("BDD : le lanceur `pytest-bdd` est cité par un manifeste du projet.");
    expect(posts.at(-1)).toContain("BDD : des `.feature` dans `tests/features`.");
    await cleanup();
  });

  it("/stack doctor sur un projet à composants : chaque composant diagnostiqué dans sa racine (ADR 0074)", async () => {
    const pile = ["id: python", "detect: [pyproject.toml]", "tests:", '  command: [pytest, "--junit-xml={rapport}"]', "  report: junit-xml", "layout:", '  unitTests: ["tests/**"]', '  sources: ["src/**"]'];
    const projet = `composants:\n  - nom: api\n    racine: api\n    pile:\n${pile.map((l) => `      ${l}`).join("\n")}\n`;
    const { services, posts, cleanup } = await ouvrir({ confirmer: "allow-once", allowedPrograms: ["pytest"], fichiers: ["api/pyproject.toml", "api/tests/test_a.py", "api/src/a.py"], projet });
    await services.route("/stack doctor");
    const rapport = posts.at(-1)!;
    expect(rapport).toMatch(/## Composant `api` \(`api`\) — profil `python`/);
    // Les emplacements sont cherchés sous la racine du composant : `api/tests/test_a.py` correspond à `tests/**`.
    expect(rapport).toMatch(/`unitTests` : tests\/\*\*\./);
    expect(rapport).not.toMatch(/aucun fichier ne correspond à tests/);
    await cleanup();
  });

  it("sans confirmateur, /stack n'est pas enregistrée : mieux vaut pas de commande qu'une écriture sans accord", async () => {
    const { services, cleanup } = await ouvrir({});
    expect(services.commands().map((c) => c.invocation)).not.toContain("stack");
    await cleanup();
  });

  it("sans profil, rien n'est dit et la détection s'applique", async () => {
    const { services, posts, cleanup } = await ouvrir({});
    try {
      expect(posts.join("\n")).not.toMatch(/profil/i);
    } finally {
      await services.dispose();
      await cleanup();
    }
  });

  it("stack non reconnue : l'utilisateur en est averti dans la conversation, pas seulement dans le journal", async () => {
    // Le repli change ce que font les portes et les commandes : le taire laisserait
    // l'utilisateur devant des résultats inexplicables.
    const posts: string[] = [];
    await workspaceServicesFactory({
      extensions: [],
      stacks: [
        {
          id: "typescript",
          layout: { acceptanceTests: [], unitTests: [], sources: [] },
          infrastructureModules: [],
          detect: async () => false, // aucun adaptateur ne reconnaît ce projet
          isTestFile: () => false,
          testFilePattern: "^tests/",
          runTests: async () => ({ results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 }),
        },
      ],
      tasksDir: "/inutile",
      taskStore: new MemoryTaskStore(),
      evidenceStore: new MemoryEvidenceStore(),
      interactionStore: new MemoryInteractionStore(),
      taskSessionStore: new MemoryTaskSessionStore(),
      clock: fixedClock(),
      ids: sequentialIds("id-"),
    })({
      workspace: fakeWorkspace(),
      runtime: async () => new ScriptedRuntime(),
      onTask: () => {},
      onInteractions: () => {},
      onPost: (ext, md) => posts.push(`${ext}: ${md}`),
    });
    expect(posts.join("\n")).toMatch(/reconnu par aucun adaptateur/i);
  });

  it("expose la commande /tdd de l'extension ; le texte libre part vers la session principale", async () => {
    const { services, getLoads } = await setup();
    expect(services.commands().map((c) => c.invocation)).toEqual(["tdd"]);
    expect(await services.route("Bonjour")).toEqual({ kind: "chat" });
    expect(await services.route("/inconnue")).toEqual({ kind: "unknown-command", name: "inconnue" });
    expect(getLoads()).toBe(0); // aucun runtime tant qu'aucun agent n'est lancé
  });

  it("/tdd : tâche lancée, carte avec libellés du manifeste, plan soumis en demande d'interaction", async () => {
    const { services, cards, pending, posts } = await setup();
    expect(await services.route("/tdd Plafonner la dose")).toEqual({ kind: "handled" });
    expect(posts[0]).toMatch(/^diabeo\.tdd: Cycle TDD lancé/);

    await until(() => pending.some((p) => p.length === 1));
    const [review] = await services.pendingInteractions();
    expect(review).toMatchObject({ extensionId: "diabeo.tdd", title: "Valider le plan TDD : Plafonner la dose", detail: "1. plafonne la dose" });
    expect(review?.options.map((o) => o.id)).toEqual(["approve", "reject"]);

    await until(() => cards.at(-1)?.status === "waiting"); // carte limitée à deux rafraîchissements par seconde
    const card = cards.at(-1)!;
    expect(card).toMatchObject({ title: "Cycle TDD : Plafonner la dose", phase: "PLAN_REVIEW", phaseLabel: "Plan à valider", status: "waiting", alert: false });
    expect(card.step).toEqual({ index: 1, total: 1, behavior: "plafonne la dose" });
    expect(await services.tasks()).toHaveLength(1);
  });

  it("usage par état sur la carte : requêtes et tokens du planificateur, libellé du manifeste (D37)", async () => {
    const { services, cards, pending } = await setup();
    await services.route("/tdd Plafonner la dose");
    await until(() => pending.some((p) => p.length === 1));
    await until(() => cards.at(-1)?.usage?.rows.some((r) => r.phase === "PLANNING" && r.requests === 1) ?? false);
    const usage = cards.at(-1)!.usage!;
    expect(usage.unit).toBe("requests");
    expect(usage.rows.find((r) => r.phase === "PLANNING")).toMatchObject({ label: "Découpage en comportements", requests: 1, inputTokens: 1200, outputTokens: 80 });
    expect(usage.total.requests).toBe(1);
  });

  it("la réponse relance la tâche ; l'annulation clôt la tâche et ses demandes", async () => {
    const { services, pending, cards } = await setup();
    await services.route("/tdd Plafonner la dose");
    await until(() => pending.some((p) => p.length === 1));
    const [review] = await services.pendingInteractions();
    await services.respond(review!.id, "reject", "trop large");
    await until(() => pending.filter((p) => p.length === 1).length === 2); // nouveau plan soumis
    const [second] = await services.pendingInteractions();

    await services.cancelTask(second!.taskId);
    await until(() => cards.at(-1)?.phase === "ABORTED");
    expect(cards.at(-1)).toMatchObject({ status: "finished", phaseLabel: "Annulé", alert: true });
    await until(() => pending.at(-1)?.length === 0);
  });

  it("redémarrage : la tâche en attente et sa demande de décision sont toujours là (J3)", async () => {
    const store = new MemoryTaskStore();
    const interactionStore = new MemoryInteractionStore();
    const first = await setup(store, new ScriptedRuntime(), interactionStore);
    await first.services.route("/tdd Plafonner la dose");
    await until(() => first.pending.some((p) => p.length === 1));
    await first.services.dispose();

    const second = await setup(store, new ScriptedRuntime(), interactionStore);
    const tasks = await second.services.tasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ phase: "PLAN_REVIEW", status: "waiting" });
    const [review] = await second.services.pendingInteractions();
    expect(review?.taskId).toBe(tasks[0]?.id);
  });

  it("sessions d'agent : celles d'un crash supprimées à l'ouverture, toutes supprimées à la fermeture (ADR 0053)", async () => {
    // Ouverture après un crash : le registre nomme une session que personne ne libérera plus.
    const sessions = new MemoryTaskSessionStore([{ key: "t-ancienne/diabeo.tdd/tdd-planner", sessionId: "orpheline" }]);
    const runtime = new ScriptedRuntime();
    const { services, pending } = await setup(new MemoryTaskStore(), runtime, new MemoryInteractionStore(), sessions);
    await until(() => runtime.deleted.includes("orpheline"));

    // Une tâche en attente d'une décision humaine garde la session de son planificateur (ADR 0039)…
    await services.route("/tdd Plafonner la dose");
    await until(() => pending.some((p) => p.length === 1));
    const planificateur = runtime.history.at(-1)!.id;
    expect(runtime.deleted).not.toContain(planificateur);
    expect((await sessions.list()).map((e) => e.sessionId)).toEqual([planificateur]);

    // …mais la fermeture normale la supprime comme un crash le ferait.
    await services.dispose();
    expect(runtime.deleted).toContain(planificateur);
    expect(await sessions.list()).toEqual([]);
  });

  it("jalons et alertes : consignés dans la conversation et notifiés", async () => {
    const { services, pending, posts, notifications } = await setup();
    await services.route("/tdd Plafonner la dose");
    await until(() => pending.some((p) => p.length === 1));
    const [review] = await services.pendingInteractions();
    await services.cancelTask(review!.taskId);
    await until(() => posts.some((p) => p.includes("Annulé")));
    expect(posts.at(-1)).toBe("diabeo.tdd: Cycle TDD : Plafonner la dose : Annulé (étape 1 sur 1 : plafonne la dose)");
    expect(notifications.at(-1)).toMatch(/^Tâche à surveiller \| Cycle TDD/);
  });
});
