import { describe, expect, it } from "vitest";
import { createMemoryPermissionRules, createPermissionArbiter } from "../src/guards/permission-arbiter.js";
import type { ToolCallGuard } from "../src/protocols/agent-runtime.js";
import type { ConfirmAnswer, ConfirmRequest } from "../src/protocols/interaction.js";

const ROOT = "/projets/demo";

function setup(answer: ConfirmAnswer = "allow-once", hooks: ToolCallGuard[] = []) {
  const asked: ConfirmRequest[] = [];
  const rules = createMemoryPermissionRules();
  const arbiter = createPermissionArbiter({
    root: ROOT,
    confirmer: { confirm: async (q) => (asked.push(q), answer) },
    rules,
    extensionGuards: () => hooks,
  });
  return { arbiter, asked, rules };
}

const shell = (command: string) => ({ kind: "shell" as const, toolName: "bash", command });

describe("Arbitre de permissions (D27)", () => {
  it("politique du cœur d'abord : un refus du cœur ne consulte ni les extensions ni l'utilisateur", async () => {
    let hookCalled = false;
    const { arbiter, asked } = setup("allow-once", [{ check: async () => ((hookCalled = true), { decision: "allow" }) }]);
    expect(await arbiter.check({ kind: "write", toolName: "edit", path: "../x" })).toMatchObject({ decision: "deny" });
    expect(await arbiter.check(shell("git push"))).toMatchObject({ decision: "deny" });
    expect(hookCalled).toBe(false);
    expect(asked).toEqual([]);
  });

  it("Git mutant refusé quelles que soient les options, y compris celles qui prennent une valeur", async () => {
    // `-C <chemin>` et `-c <clé=valeur>` séparent l'option de son argument : un motif qui ne
    // consomme que l'option laisse passer la commande, et D29 se contourne alors par un
    // « toujours autoriser » accordé à ce qui ressemble à une commande anodine.
    const { arbiter } = setup("allow-once");
    for (const c of [
      "git commit -m x",
      "git -C /tmp commit -m x",
      "git -c user.name=a commit",
      "git --git-dir=/x commit",
      "git -C /tmp -c user.email=a@b push",
      "git --work-tree /tmp checkout main",
    ])
      expect(await arbiter.check(shell(c)), c).toMatchObject({ decision: "deny" });
  });

  it("Git en lecture seule reste autorisé sans question", async () => {
    const { arbiter, asked } = setup("allow-once");
    for (const c of ["git status", "git log --oneline -5", "git diff HEAD"])
      expect(await arbiter.check(shell(c)), c).toEqual({ decision: "allow" });
    expect(asked).toEqual([]);
  });

  it("un refus d'extension l'emporte avant toute question à l'utilisateur", async () => {
    const { arbiter, asked } = setup("allow-once", [{ check: async () => ({ decision: "deny", reason: "[ext] non" }) }]);
    expect(await arbiter.check(shell("npm test"))).toEqual({ decision: "deny", reason: "[ext] non" });
    expect(asked).toEqual([]);
  });

  it("un hook d'extension qui plante n'autorise rien (D28)", async () => {
    const { arbiter } = setup("allow-once", [{ check: async () => Promise.reject(new Error("boum")) }]);
    expect(await arbiter.check({ kind: "write", toolName: "edit", path: "src/a.ts" })).toMatchObject({ decision: "deny" });
  });

  it("autorisé par le cœur et les extensions : pas de question", async () => {
    const { arbiter, asked } = setup();
    expect(await arbiter.check({ kind: "write", toolName: "edit", path: "src/a.ts" })).toEqual({ decision: "allow" });
    expect(asked).toEqual([]);
  });

  it("demande à l'écran en dernier ; « toujours autoriser » mémorise une règle", async () => {
    const { arbiter, asked, rules } = setup("allow-always");
    expect(await arbiter.check(shell("npm test"))).toEqual({ decision: "allow" });
    expect(await rules.list()).toEqual([{ kind: "shell", value: "npm test" }]);
    expect(await arbiter.check(shell("npm test"))).toEqual({ decision: "allow" });
    expect(asked).toHaveLength(1);
    expect(await arbiter.check(shell("npm run build"))).toEqual({ decision: "allow" });
    expect(asked).toHaveLength(2);
  });

  it("règle mémorisée pour un domaine web", async () => {
    const { arbiter, asked } = setup("allow-always");
    await arbiter.check({ kind: "url", toolName: "fetch", url: "https://docs.example.com/a" });
    await arbiter.check({ kind: "url", toolName: "fetch", url: "https://docs.example.com/b" });
    expect(asked).toHaveLength(1);
  });

  it("refus de l'utilisateur ; confirmation en erreur = refus", async () => {
    expect(await setup("deny").arbiter.check(shell("npm test"))).toMatchObject({ decision: "deny" });
    const failing = createPermissionArbiter({
      root: ROOT,
      confirmer: { confirm: async () => Promise.reject(new Error("fenêtre fermée")) },
      rules: createMemoryPermissionRules(),
      extensionGuards: () => [],
    });
    expect(await failing.check(shell("npm test"))).toMatchObject({ decision: "deny" });
  });

  it("une règle mémorisée ne contourne jamais un refus d'extension", async () => {
    const { arbiter, rules } = setup("allow-once", [{ check: async () => ({ decision: "deny", reason: "non" }) }]);
    await rules.add({ kind: "shell", value: "npm test" });
    expect(await arbiter.check(shell("npm test"))).toMatchObject({ decision: "deny" });
  });
});
