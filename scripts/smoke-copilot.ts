/**
 * Essai de bout en bout contre le vrai Copilot (hors CI : consomme des requêtes).
 * Vérifie les critères de J1 sans interface : conversation sur un dépôt, checkpoint,
 * annulation en un geste, reprise après « redémarrage ».
 *
 *   pnpm smoke:copilot
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createJsonConversationStore,
  createJsonLogger,
  createMainSession,
  createWorkspaceGuard,
  type MainSessionDeps,
} from "@agent-studio/core";
import { createGhAuth, createNodeCommandRunner, createNodeProcessSpawner } from "@agent-studio/github-auth";
import { createCopilotClient, createCopilotRuntime } from "@agent-studio/runtime-copilot";
import { openWorkspace } from "@agent-studio/workspace";

const dir = mkdtempSync(join(tmpdir(), "agent-studio-smoke-"));
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
writeFileSync(join(dir, "README.md"), "# Démo\n");
execFileSync("git", ["add", "-A"], { cwd: dir });
execFileSync("git", ["-c", "user.name=smoke", "-c", "user.email=smoke@localhost", "commit", "-qm", "init"], { cwd: dir });

const logger = createJsonLogger({ write: (l) => process.stderr.write(`${l}\n`), level: "info" });
const auth = createGhAuth({ runner: createNodeCommandRunner(), spawner: createNodeProcessSpawner() });
console.log("auth :", await auth.status());

const runtime = createCopilotRuntime({ client: createCopilotClient({ gitHubToken: await auth.token() }), logger });
await runtime.start();
const ws = await openWorkspace(dir);
const deps: MainSessionDeps = {
  runtime,
  store: createJsonConversationStore(join(dir, "..", `${randomUUID()}-conv`)),
  checkpoints: ws.checkpoints,
  workspaceRoot: ws.root,
  systemPrompt: "Tu travailles dans un dépôt Git. Réponds en français, brièvement.",
  guard: createWorkspaceGuard({ root: ws.root, confirmer: { confirm: async () => false } }),
  clock: { now: () => new Date() },
  ids: { next: () => randomUUID() },
  idleMs: 120_000,
};

const s1 = createMainSession(deps);
s1.onEvent((e) => {
  if (e.type === "agent" && e.event.type !== "message-delta" && e.event.type !== "activity") console.log("  ·", JSON.stringify(e.event));
});
await s1.start();
await s1.send("Crée le fichier hello.txt contenant exactement le mot bonjour. N'utilise pas le shell.");
console.log("hello.txt créé :", existsSync(join(dir, "hello.txt")));
const turn = s1.messages().find((m) => m.role === "user")!;
await s1.undo(turn.id);
console.log("après annulation, hello.txt existe :", existsSync(join(dir, "hello.txt")));
await s1.close();

const s2 = createMainSession(deps);
const restored = await s2.start();
console.log("messages restaurés :", restored.length);
await s2.send("Rappelle en une phrase ce que je t'ai demandé au premier message.");
console.log("réponse :", s2.messages().filter((m) => m.role === "assistant").at(-1)?.text);
await s2.close();
await runtime.stop();
