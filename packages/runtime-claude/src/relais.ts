/**
 * Relais MCP d'une session (ADR 0070) : un serveur MCP HTTP sur la boucle locale, servi par notre
 * processus, que `claude -p` appelle pour nos outils (`ToolSpec`) et pour chaque demande de
 * permission. Protégé par un jeton tiré au hasard ; un serveur par session, car les outils et la
 * garde changent d'un rôle à l'autre.
 */
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { decideSafely, type GuardDecision, type ToolCallGuard, type ToolCallRequest, type ToolSpec } from "@agent-studio/core";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { OUTIL_PERMISSION } from "./arguments.js";
import { reponsePermission, versDemande } from "./permissions.js";

export interface OptionsRelais {
  outils: readonly ToolSpec[];
  garde: ToolCallGuard;
  delaiGardeMs?: number;
  /** Chaque décision de la garde, autorisée comme refusée (ADR 0032). */
  surDecision?(req: ToolCallRequest, d: GuardDecision): void;
  /** Un outil terminal a réussi : le tour est fini (D18). */
  surTerminal?(nom: string): void;
}

export interface Relais {
  url: string;
  jeton: string;
  /** Configuration à donner au CLI (`--mcp-config`). */
  configuration(serveur: string): { mcpServers: Record<string, { type: "http"; url: string; headers: Record<string, string> }> };
  fermer(): Promise<void>;
}

const SCHEMA_PERMISSION = {
  type: "object",
  properties: { tool_name: { type: "string" }, input: {}, tool_use_id: { type: "string" } },
  required: ["tool_name"],
} as const;

const texte = (t: string, erreur = false) => ({ content: [{ type: "text" as const, text: t }], ...(erreur ? { isError: true } : {}) });

export async function createRelais(o: OptionsRelais): Promise<Relais> {
  const jeton = randomBytes(24).toString("hex");

  function serveurMcp(): Server {
    const s = new Server({ name: "agent-studio", version: "0.0.0" }, { capabilities: { tools: {} } });
    s.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        ...o.outils.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters as { type: "object" } })),
        { name: OUTIL_PERMISSION, description: "Décision de permission d'agent-studio, appelée par le CLI.", inputSchema: SCHEMA_PERMISSION },
      ],
    }));
    s.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name, arguments: args = {} } = req.params;
      if (name === OUTIL_PERMISSION) {
        const a = args as { tool_name?: unknown; input?: unknown };
        const demande = versDemande(String(a.tool_name ?? ""), a.input);
        const d = await decideSafely(o.garde, demande, o.delaiGardeMs);
        o.surDecision?.(demande, d);
        return texte(reponsePermission(d, a.input));
      }
      const t = o.outils.find((x) => x.name === name);
      if (!t) return texte(`Outil inconnu : ${name}`, true);
      try {
        const r = await t.handler(args);
        if (t.terminal) o.surTerminal?.(t.name);
        return texte(typeof r === "string" ? r : JSON.stringify(r ?? null));
      } catch (e) {
        return texte(e instanceof Error ? e.message : String(e), true);
      }
    });
    return s;
  }

  const lire = (req: IncomingMessage) =>
    new Promise<unknown>((resolve, reject) => {
      let corps = "";
      req.setEncoding("utf8");
      req.on("data", (c: string) => (corps += c));
      req.on("end", () => {
        try {
          resolve(corps ? JSON.parse(corps) : undefined);
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", reject);
    });

  const http = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${jeton}`) {
      res.writeHead(401).end();
      return;
    }
    // Sans état : un serveur MCP neuf par requête, comme le permet le transport HTTP.
    const transport = new StreamableHTTPServerTransport({});
    res.on("close", () => void transport.close());
    void (async () => {
      try {
        await serveurMcp().connect(transport);
        await transport.handleRequest(req, res, await lire(req));
      } catch {
        if (!res.headersSent) res.writeHead(400).end();
      }
    })();
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;

  return {
    url,
    jeton,
    configuration: (serveur) => ({ mcpServers: { [serveur]: { type: "http", url, headers: { Authorization: `Bearer ${jeton}` } } } }),
    fermer: () =>
      new Promise<void>((resolve) => {
        // Les connexions gardées ouvertes par le client retiendraient la fermeture.
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  };
}
