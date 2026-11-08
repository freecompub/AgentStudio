/**
 * Extension de démonstration pour les tests d'isolation : volontairement « mal élevée » par endroits
 * (lecture de fichiers système, permission non déclarée, hooks qui plantent, arrêt brutal).
 */
import { readFileSync } from "node:fs";
import type { ExtensionModule } from "@agent-studio/extension-api";

type S = { n: number; done: boolean; tests?: number };
type E = { type: "TICK"; tests: number };
type F = { kind: "runTests" };

const demo: ExtensionModule = {
  activate(ctx) {
    ctx.chat.registerCommand("hello", async (args) => ctx.chat.post(`bonjour ${args} depuis le pid ${process.pid}`));

    ctx.chat.registerCommand("commit", async () => {
      try {
        await ctx.git.commit("pirate");
        ctx.chat.post("commit accepté");
      } catch (err) {
        ctx.chat.post(`refusé : ${(err as Error).message}`);
      }
    });

    ctx.chat.registerCommand("read-system", async () => {
      try {
        readFileSync("/etc/hostname", "utf8");
        ctx.chat.post("lecture système réussie");
      } catch (err) {
        ctx.chat.post(`lecture système refusée : ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
      }
    });

    ctx.chat.registerCommand("crash", async () => {
      setTimeout(() => process.exit(1), 10);
    });

    ctx.tools.register({
      name: "shout",
      description: "Met un texte en majuscules",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      handler: async (args) => `${String((args as { text: string }).text).toUpperCase()} (pid ${process.pid})`,
    });

    ctx.chat.registerCommand("files", async () => ctx.chat.post(`fichiers : ${(await ctx.workspace.listFiles()).join(", ")}`));
    ctx.chat.registerCommand("pile", async () => ctx.chat.post(`bdd : ${JSON.stringify(ctx.stack.bdd ?? null)}`));

    ctx.hooks.onPreToolUse((call) => {
      if (call.kind === "shell" && call.command?.includes("boom")) throw new Error("le hook plante");
      if (call.kind === "shell" && call.command?.includes("lent")) return new Promise(() => {});
      if (call.kind === "shell" && call.command?.includes("rm")) return { decision: "deny", reason: "rm interdit par la démo" };
      return undefined;
    });

    ctx.tasks.register<S, E, F>({
      name: "count",
      initialState: () => ({ n: 0, done: false }),
      initialEffects: () => [{ kind: "runTests" }],
      transition: (s, e) => (e.type === "TICK" ? { state: { n: s.n + 1, done: true, tests: e.tests }, effects: [] } : { state: s, effects: [] }),
      runEffect: async (_f, c, { taskId }) => {
        const run = await c.stack.runTests({ evidence: { taskId, phase: "DEMO" } });
        return { type: "TICK", tests: run.results.length };
      },
      checkpointBefore: () => false,
      isTerminal: (s) => s.done,
    });
  },
};

export default demo;
