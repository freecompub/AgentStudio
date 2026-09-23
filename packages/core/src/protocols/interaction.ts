/** Question courte posée à l'utilisateur présent (canal `ctx.chat`, §7.1). */
export interface ConfirmRequest {
  title: string;
  detail: string;
}

/**
 * Demande de confirmation immédiate à l'utilisateur. Seul l'arbitre du cœur l'utilise
 * pour les permissions : une extension ne peut pas l'imiter (D34).
 */
export interface UserConfirmer {
  confirm(req: ConfirmRequest): Promise<boolean>;
}
