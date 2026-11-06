/**
 * Runtime Claude par le CLI (ADR 0070), piloté par un faux `claude -p` : il lit la configuration MCP
 * reçue et appelle vraiment le relais (permission, puis outil terminal), comme le CLI, puis écrit
 * des lignes `stream-json`. Aucun appel à Claude.
 */
import { readFileSync } from "node:fs";
import type { AgentEvent, AgentSessionConfig, GuardDecision, ToolCallRequest } from "@agent-studio/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { createClaudeRuntime } from "../src/claude-runtime.js";
import type { LanceurClaude, ProcessusClaude } from "../src/protocols.js";

type Script = (p: { args: string[]; entree: string; ecrire(l: unknown): void; outil(nom: string, a: Record<string, unknown>): Promise<string> }) => Promise<void>;

function fauxClaude(script: Script) {
  const lancements: { args: string[]; cwd: string; entree: string; prompt: string }[] = [];
  let tues = 0;
  const lanceur: LanceurClaude = {
    version: async () => "2.1.319 (Claude Code)",
    lancer({ args, cwd, entree }) {
      const surLigne: ((l: string) => void)[] = [];
      const surFin: ((code: number | null, erreur: string) => void)[] = [];
      let fini = false;
      const terminer = (code: number | null) => {
        if (fini) return;
        fini = true;
        for (const f of surFin) f(code, "");
      };
      const config = JSON.parse(readFileSync(args[args.indexOf("--mcp-config") + 1]!, "utf8")) as { mcpServers: Record<string, { url: string; headers: Record<string, string> }> };
      lancements.push({ args, cwd, entree, prompt: readFileSync(args[args.indexOf("--system-prompt-file") + 1]!, "utf8") });
      const serveur = Object.values(config.mcpServers)[0]!;
      const p: ProcessusClaude = {
        surLigne: (cb) => void surLigne.push(cb),
        surFin: (cb) => void surFin.push(cb),
        tuer: () => {
          tues++;
          terminer(null);
        },
      };
      void (async () => {
        const client = new Client({ name: "faux-claude", version: "0" });
        await client.connect(new StreamableHTTPClientTransport(new URL(serveur.url), { requestInit: { headers: serveur.headers } }));
        const ecrire = (l: unknown) => {
          if (!fini) for (const cb of surLigne) cb(JSON.stringify(l));
        };
        const outil = async (nom: string, a: Record<string, unknown>) => ((await client.callTool({ name: nom, arguments: a })) as { content: { text: string }[] }).content[0]!.text;
        await script({ args, entree, ecrire, outil });
        await client.close();
        terminer(0);
      })();
      return p;
    },
  };
  return { lanceur, lancements, tues: () => tues };
}

const tourOrdinaire: Script = async ({ ecrire, outil }) => {
  ecrire({ type: "system", subtype: "init", session_id: "x" });
  ecrire({ type: "assistant", message: { id: "m1", model: "claude-haiku-5-5", content: [{ type: "tool_use", id: "t1", name: "Write", input: { file_path: "src/a.ts" } }], usage: { input_tokens: 10, output_tokens: 2 } } });
  await outil("permission", { tool_name: "Write", input: { file_path: "src/a.ts", content: "x" } });
  ecrire({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } });
  ecrire({ type: "assistant", message: { id: "m2", model: "claude-haiku-5-5", content: [{ type: "text", text: "Fini." }], usage: { input_tokens: 12, output_tokens: 3 } } });
  ecrire({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.002 });
};

function config(o: Partial<AgentSessionConfig> & { decisions?: { req: ToolCallRequest; d: GuardDecision }[] } = {}): AgentSessionConfig {
  return {
    role: "essai",
    workingDirectory: "/projet",
    systemPrompt: "Tu es l'agent d'essai. Termine avec l'outil `report_phase`.",
    tools: [{ name: "report_phase", description: "fin", parameters: { type: "object" }, terminal: true, handler: async () => "ok" }],
    guard: { check: async (req) => (req.path?.startsWith("interdit") ? { decision: "deny", reason: "hors périmètre" } : { decision: "allow" }) },
    ...o,
  };
}

async function tour(rt: ReturnType<typeof createClaudeRuntime>, session: Awaited<ReturnType<ReturnType<typeof createClaudeRuntime>["openSession"]>>, prompt: string) {
  const evs: AgentEvent[] = [];
  const fin = new Promise<void>((resolve) => {
    const off = session.onEvent((e) => {
      evs.push(e);
      if (e.type === "idle" || e.type === "error") {
        off();
        resolve();
      }
    });
  });
  await session.send(prompt);
  await fin;
  void rt;
  return evs;
}

describe("Runtime Claude par le CLI (ADR 0070)", () => {
  it("un tour : prompt par l'entrée standard, prompt système par fichier (noms MCP de nos outils indiqués), événements traduits, permission décidée par la garde, puis idle", async () => {
    const f = fauxClaude(tourOrdinaire);
    const rt = createClaudeRuntime({ lanceur: f.lanceur });
    expect(rt.capabilities).toMatchObject({ customTools: "mcp", usageUnit: "tokens", resumableSessions: true });
    await rt.start();
    const s = await rt.openSession(config());
    const evs = await tour(rt, s, "Fais le travail.");
    expect(f.lancements[0]!.entree).toBe("Fais le travail.");
    expect(f.lancements[0]!.cwd).toBe("/projet");
    expect(f.lancements[0]!.prompt).toContain("Tu es l'agent d'essai.");
    expect(f.lancements[0]!.prompt).toContain("mcp__agent-studio__report_phase");
    expect(evs.map((e) => e.type)).toEqual(["activity", "tool-start", "usage", "permission", "tool-end", "message", "usage", "usage", "idle"]);
    expect(evs.find((e) => e.type === "permission")).toMatchObject({ kind: "write", target: "src/a.ts", decision: "allow" });
    await s.close();
    await rt.stop();
  });

  it("une permission refusée par la garde : refus au CLI, événements permission et tool-denied", async () => {
    const f = fauxClaude(async ({ ecrire, outil }) => {
      const r = await outil("permission", { tool_name: "Write", input: { file_path: "interdit/b.ts" } });
      ecrire({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t", is_error: true, content: JSON.parse(r).message }] } });
      ecrire({ type: "result", subtype: "success", total_cost_usd: 0 });
    });
    const rt = createClaudeRuntime({ lanceur: f.lanceur });
    const s = await rt.openSession(config());
    const evs = await tour(rt, s, "x");
    expect(evs).toContainEqual({ type: "permission", kind: "write", toolName: "Write", target: "interdit/b.ts", decision: "deny", reason: "hors périmètre" });
    expect(evs).toContainEqual({ type: "tool-denied", toolName: "Write", reason: "hors périmètre" });
    await s.close();
  });

  it("deux tours : le premier crée la session (--session-id), le second la reprend (--resume) ; resumeSession reprend d'emblée", async () => {
    const f = fauxClaude(async ({ ecrire }) => ecrire({ type: "result", subtype: "success" }));
    const rt = createClaudeRuntime({ lanceur: f.lanceur });
    const s = await rt.openSession(config({ model: "claude-sonnet-5" }));
    await tour(rt, s, "un");
    await tour(rt, s, "deux");
    const [a, b] = f.lancements;
    expect(a!.args[a!.args.indexOf("--session-id") + 1]).toBe(s.id);
    expect(b!.args[b!.args.indexOf("--resume") + 1]).toBe(s.id);
    expect(a!.args[a!.args.indexOf("--model") + 1]).toBe("claude-sonnet-5");
    const r = await rt.resumeSession(s.id, config());
    await tour(rt, r, "trois");
    expect(f.lancements[2]!.args).toContain("--resume");
    await s.close();
    await r.close();
  });

  it("outil terminal réussi : le tour est clos (D18) — processus arrêté, idle une seule fois", async () => {
    const f = fauxClaude(async ({ outil, ecrire }) => {
      await outil("report_phase", { summary: "fait" });
      // Le CLI continuerait (message de fin, etc.) : le runtime n'attend pas.
      await new Promise((r) => setTimeout(r, 2_000));
      ecrire({ type: "result", subtype: "success" });
    });
    const rt = createClaudeRuntime({ lanceur: f.lanceur, delaiApresTerminalMs: 20 });
    const s = await rt.openSession(config());
    const evs = await tour(rt, s, "x");
    expect(evs.filter((e) => e.type === "idle")).toHaveLength(1);
    // Le processus est arrêté juste après, une fois la réponse de l'outil partie.
    await new Promise((r) => setTimeout(r, 100));
    expect(f.tues()).toBe(1);
    await s.close();
  });

  it("outil terminal, puis résultat avant le délai : le coût de la ligne finale est gardé, sans arrêter le CLI", async () => {
    const f = fauxClaude(async ({ outil, ecrire }) => {
      await outil("report_phase", { summary: "fait" });
      ecrire({ type: "result", subtype: "success", total_cost_usd: 0.0031 });
    });
    const rt = createClaudeRuntime({ lanceur: f.lanceur, delaiApresTerminalMs: 2_000 });
    const s = await rt.openSession(config());
    const evs = await tour(rt, s, "x");
    expect(evs.filter((e) => e.type === "usage").at(-1)).toMatchObject({ costUsd: 0.0031 });
    expect(evs.filter((e) => e.type === "idle")).toHaveLength(1);
    expect(f.tues()).toBe(0);
    await s.close();
  });

  it("processus qui s'arrête sans résultat : error, avec le code ; abort : processus arrêté", async () => {
    const f = fauxClaude(async () => {});
    const rt = createClaudeRuntime({ lanceur: f.lanceur });
    const s = await rt.openSession(config());
    const evs = await tour(rt, s, "x");
    expect(evs.at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/claude -p s'est arrêté sans résultat \(code 0\)/) });
    const g = fauxClaude(async () => new Promise((r) => setTimeout(r, 5_000)));
    const rt2 = createClaudeRuntime({ lanceur: g.lanceur });
    const s2 = await rt2.openSession(config());
    await s2.send("long");
    await s2.abort();
    expect(g.tues()).toBe(1);
    await s.close();
    await s2.close();
  });

  it("CLI absent ou illisible : start échoue avec un message qui dit quoi faire", async () => {
    const rt = createClaudeRuntime({ lanceur: { version: async () => { throw new Error("ENOENT"); }, lancer: () => { throw new Error("non"); } } });
    await expect(rt.start()).rejects.toThrow(/Claude Code \(claude\) introuvable/);
  });
});
