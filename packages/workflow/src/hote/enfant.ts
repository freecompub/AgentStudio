/**
 * Runtime du processus enfant d'un workflow : charge le script compilé dans le bac à sable, puis
 * rejoue le journal à la demande du principal. Il n'exécute aucun effet : les appels `w.*` sont
 * rendus au principal comme effets à exécuter (`docs/09` §6).
 */
import { createRpcEndpoint, type MessageChannelLike, type RpcEndpoint } from "@agent-studio/extension-host";
import type { EtatWorkflow, ScriptWorkflow } from "../protocols.js";
import { rejouer } from "../rejeu.js";
import { evaluerScript } from "./bac-a-sable.js";

export function lancerEnfantWorkflow(canal: MessageChannelLike): RpcEndpoint {
  let script: ScriptWorkflow<never> | null = null;
  return createRpcEndpoint(canal, {
    async charger([code]) {
      script = evaluerScript(String(code)).script;
      return null;
    },
    async rejouer([etat, opts]) {
      if (!script) throw new Error("aucun script chargé");
      const e = etat as EtatWorkflow;
      const o = (opts ?? {}) as { humains?: Record<string, never[]>; agents?: string[] };
      const nouveaux = await rejouer({ nom: e.script.nom, script, ...(o.humains ? { humains: o.humains } : {}), ...(o.agents ? { agents: o.agents } : {}) }, e);
      return { etat: e, nouveaux };
    },
  });
}
