/**
 * RPC bridé entre le principal et un hôte d'extension (§4.1) : requête/réponse avec identifiant,
 * annulation, délai par appel ; messages sérialisables uniquement (aucun objet vivant ne traverse).
 */
export type RpcMessage =
  | { t: "call"; id: number; method: string; args: unknown[] }
  | { t: "ok"; id: number; value: unknown }
  | { t: "err"; id: number; error: { name: string; message: string } }
  | { t: "abort"; id: number };

/** Canal de messages (MessagePort d'un utilityProcess, IPC d'un processus Node, canal en mémoire). */
export interface MessageChannelLike {
  send(msg: RpcMessage): void;
  onMessage(cb: (msg: RpcMessage) => void): () => void;
}
