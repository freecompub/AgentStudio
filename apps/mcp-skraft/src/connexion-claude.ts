/**
 * Connexion au runtime Claude (ADR 0070), lue par `claude auth status` (`etatConnexionClaude`, commun
 * avec l'application). Elle est interactive (navigateur) : le serveur ne la mène pas, il dit quoi
 * taper. Aucun secret ne passe par ici.
 */
import type { AgentRuntime } from "@agent-studio/core";
import { etatConnexionClaude, type LanceurClaude } from "@agent-studio/runtime-claude";
import { runtimeParesseux } from "./connexion.js";

export function createConnexionClaude(d: Pick<LanceurClaude, "statut">) {
  const verifier = async (): Promise<{ ok: true } | { ok: false; motif: string }> => {
    const s = await etatConnexionClaude(d);
    if (s.etat === "absent") return { ok: false, motif: "Claude Code (claude) introuvable : installe-le, connecte-toi, puis réessaie." };
    return s.etat === "connecte" ? { ok: true } : { ok: false, motif: "Claude est non connecté : appelle skraft_connexion pour savoir comment te connecter." };
  };
  return {
    verifier,
    async connecter(): Promise<{ ok: boolean; texte: string }> {
      const s = await etatConnexionClaude(d);
      if (s.etat === "absent") return { ok: false, texte: "Claude Code (claude) introuvable : installe-le, puis lance `claude auth login` dans un terminal." };
      if (s.etat === "connecte") return { ok: true, texte: `Déjà connecté à Claude${s.methode ? ` (${s.methode})` : ""}.` };
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
