/**
 * Connexion au runtime Claude (ADR 0070), lue par `claude auth status`. Elle est interactive
 * (navigateur) : le serveur ne la mène pas, il dit quoi taper. Aucun secret ne passe par ici.
 */
import { execFile } from "node:child_process";
import type { AgentRuntime } from "@agent-studio/core";
import { runtimeParesseux } from "./connexion.js";

/** Modèle par défaut de chaque classe de rôle (ADR 0048) avec Claude. */
export const MODELES_CLAUDE = { strong: "opus", standard: "sonnet", light: "haiku" } as const;

export interface DepsConnexionClaude {
  /** Sortie JSON de `claude auth status`. */
  statut(): Promise<unknown>;
}

export function statutClaude(commande = "claude"): () => Promise<unknown> {
  return () =>
    new Promise((resolve, reject) =>
      execFile(commande, ["auth", "status"], { timeout: 15_000 }, (err, stdout) => {
        if (err && !stdout) return reject(err);
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(e);
        }
      }),
    );
}

export function createConnexionClaude(d: DepsConnexionClaude) {
  async function lire(): Promise<{ connecte: boolean; methode?: string } | { absent: true }> {
    try {
      const s = (await d.statut()) as { loggedIn?: unknown; authMethod?: unknown };
      return { connecte: s?.loggedIn === true, ...(typeof s?.authMethod === "string" ? { methode: s.authMethod } : {}) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { absent: true };
      return { connecte: false };
    }
  }
  const verifier = async (): Promise<{ ok: true } | { ok: false; motif: string }> => {
    const s = await lire();
    if ("absent" in s) return { ok: false, motif: "Claude Code (claude) introuvable : installe-le, connecte-toi, puis réessaie." };
    return s.connecte ? { ok: true } : { ok: false, motif: "Claude est non connecté : appelle skraft_connexion pour savoir comment te connecter." };
  };
  return {
    verifier,
    async connecter(): Promise<{ ok: boolean; texte: string }> {
      const s = await lire();
      if ("absent" in s) return { ok: false, texte: "Claude Code (claude) introuvable : installe-le, puis lance `claude auth login` dans un terminal." };
      if (s.connecte) return { ok: true, texte: `Déjà connecté à Claude${s.methode ? ` (${s.methode})` : ""}.` };
      return { ok: false, texte: "Lance `claude auth login` dans un terminal et suis les instructions, puis rappelle skraft_connexion pour vérifier." };
    },
    /** Runtime démarré une fois connecté. */
    runtime: (creer: () => AgentRuntime) =>
      runtimeParesseux(verifier, async () => {
        const rt = creer();
        await rt.start();
        return rt;
      }),
  };
}
