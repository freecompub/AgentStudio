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
  | { kind: "transition"; événement: string; stade?: string; phase?: string; essais?: number; effets: string[]; /** Calcul de la transition : coût du moteur (rejeu compris). */ duréeMs?: number }
  /**
   * Effet exécuté (docs/10 P2) : sa durée, et comment il s'est terminé — `attente` quand il a posé
   * une question à l'humain et rend la main. Sépare le temps des agents de celui du code.
   */
  | { kind: "effet"; effet: string; phase?: string; duréeMs: number; issue: "ok" | "erreur" | "attente" }
  /** Rejet par une porte ou une revue, avec ses motifs entiers. */
  | { kind: "rejet"; porte: string; motifs: string[] }
  /**
   * Livrable archivé **avant** qu'un rollback ne l'efface (ADR 0038).
   *
   * Un rejet de porte rembobine le dépôt : le document jugé disparaît en même temps que le verdict
   * qui le condamne. On ne peut alors plus examiner ce qu'un agent a produit **au moment précis où
   * on voudrait le lire**.
   *
   * Le contenu n'est **pas** ici : il est écrit à côté de la trace, entier. L'avoir mis dans le
   * JSONL obligeait à le borner, donc à choisir un seuil qu'aucune mesure ne justifiait.
   */
  | { kind: "livrable-rejeté"; étiquette: string; chemin: string }
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
  /**
   * Archive des livrables **entiers**, à côté de la trace, et en note la référence dedans.
   * `étiquette` situe le moment (« DESIGN essai 2 »).
   */
  archive(taskId: string, label: string, files: readonly { path: string; content: string }[]): Promise<void>;
}
