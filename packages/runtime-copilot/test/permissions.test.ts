import type { PermissionRequest } from "@github/copilot-sdk";
import type { ToolCallGuard, ToolCallRequest } from "@agent-studio/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPermissionHandler } from "../src/permissions/permission-handler.js";
import { toToolCallRequest } from "../src/permissions/to-tool-call-request.js";

const req = (r: Record<string, unknown>) => r as unknown as PermissionRequest;
const invocation = { sessionId: "s1" };

describe("toToolCallRequest", () => {
  it("écriture : chemin résolu en priorité", () => {
    expect(toToolCallRequest(req({ kind: "write", fileName: "a.ts", resolvedPath: "/p/a.ts", diff: "", intention: "" }))).toEqual({
      kind: "write",
      toolName: "write",
      path: "/p/a.ts",
    });
  });

  it("lecture", () => {
    expect(toToolCallRequest(req({ kind: "read", path: "src/a.ts", intention: "" }))).toEqual({
      kind: "read",
      toolName: "read",
      path: "src/a.ts",
    });
  });

  it("shell : ligne de commande complète", () => {
    expect(toToolCallRequest(req({ kind: "shell", fullCommandText: "npm test", intention: "" }))).toEqual({
      kind: "shell",
      toolName: "shell",
      command: "npm test",
    });
  });

  it("url, mcp, outil maison", () => {
    expect(toToolCallRequest(req({ kind: "url", url: "https://x.dev", intention: "" }))).toEqual({
      kind: "url",
      toolName: "url",
      url: "https://x.dev",
    });
    expect(toToolCallRequest(req({ kind: "mcp", serverName: "gh", toolName: "search", toolTitle: "", readOnly: true }))).toEqual({
      kind: "mcp",
      toolName: "gh/search",
    });
    expect(toToolCallRequest(req({ kind: "custom-tool", toolName: "report_phase", toolDescription: "" }))).toEqual({
      kind: "custom-tool",
      toolName: "report_phase",
    });
  });

  it("toute autre sorte est classée « other »", () => {
    expect(toToolCallRequest(req({ kind: "memory", fact: "x" }))).toEqual({ kind: "other", toolName: "memory" });
  });
});

describe("createPermissionHandler (D27, D28)", () => {
  afterEach(() => vi.useRealTimers());

  const guardOf = (check: ToolCallGuard["check"]): ToolCallGuard => ({ check });

  it("approuve une seule fois quand la garde autorise", async () => {
    const seen: ToolCallRequest[] = [];
    const h = createPermissionHandler(
      guardOf(async (r) => {
        seen.push(r);
        return { decision: "allow" };
      }),
    );
    expect(await h(req({ kind: "shell", fullCommandText: "ls", intention: "" }), invocation)).toEqual({ kind: "approve-once" });
    expect(seen[0]?.command).toBe("ls");
  });

  it("rejette avec le motif transmis à l'agent", async () => {
    const h = createPermissionHandler(guardOf(async () => ({ decision: "deny", reason: "hors périmètre" })));
    expect(await h(req({ kind: "write", fileName: "/etc/x", diff: "", intention: "" }), invocation)).toEqual({
      kind: "reject",
      feedback: "hors périmètre",
    });
  });

  it("une garde qui plante vaut refus", async () => {
    const h = createPermissionHandler(guardOf(async () => Promise.reject(new Error("boum"))));
    expect(await h(req({ kind: "read", path: "a", intention: "" }), invocation)).toMatchObject({ kind: "reject" });
  });

  it("une garde qui dépasse le délai vaut refus", async () => {
    vi.useFakeTimers();
    const h = createPermissionHandler(
      guardOf(() => new Promise(() => {})),
      { timeoutMs: 500 },
    );
    const decision = h(req({ kind: "read", path: "a", intention: "" }), invocation);
    await vi.advanceTimersByTimeAsync(500);
    expect(await decision).toMatchObject({ kind: "reject", feedback: expect.stringMatching(/délai/) });
  });

  it("notifie chaque refus pour l'afficher dans le journal", async () => {
    const denied: { toolName: string; reason: string }[] = [];
    const h = createPermissionHandler(guardOf(async () => ({ decision: "deny", reason: "non" })), {
      onDenied: (r, reason) => denied.push({ toolName: r.toolName, reason }),
    });
    await h(req({ kind: "shell", fullCommandText: "rm -rf /", intention: "" }), invocation);
    expect(denied).toEqual([{ toolName: "shell", reason: "non" }]);
  });
});
