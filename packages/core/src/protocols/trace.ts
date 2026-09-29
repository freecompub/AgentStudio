/**
 * Trace d'exécution (ADR 0032) : tout ce qu'une tâche a échangé avec le modèle, et pourquoi.
 *
 * Elle existe parce qu'on a passé une nuit à diagnostiquer des runs à l'aveugle. Un refus de garde
 * était journalisé sans la commande refusée ; une porte disait « document absent » sans dire ce que
 * l'agent prétendait avoir écrit ; un rollback effaçait les traces de ce qu'on voulait examiner.
 * Chaque fois, l'information existait dans le code et n'était pas conservée.
 *
 * À distinguer des **preuves** (`Evidence`, D20), qui attestent un fait vérifié par le code et font
 * autorité dans une revue. La trace, elle, n'atteste rien : elle raconte. Une porte ne doit jamais
 * s'appuyer dessus.
 */

/** Ce qui a mis fin à un tour d'agent. */
export type TurnEnd = "output" | "blocker" | "silence" | "durée" | "contexte" | "coût" | "panne" | "sans-sortie" | "annulé";

export type TraceEntry = {
  taskId: string;
  at: string;
  /** Tour d'agent auquel l'entrée se rattache ; absent pour les entrées de la machine à états. */
  sessionId?: string;
  role?: string;
} & (
  | { kind: "tour-début"; prompt: string; phase?: string; repris: boolean }
  | { kind: "tour-fin"; fin: TurnEnd; raison?: string; sortie?: unknown }
  | { kind: "message"; texte: string }
  | { kind: "raisonnement"; texte: string }
  | { kind: "outil"; nom: string; appel: string }
  | { kind: "outil-fin"; appel: string; succès: boolean; erreur?: string }
  /** Décision de la garde : **tout** appel soumis à permission, autorisé comme refusé. */
  | { kind: "permission"; sorte: string; outil: string; cible?: string; décision: "allow" | "deny"; raison?: string }
  | { kind: "usage"; modèle?: string; entrée?: number; sortie?: number; nanoAiu?: number }
  | { kind: "contexte"; occupés: number; limite: number; système?: number; conversation?: number; outils?: number; messages?: number }
  /** Transition de la machine à états : l'événement reçu, l'état obtenu, les effets déclenchés. */
  | { kind: "transition"; événement: string; stade?: string; phase?: string; essais?: number; effets: string[] }
  /** Rejet par une porte ou une revue, avec ses motifs entiers. */
  | { kind: "rejet"; porte: string; motifs: string[] }
  /**
   * Livrable archivé **avant** qu'un rollback ne l'efface (ADR 0038).
   *
   * Un rejet de porte rembobine le dépôt : le document jugé disparaît en même temps que le verdict
   * qui le condamne. On ne peut alors plus examiner ce qu'un agent a produit **au moment précis où
   * on voudrait le lire**. Le contenu est tronqué comme le reste, en le disant.
   */
  | { kind: "livrable-rejeté"; étiquette: string; chemin: string; contenu: string }
);

/**
 * Le corps d'une entrée, sans ce que l'enregistreur remplit lui-même.
 *
 * Distributif : `Omit` appliqué directement à une union n'en garderait que les clés communes, et
 * `kind` deviendrait le seul champ acceptable.
 */
export type TraceBody = TraceEntry extends infer T ? (T extends TraceEntry ? Omit<T, "taskId" | "at" | "sessionId" | "role"> : never) : never;

export interface TraceStore {
  append(entry: TraceEntry): Promise<void>;
  list(taskId: string): Promise<TraceEntry[]>;
}
