/**
 * Relais MCP d'une session (ADR 0070) : un serveur MCP HTTP local, servi par notre processus, que
 * `claude -p` appelle pour nos outils et pour chaque demande de permission. Piloté ici par un vrai
 * client MCP HTTP, sans Claude.
 */
import type { GuardDecision, ToolCallGuard, ToolCallRequest, ToolSpec } from "@agent-studio/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { createRelais, type Relais } from "../src/relais.js";

const relais: Relais[] = [];
afterEach(async () => {
  for (const r of relais.splice(0)) await r.fermer();
});

async function ouvrir(o: { outils?: ToolSpec[]; garde?: ToolCallGuard; delaiGardeMs?: number } = {}) {
  const decisions: { req: ToolCallRequest; d: GuardDecision }[] = [];
  const terminaux: string[] = [];
  const r = await createRelais({
    outils: o.outils ?? [],
    garde: o.garde ?? { check: async () => ({ decision: "allow" }) },
    ...(o.delaiGardeMs !== undefined ? { delaiGardeMs: o.delaiGardeMs } : {}),
    surDecision: (req, d) => decisions.push({ req, d }),
    surTerminal: (nom) => terminaux.push(nom),
  });
  relais.push(r);
  const client = new Client({ name: "essai", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(r.url), { requestInit: { headers: { Authorization: `Bearer ${r.jeton}` } } }));
  const appel = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { r, client, appel, decisions, terminaux };
}

const outil = (name: string, handler: ToolSpec["handler"], terminal = false): ToolSpec => ({
  name,
  description: `outil ${name}`,
  parameters: { type: "object", properties: { x: { type: "string" } }, additionalProperties: false },
  ...(terminal ? { terminal: true } : {}),
  handler,
});

describe("Relais MCP d'une session (ADR 0070)", () => {
  it("sert nos outils avec leur schéma, et l'outil de permission ; sans le jeton, rien", async () => {
    const o = await ouvrir({ outils: [outil("report_phase", async () => "ok")] });
    const { tools } = await o.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["permission", "report_phase"]);
    expect(tools.find((t) => t.name === "report_phase")!.inputSchema).toMatchObject({ type: "object", properties: { x: { type: "string" } } });
    expect((await fetch(o.r.url, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await fetch(o.r.url, { method: "POST", body: "{}", headers: { Authorization: "Bearer faux" } })).status).toBe(401);
    // Seulement sur la boucle locale.
    expect(new URL(o.r.url).hostname).toBe("127.0.0.1");
  });

  it("un appel d'outil va au handler ; son résultat revient en texte ; une exception devient une erreur de l'outil", async () => {
    const recus: unknown[] = [];
    const o = await ouvrir({
      outils: [outil("run_tests", async (a) => (recus.push(a), { verts: 3 })), outil("casse", async () => { throw new Error("disque plein"); })],
    });
    expect(await o.appel("run_tests", { x: "u" })).toMatchObject({ content: [{ text: JSON.stringify({ verts: 3 }) }] });
    expect(recus).toEqual([{ x: "u" }]);
    expect(await o.appel("casse", {})).toMatchObject({ isError: true, content: [{ text: "disque plein" }] });
  });

  it("un outil terminal réussi est signalé : le runtime clôt le tour (D18) ; un échec ne l'est pas", async () => {
    let echoue = true;
    const o = await ouvrir({ outils: [outil("report_phase", async () => { if (echoue) throw new Error("schéma"); return "ok"; }, true)] });
    await o.appel("report_phase", {});
    expect(o.terminaux).toEqual([]);
    echoue = false;
    await o.appel("report_phase", {});
    expect(o.terminaux).toEqual(["report_phase"]);
  });

  it("permission : la garde décide sur la demande normalisée ; accord avec l'entrée, ou refus avec la raison ; chaque décision est signalée", async () => {
    const o = await ouvrir({ garde: { check: async (req) => (req.path?.includes("interdit") ? { decision: "deny", reason: "hors périmètre" } : { decision: "allow" }) } });
    const oui = await o.appel("permission", { tool_name: "Write", input: { file_path: "src/a.ts", content: "x" }, tool_use_id: "t1" });
    expect(JSON.parse(oui.content[0]!.text)).toEqual({ behavior: "allow", updatedInput: { file_path: "src/a.ts", content: "x" } });
    const non = await o.appel("permission", { tool_name: "Write", input: { file_path: "interdit/b.ts" } });
    expect(JSON.parse(non.content[0]!.text)).toEqual({ behavior: "deny", message: "hors périmètre" });
    expect(o.decisions.map((x) => [x.req.kind, x.req.path, x.d.decision])).toEqual([["write", "src/a.ts", "allow"], ["write", "interdit/b.ts", "deny"]]);
  });

  it("garde qui plante ou dépasse son délai : refus par précaution (D28)", async () => {
    const plante = await ouvrir({ garde: { check: async () => { throw new Error("boum"); } } });
    expect(JSON.parse((await plante.appel("permission", { tool_name: "Write", input: { file_path: "a" } })).content[0]!.text)).toMatchObject({ behavior: "deny", message: expect.stringMatching(/Garde indisponible/) });
    const lente = await ouvrir({ garde: { check: () => new Promise(() => {}) }, delaiGardeMs: 50 });
    expect(JSON.parse((await lente.appel("permission", { tool_name: "Write", input: { file_path: "a" } })).content[0]!.text)).toMatchObject({ behavior: "deny", message: expect.stringMatching(/délai dépassé/) });
  });

  it("configuration MCP pour le CLI : notre serveur en HTTP, avec le jeton", async () => {
    const o = await ouvrir();
    expect(o.r.configuration("agent-studio")).toEqual({ mcpServers: { "agent-studio": { type: "http", url: o.r.url, headers: { Authorization: `Bearer ${o.r.jeton}` } } } });
  });
});
