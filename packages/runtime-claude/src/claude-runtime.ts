/**
 * Adaptateur `AgentRuntime` pour Claude par le CLI (`claude -p`, ADR 0070). Un processus par tour ;
 * nos outils et la garde passent par un relais MCP HTTP local (`relais.ts`) ; le flux `stream-json`
 * devient nos événements (`evenements.ts`). Rien de Claude ne sort de ce paquet (D10).
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, AgentRuntime, AgentSession, AgentSessionConfig, Logger, ToolCallRequest } from "@agent-studio/core";
import { argumentsDuTour, nomMcp } from "./arguments.js";
import { createTraducteur } from "./evenements.js";
import type { LanceurClaude, ProcessusClaude } from "./protocols.js";
import { createRelais } from "./relais.js";

export interface ClaudeRuntimeDeps {
  lanceur: LanceurClaude;
  logger?: Logger;
  /** Plafond de coût d'un tour, en dollars (`--max-budget-usd`). */
  budgetUsdParTour?: number;
  /** Après un outil terminal réussi, délai laissé au CLI pour finir avant de l'arrêter (D18). */
  delaiApresTerminalMs?: number;
}

/** Nom de notre serveur MCP dans la configuration donnée au CLI. */
const SERVEUR = "agent-studio";

const cible = (r: ToolCallRequest): string | undefined => r.command ?? r.path ?? r.url;

export function createClaudeRuntime(deps: ClaudeRuntimeDeps): AgentRuntime {
  const { lanceur, logger } = deps;
  const ouvertes = new Set<AgentSession>();

  async function session(id: string, cfg: AgentSessionConfig, dejaCreee: boolean): Promise<AgentSession> {
    const ecouteurs = new Set<(e: AgentEvent) => void>();
    const emettre = (e: AgentEvent) => {
      for (const l of [...ecouteurs]) l(e);
    };
    let enCours: ProcessusClaude | null = null;
    let terminal = false;
    // Clôture du tour en cours, appelée dès qu'un outil terminal réussit (D18).
    let clore: (() => void) | null = null;
    const relais = await createRelais({
      outils: cfg.tools,
      garde: cfg.guard,
      ...(cfg.guardTimeoutMs !== undefined ? { delaiGardeMs: cfg.guardTimeoutMs } : {}),
      surDecision: (req, d) => {
        emettre({ type: "permission", kind: req.kind, toolName: req.toolName, ...(cible(req) !== undefined ? { target: cible(req)! } : {}), decision: d.decision, ...(d.decision === "deny" ? { reason: d.reason } : {}) });
        if (d.decision === "deny") {
          logger?.info("outil refusé", { role: cfg.role, toolName: req.toolName, kind: req.kind, cible: cible(req), reason: d.reason });
          emettre({ type: "tool-denied", toolName: req.toolName, reason: d.reason });
        }
      },
      surTerminal: () => {
        terminal = true;
        clore?.();
      },
    });
    // Fichiers du tour : prompt système et configuration MCP (qui porte le jeton), lisibles par nous seuls.
    const dossier = await mkdtemp(join(tmpdir(), "agent-studio-claude-"));
    const fichierPrompt = join(dossier, "prompt.md");
    const fichierMcp = join(dossier, "mcp.json");
    const noms = cfg.tools.map((t) => `\`${t.name}\` s'appelle \`${nomMcp(SERVEUR, t.name)}\``).join(", ");
    await writeFile(fichierPrompt, `${cfg.systemPrompt}${noms ? `\n\nNoms des outils d'agent-studio dans cette session : ${noms}.` : ""}`, { mode: 0o600 });
    await writeFile(fichierMcp, JSON.stringify(relais.configuration(SERVEUR)), { mode: 0o600 });
    let tours = dejaCreee ? 1 : 0;

    const s: AgentSession = {
      id,
      async send(prompt) {
        const args = argumentsDuTour({
          fichierPrompt,
          fichierMcp,
          serveur: SERVEUR,
          outils: cfg.tools.map((t) => t.name),
          sessionId: id,
          reprise: tours > 0,
          ...(cfg.model ? { modele: cfg.model } : {}),
          ...(deps.budgetUsdParTour !== undefined ? { budgetUsd: deps.budgetUsdParTour } : {}),
        });
        tours++;
        terminal = false;
        const traduire = createTraducteur();
        let fini = false;
        let resultat = false;
        let attente: ReturnType<typeof setTimeout> | undefined;
        const finir = (e: AgentEvent) => {
          if (fini) return;
          fini = true;
          clearTimeout(attente);
          emettre(e);
        };
        const p = lanceur.lancer({ args, cwd: cfg.workingDirectory, entree: prompt });
        enCours = p;
        // Outil terminal réussi (D18) : le tour est fini. On attend encore la ligne finale, qui porte
        // le coût du tour (essai du 06/11 : arrêté aussitôt, le CLI ne l'écrivait jamais) ; à défaut,
        // passé le délai, le tour est clos et le CLI arrêté.
        clore = () => {
          if (fini || attente) return;
          attente = setTimeout(() => {
            finir({ type: "idle" });
            p.tuer();
          }, deps.delaiApresTerminalMs ?? 5_000);
          attente.unref?.();
        };
        p.surLigne((ligne) => {
          let brut: unknown = null;
          try {
            brut = JSON.parse(ligne);
          } catch {
            /* ligne non JSON : simple signe de vie */
          }
          for (const e of traduire(brut)) {
            if (e.type === "idle" || e.type === "error") {
              resultat = true;
              finir(e);
            } else if (!fini) emettre(e);
          }
        });
        p.surFin((code, erreur) => {
          if (enCours === p) enCours = null;
          if (terminal) return finir({ type: "idle" });
          if (!resultat) finir({ type: "error", message: `claude -p s'est arrêté sans résultat (code ${code ?? "tué"})${erreur ? ` : ${erreur.trim().slice(-500)}` : ""}` });
        });
      },
      onEvent(cb) {
        ecouteurs.add(cb);
        return () => ecouteurs.delete(cb);
      },
      async abort() {
        enCours?.tuer();
      },
      async close() {
        enCours?.tuer();
        ecouteurs.clear();
        ouvertes.delete(s);
        await relais.fermer();
        await rm(dossier, { recursive: true, force: true });
      },
    };
    ouvertes.add(s);
    return s;
  }

  return {
    id: "claude-agent-sdk",
    capabilities: {
      inProcessHooks: true,
      customTools: "mcp",
      terminalTool: "native",
      fileMediation: false,
      usageUnit: "tokens",
      resumableSessions: true,
    },
    async listModels() {
      return [];
    },
    async start() {
      try {
        const v = await lanceur.version();
        logger?.info("runtime Claude prêt", { version: v });
      } catch (e) {
        throw new Error(`Claude Code (claude) introuvable ou inutilisable : installe-le et connecte-toi (\`claude\`), puis relance. (${e instanceof Error ? e.message : String(e)})`);
      }
    },
    async stop() {
      for (const s of [...ouvertes]) await s.close();
    },
    openSession: (cfg) => session(randomUUID(), cfg, false),
    resumeSession: (id, cfg) => session(id, cfg, true),
    // Les sessions du CLI restent dans son dossier de données ; rien à libérer de notre côté.
    async deleteSession() {},
  };
}
