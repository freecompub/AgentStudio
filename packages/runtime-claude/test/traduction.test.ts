/**
 * Briques pures du runtime Claude par le CLI (ADR 0070) : arguments d'un tour, traduction du flux
 * `stream-json` en événements du port, traduction des demandes de permission. Les flux sont de
 * vrais enregistrements de `claude -p` (Claude Code 2.1.319, essais du 06/11), chemins anonymisés.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentEvent } from "@agent-studio/core";
import { describe, expect, it } from "vitest";
import { argumentsDuTour, contexteLongPossible } from "../src/arguments.js";
import { createTraducteur } from "../src/evenements.js";
import { reponsePermission, versDemande } from "../src/permissions.js";

const flux = (nom: string) =>
  readFileSync(join(import.meta.dirname, "fixtures", nom), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as unknown);

describe("arguments d'un tour", () => {
  const base = { fichierPrompt: "/tmp/t/prompt.md", fichierMcp: "/tmp/t/mcp.json", serveur: "agent-studio", outils: ["report_phase", "run_tests"], sessionId: "s-1" };

  it("isolé : ni réglages, ni CLAUDE.md, ni skills, ni autres serveurs MCP ; flux JSON ; prompt système et MCP par fichier", () => {
    const a = argumentsDuTour({ ...base, reprise: false });
    expect(a.slice(0, 1)).toEqual(["-p"]);
    for (const [option, valeur] of [["--output-format", "stream-json"], ["--setting-sources", ""], ["--system-prompt-file", "/tmp/t/prompt.md"], ["--mcp-config", "/tmp/t/mcp.json"], ["--session-id", "s-1"]])
      expect(a[a.indexOf(option!) + 1]).toBe(valeur);
    for (const drapeau of ["--verbose", "--strict-mcp-config", "--disable-slash-commands"]) expect(a).toContain(drapeau);
    expect(a).not.toContain("--resume");
  });

  it("mémoire automatique de Claude Code coupée : sinon nos agents lisent celle des sessions de l'utilisateur sur ce dépôt (essai du 07/11)", () => {
    const a = argumentsDuTour({ ...base, reprise: false });
    expect(JSON.parse(a[a.indexOf("--settings") + 1]!)).toEqual({ autoMemoryEnabled: false });
  });

  it("outils intégrés sans Bash ; nos outils autorisés ; outil de permission caché au modèle et chargé des demandes", () => {
    const a = argumentsDuTour({ ...base, reprise: false });
    expect(a[a.indexOf("--tools") + 1]).toBe("Read,Write,Edit,Glob,Grep");
    expect(a.slice(a.indexOf("--allowedTools") + 1, a.indexOf("--allowedTools") + 3)).toEqual(["mcp__agent-studio__report_phase", "mcp__agent-studio__run_tests"]);
    expect(a[a.indexOf("--disallowedTools") + 1]).toBe("mcp__agent-studio__permission");
    expect(a[a.indexOf("--permission-prompt-tool") + 1]).toBe("mcp__agent-studio__permission");
    expect(a[a.indexOf("--permission-prompts") + 1]).toBe("host");
  });

  it("reprise : --resume au lieu de --session-id ; modèle et plafond de coût s'ils sont donnés", () => {
    const a = argumentsDuTour({ ...base, reprise: true, modele: "claude-sonnet-5", budgetUsd: 2 });
    expect(a[a.indexOf("--resume") + 1]).toBe("s-1");
    expect(a).not.toContain("--session-id");
    expect(a[a.indexOf("--model") + 1]).toBe("claude-sonnet-5");
    expect(a[a.indexOf("--max-budget-usd") + 1]).toBe("2");
  });

  it("effort élevé et alias Claude 1M sont demandés pour DESIGN", () => {
    const a = argumentsDuTour({ ...base, reprise: false, modele: "sonnet", reasoningEffort: "high", contextTier: "long_context" });
    expect(a[a.indexOf("--effort") + 1]).toBe("high");
    expect(a[a.indexOf("--model") + 1]).toBe("sonnet[1m]");
  });

  // Un modèle sans variante 1M connue garde son nom, sans `[1m]` : le tour part au lieu d'échouer
  // (ADR 0077), et le runtime le journalise (`contexteLongPossible`).
  it("un modèle sans variante 1M connue garde son nom ; le tour part quand même", () => {
    for (const modele of ["haiku", "claude-opus-5-5"]) {
      const a = argumentsDuTour({ ...base, reprise: false, modele, contextTier: "long_context" });
      expect(a[a.indexOf("--model") + 1]).toBe(modele);
    }
    expect(argumentsDuTour({ ...base, reprise: false, contextTier: "long_context" })).not.toContain("--model");
    expect(contexteLongPossible("sonnet")).toBe(true);
    expect(contexteLongPossible("opus[1m]")).toBe(true);
    expect(contexteLongPossible("haiku")).toBe(false);
    expect(contexteLongPossible(undefined)).toBe(false);
  });
});

describe("traduction du flux stream-json", () => {
  const traduire = (nom: string) => {
    const t = createTraducteur();
    return flux(nom).flatMap((l) => t(l));
  };

  it("appels d'outils et leurs résultats, refus compris, avec le message du refus", () => {
    const ev = traduire("stream-ecriture-refusee.jsonl");
    const debuts = ev.filter((e): e is Extract<AgentEvent, { type: "tool-start" }> => e.type === "tool-start");
    expect(debuts.map((e) => e.toolName)).toEqual(["Write", "Write", "mcp__spike__report_phase"]);
    const fins = ev.filter((e): e is Extract<AgentEvent, { type: "tool-end" }> => e.type === "tool-end");
    expect(fins.map((e) => e.success)).toEqual([true, false, true]);
    expect(fins[1]!.error?.message).toMatch(/Permission for this tool use was denied/);
    expect(fins.map((e) => e.toolCallId)).toEqual(debuts.map((e) => e.toolCallId));
  });

  it("usage compté une fois par message (le flux le répète pour chaque bloc), puis coût en dollars ; fin du tour : idle", () => {
    const ev = traduire("stream-ecriture-refusee.jsonl");
    const usages = ev.filter((e): e is Extract<AgentEvent, { type: "usage" }> => e.type === "usage");
    const parMessage = usages.filter((u) => u.inputTokens !== undefined);
    expect(parMessage.length).toBeLessThan(flux("stream-ecriture-refusee.jsonl").filter((l) => (l as { type: string }).type === "assistant").length);
    expect(usages.at(-1)).toMatchObject({ type: "usage", model: "claude-haiku-5-5", costUsd: 0.00145581 });
    expect(ev.at(-1)).toEqual({ type: "idle" });
    expect(ev.some((e) => e.type === "message" && e.text.startsWith("Les étapes 1, 2 et 4 sont faites"))).toBe(true);
  });

  it("toute autre ligne réarme le chien de garde ; une ligne illisible aussi, sans planter", () => {
    const t = createTraducteur();
    expect(t({ type: "rate_limit_event" })).toEqual([{ type: "activity" }]);
    expect(t({ type: "system", subtype: "thinking_tokens" })).toEqual([{ type: "activity" }]);
    expect(t(null)).toEqual([{ type: "activity" }]);
  });

  it("résultat en erreur (plafond de coût, tours épuisés…) : événement error, avec la raison", () => {
    const t = createTraducteur();
    expect(t({ type: "result", subtype: "error_max_budget_usd", is_error: true, total_cost_usd: 0.5, errors: ["budget dépassé"] })).toEqual([
      { type: "usage", costUsd: 0.5 },
      { type: "error", message: "claude -p : error_max_budget_usd — budget dépassé" },
    ]);
  });
});

describe("demandes de permission", () => {
  it("normalisées comme pour Copilot : écriture, lecture, shell, MCP", () => {
    expect(versDemande("Write", { file_path: "/projet/src/a.ts", content: "x" })).toMatchObject({ kind: "write", toolName: "Write", path: "/projet/src/a.ts" });
    expect(versDemande("Edit", { file_path: "src/a.ts", old_string: "a", new_string: "b" })).toMatchObject({ kind: "write", path: "src/a.ts" });
    expect(versDemande("Read", { file_path: "/etc/passwd" })).toMatchObject({ kind: "read", path: "/etc/passwd" });
    expect(versDemande("Grep", { pattern: "x", path: "src" })).toMatchObject({ kind: "read", path: "src" });
    expect(versDemande("Bash", { command: "rm -rf /" })).toMatchObject({ kind: "shell", command: "rm -rf /" });
    expect(versDemande("mcp__autre__outil", {})).toMatchObject({ kind: "mcp" });
    expect(versDemande("WebFetch", { url: "https://exemple.fr" })).toMatchObject({ kind: "url", url: "https://exemple.fr" });
    expect(versDemande("Inconnu", {})).toMatchObject({ kind: "other" });
  });

  it("réponse au CLI : accord avec l'entrée inchangée, ou refus avec la raison de la garde", () => {
    expect(JSON.parse(reponsePermission({ decision: "allow" }, { file_path: "a" }))).toEqual({ behavior: "allow", updatedInput: { file_path: "a" } });
    expect(JSON.parse(reponsePermission({ decision: "deny", reason: "hors périmètre" }, {}))).toEqual({ behavior: "deny", message: "hors périmètre" });
  });
});
