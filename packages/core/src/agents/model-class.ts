/**
 * Modèle par classe de rôle (ADR 0048).
 *
 * Une extension déclare la **classe** d'un agent — `strong` pour concevoir, `standard` pour
 * produire, `light` pour classer ou confronter des faits — jamais un identifiant de modèle : elle ne
 * choisit pas ce que l'utilisateur paie, et elle reste valable quand la liste des modèles change.
 * Le projet associe chaque classe à un modèle réel ; à défaut, le modèle du projet (ADR 0020) ; à
 * défaut encore, le runtime décide, comme avant.
 */
export const MODEL_CLASSES = ["strong", "standard", "light"] as const;
export type ModelClass = (typeof MODEL_CLASSES)[number];

export interface ModelPreferences {
  /** Modèle réel par classe, réglé par projet. */
  classes?: Partial<Record<ModelClass, string>> | undefined;
  /** Modèle du projet (ADR 0020), pour un agent sans classe ou une classe non associée. */
  fallback?: string | null | undefined;
  /**
   * Modèles que l'abonnement propose (`listModels`). La disponibilité dépend de l'abonnement et
   * change : un modèle absent est ignoré, et l'on retombe sur le suivant. Vide ou absent : la liste
   * est inconnue, rien n'est filtré.
   */
  available?: readonly string[] | undefined;
}

export function resolveModel(cls: ModelClass | undefined, prefs: ModelPreferences): string | undefined {
  const ok = (m: string | null | undefined): m is string => !!m && (!prefs.available?.length || prefs.available.includes(m));
  const candidats = [cls ? prefs.classes?.[cls] : undefined, prefs.fallback];
  return candidats.find(ok) ?? undefined;
}
