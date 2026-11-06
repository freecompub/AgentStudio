/**
 * Traduction du flux `--output-format stream-json` de `claude -p` en événements du port (ADR 0070).
 * Le flux répète l'usage d'un même message pour chacun de ses blocs : il n'est compté qu'une fois
 * par message. Toute ligne non reconnue réarme le chien de garde, sans erreur.
 */
import type { AgentEvent } from "@agent-studio/core";

type Ligne = Record<string, unknown>;
const objet = (v: unknown): Ligne | null => (v && typeof v === "object" ? (v as Ligne) : null);
const nombre = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

export function createTraducteur(): (ligne: unknown) => AgentEvent[] {
  const messagesComptes = new Set<string>();
  let modele: string | undefined;

  function assistant(m: Ligne): AgentEvent[] {
    const out: AgentEvent[] = [];
    if (typeof m["model"] === "string") modele = m["model"];
    for (const c of Array.isArray(m["content"]) ? m["content"] : []) {
      const b = objet(c);
      if (!b) continue;
      if (b["type"] === "text" && typeof b["text"] === "string") out.push({ type: "message", text: b["text"] });
      else if (b["type"] === "thinking" && typeof b["thinking"] === "string") out.push({ type: "reasoning", text: b["thinking"] });
      else if (b["type"] === "tool_use") out.push({ type: "tool-start", toolCallId: String(b["id"]), toolName: String(b["name"]) });
    }
    const u = objet(m["usage"]);
    const id = typeof m["id"] === "string" ? m["id"] : undefined;
    if (u && id && !messagesComptes.has(id)) {
      messagesComptes.add(id);
      const entree = (nombre(u["input_tokens"]) ?? 0) + (nombre(u["cache_read_input_tokens"]) ?? 0) + (nombre(u["cache_creation_input_tokens"]) ?? 0);
      out.push({ type: "usage", ...(modele ? { model: modele } : {}), inputTokens: entree, outputTokens: nombre(u["output_tokens"]) ?? 0 });
    }
    return out.length ? out : [{ type: "activity" }];
  }

  function resultatsOutils(m: Ligne): AgentEvent[] {
    const out: AgentEvent[] = [];
    for (const c of Array.isArray(m["content"]) ? m["content"] : []) {
      const b = objet(c);
      if (!b || b["type"] !== "tool_result") continue;
      const echec = b["is_error"] === true;
      const texte = typeof b["content"] === "string" ? b["content"] : JSON.stringify(b["content"] ?? "");
      out.push({ type: "tool-end", toolCallId: String(b["tool_use_id"]), success: !echec, ...(echec ? { error: { message: texte.slice(0, 2_000) } } : {}) });
    }
    return out.length ? out : [{ type: "activity" }];
  }

  function resultat(r: Ligne): AgentEvent[] {
    const cout = nombre(r["total_cost_usd"]);
    const usage: AgentEvent[] = cout !== undefined ? [{ type: "usage", ...(modele ? { model: modele } : {}), costUsd: cout }] : [];
    if (r["is_error"] === true || (typeof r["subtype"] === "string" && r["subtype"] !== "success")) {
      const raisons = Array.isArray(r["errors"]) ? r["errors"].map(String) : typeof r["result"] === "string" ? [r["result"]] : [];
      return [...usage, { type: "error", message: `claude -p : ${String(r["subtype"] ?? "erreur")}${raisons.length ? ` — ${raisons.join(" ; ")}` : ""}` }];
    }
    return [...usage, { type: "idle" }];
  }

  return (brut) => {
    const l = objet(brut);
    if (!l) return [{ type: "activity" }];
    const m = objet(l["message"]);
    if (l["type"] === "assistant" && m) return assistant(m);
    if (l["type"] === "user" && m) return resultatsOutils(m);
    if (l["type"] === "result") return resultat(l);
    return [{ type: "activity" }];
  };
}
