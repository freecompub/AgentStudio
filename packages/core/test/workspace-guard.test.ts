import { describe, expect, it } from "vitest";
import { createWorkspaceGuard } from "../src/guards/workspace-guard.js";
import type { ConfirmRequest } from "../src/protocols/interaction.js";

const ROOT = "/projets/demo";

function guardWith(answer: boolean) {
  const asked: ConfirmRequest[] = [];
  const guard = createWorkspaceGuard({
    root: ROOT,
    confirmer: {
      confirm: async (q) => {
        asked.push(q);
        return answer;
      },
    },
  });
  return { guard, asked };
}

describe("Garde de la session principale", () => {
  it.each(["src/a.ts", "/projets/demo/src/a.ts", "./README.md"])("autorise la lecture de %s", async (path) => {
    const { guard, asked } = guardWith(false);
    expect(await guard.check({ kind: "read", toolName: "view", path })).toEqual({ decision: "allow" });
    expect(asked).toHaveLength(0);
  });

  it.each(["../ailleurs/x", "/etc/passwd", "/projets/demo2/a"])("refuse la lecture hors du projet : %s", async (path) => {
    const { guard } = guardWith(true);
    expect(await guard.check({ kind: "read", toolName: "view", path })).toMatchObject({ decision: "deny" });
  });

  it("autorise l'écriture dans le projet", async () => {
    const { guard } = guardWith(false);
    expect(await guard.check({ kind: "write", toolName: "edit", path: "src/a.ts" })).toEqual({ decision: "allow" });
  });

  it.each(["../x", ".git/config", "/tmp/x"])("refuse l'écriture sur %s sans même demander", async (path) => {
    const { guard, asked } = guardWith(true);
    const r = await guard.check({ kind: "write", toolName: "edit", path });
    expect(r).toMatchObject({ decision: "deny" });
    expect(asked).toHaveLength(0);
  });

  it("refuse une écriture sans chemin", async () => {
    const { guard } = guardWith(true);
    expect(await guard.check({ kind: "write", toolName: "edit" })).toMatchObject({ decision: "deny" });
  });

  it.each([
    "git commit -am x",
    "git reset --hard HEAD~1",
    "cd src && git checkout -- .",
    "git push origin main",
    "git stash",
    "git rebase main",
    "git restore .",
    "git clean -fd",
  ])("refuse la commande Git « %s » : Git est réservé à l'application", async (command) => {
    const { guard, asked } = guardWith(true);
    const r = await guard.check({ kind: "shell", toolName: "bash", command });
    expect(r).toMatchObject({ decision: "deny" });
    expect(asked).toHaveLength(0);
  });

  it("demande confirmation pour une autre commande shell et suit la réponse", async () => {
    const yes = guardWith(true);
    expect(await yes.guard.check({ kind: "shell", toolName: "bash", command: "npm test" })).toEqual({ decision: "allow" });
    expect(yes.asked[0]?.detail).toContain("npm test");

    const no = guardWith(false);
    expect(await no.guard.check({ kind: "shell", toolName: "bash", command: "npm test" })).toMatchObject({
      decision: "deny",
      reason: expect.stringMatching(/refusé/),
    });
  });

  it("autorise les commandes Git en lecture seule sans demander", async () => {
    const { guard, asked } = guardWith(false);
    for (const command of ["git status", "git log --oneline -5", "git diff"]) {
      expect(await guard.check({ kind: "shell", toolName: "bash", command })).toEqual({ decision: "allow" });
    }
    expect(asked).toHaveLength(0);
  });

  it("demande confirmation pour un accès réseau et un outil MCP", async () => {
    const { guard, asked } = guardWith(true);
    await guard.check({ kind: "url", toolName: "fetch", url: "https://example.com" });
    await guard.check({ kind: "mcp", toolName: "github-search" });
    expect(asked.map((q) => q.detail)).toEqual([expect.stringContaining("example.com"), expect.stringContaining("github-search")]);
  });

  it("autorise nos propres outils", async () => {
    const { guard, asked } = guardWith(false);
    expect(await guard.check({ kind: "custom-tool", toolName: "task_status" })).toEqual({ decision: "allow" });
    expect(asked).toHaveLength(0);
  });

  it("une confirmation qui échoue vaut refus (D28)", async () => {
    const guard = createWorkspaceGuard({
      root: ROOT,
      confirmer: { confirm: async () => Promise.reject(new Error("fenêtre fermée")) },
    });
    expect(await guard.check({ kind: "shell", toolName: "bash", command: "ls" })).toMatchObject({ decision: "deny" });
  });
});
