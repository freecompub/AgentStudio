/**
 * Runtime du processus enfant d'un workflow : charge le script compilé dans le bac à sable, puis
 * rejoue le journal à la demande du principal. Il n'exécute aucun effet : les appels `w.*` sont
 * rendus au principal comme effets à exécuter (`docs/09` §6).
 */
import { createRpcEndpoint, type MessageChannelLike, type RpcEndpoint } from "@agent-studio/extension-host";
import type { EntreeOutil, EtatWorkflow, OutilsWorkflow, ScriptWorkflow } from "../protocols.js";
import { rejouer } from "../rejeu.js";
import { evaluerScript } from "./bac-a-sable.js";

export function lancerEnfantWorkflow(canal: MessageChannelLike): RpcEndpoint {
  let script: ScriptWorkflow<never> | null = null;
  let outils: OutilsWorkflow = {};
  const rpc: RpcEndpoint = createRpcEndpoint(canal, {
    async charger([code]) {
      ({ script, outils } = evaluerScript(String(code)));
      return null;
    },
    // Un outil apporté par le workflow (ADR 0082) : fonction pure, sur les fichiers lus par l'hôte.
    async outil([nom, entree]) {
      const f = outils[String(nom)];
      if (!f) throw new Error(`outil ${String(nom)} non exporté par le script (export const outils)`);
      // La lecture à la demande est servie par le principal : l'enfant n'a aucun accès au disque.
      const lire = async (chemin: string) => ((await rpc.call("lire", [chemin], { timeoutMs: 30_000 })) as string | undefined) ?? null;
      return String(await f({ ...(entree as Omit<EntreeOutil, "lire">), lire }));
    },
    async rejouer([etat, opts]) {
      if (!script) throw new Error("aucun script chargé");
      const e = etat as EtatWorkflow;
      const o = (opts ?? {}) as { agents?: string[] };
      const nouveaux = await rejouer({ nom: e.script.nom, script, ...(o.agents ? { agents: o.agents } : {}) }, e);
      return { etat: e, nouveaux };
    },
  });
  return rpc;
}
