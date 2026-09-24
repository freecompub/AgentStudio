import { describe, expect, it } from "vitest";
import { createTaskAgentGuard } from "../src/guards/task-agent-guard.js";

const ROOT = "/projets/demo";
const guard = createTaskAgentGuard({ root: ROOT, writable: ["tests/**"] });

describe("Garde des agents de tâche (périmètre par rôle, §8.4)", () => {
  it("écriture dans le périmètre : autorisée (chemin relatif ou absolu)", async () => {
    expect(await guard.check({ kind: "write", toolName: "edit", path: "tests/a.test.ts" })).toEqual({ decision: "allow" });
    expect(await guard.check({ kind: "write", toolName: "edit", path: "/projets/demo/tests/b.ts" })).toEqual({ decision: "allow" });
  });

  it("écriture hors périmètre : refus avec le périmètre autorisé dans le motif", async () => {
    const r = await guard.check({ kind: "write", toolName: "edit", path: "src/a.ts" });
    expect(r).toEqual({ decision: "deny", reason: expect.stringContaining("tests/**") });
    expect(r).toEqual({ decision: "deny", reason: expect.stringContaining("src/a.ts") });
  });

  it.each(["../x/tests/a.ts", "/tmp/tests/a.ts", "tests/../src/a.ts"])("évasion refusée : %s", async (path) => {
    expect(await guard.check({ kind: "write", toolName: "edit", path })).toMatchObject({ decision: "deny" });
  });

  it("lecture seule (aucun périmètre) : toute écriture refusée", async () => {
    const ro = createTaskAgentGuard({ root: ROOT, writable: [] });
    expect(await ro.check({ kind: "write", toolName: "edit", path: "tests/a.ts" })).toMatchObject({ decision: "deny" });
  });

  it("lecture dans le projet autorisée, hors projet refusée", async () => {
    expect(await guard.check({ kind: "read", toolName: "view", path: "src/a.ts" })).toEqual({ decision: "allow" });
    expect(await guard.check({ kind: "read", toolName: "view", path: "/etc/passwd" })).toMatchObject({ decision: "deny" });
  });

  it("shell, réseau et MCP refusés : les tests sont lancés par l'orchestrateur", async () => {
    expect(await guard.check({ kind: "shell", toolName: "bash", command: "npm test" })).toEqual({
      decision: "deny",
      reason: expect.stringMatching(/orchestrateur/),
    });
    expect(await guard.check({ kind: "url", toolName: "fetch", url: "https://x" })).toMatchObject({ decision: "deny" });
    expect(await guard.check({ kind: "mcp", toolName: "x/y" })).toMatchObject({ decision: "deny" });
    expect(await guard.check({ kind: "other", toolName: "memory" })).toMatchObject({ decision: "deny" });
  });

  it("nos outils restent autorisés", async () => {
    expect(await guard.check({ kind: "custom-tool", toolName: "report_phase" })).toEqual({ decision: "allow" });
  });
});
