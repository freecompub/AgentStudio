import type { AgentEvent, AgentSession } from "../protocols/agent-runtime.js";

/**
 * Ces erreurs sont définies dans `@agent-studio/extension-api` : une extension doit pouvoir les
 * lever sans dépendre du cœur (D10). Réexportées ici pour tout le reste du cœur.
 */
export { EnvFailureError, TurnBudgetError, TurnContextError, TurnCostError, TurnTimeoutError, WorkDefectError } from "@agent-studio/extension-api";
import { EnvFailureError, TurnBudgetError, TurnContextError, TurnCostError, TurnTimeoutError, WorkDefectError } from "@agent-studio/extension-api";

/** Signe de vie émis hors session (sortie d'un outil long exécuté par notre code, §6.4). */
export interface Heartbeat {
  beat(): void;
  onBeat(cb: () => void): () => void;
}

export function createHeartbeat(): Heartbeat {
  const listeners = new Set<() => void>();
  return {
    beat: () => listeners.forEach((l) => l()),
    onBeat(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export interface RunTurnOptions {
  heartbeat?: Heartbeat;
  /** Seuil d'inactivité ; défaut 5 min. */
  idleMs?: number;
  /**
   * Plafond de durée **totale** du tour ; défaut 30 min. Contrairement à `idleMs`, il n'est réarmé
   * par rien : c'est un plafond, pas un chronomètre.
   */
  maxMs?: number;
  /**
   * Plafond du **cumul** des tokens d'entrée du tour. **Désactivé par défaut** depuis l'ADR 0031 :
   * son défaut de 1 M a tué trois essais de DESIGN d'affilée sur un vrai run, sans qu'aucune porte
   * n'ait jugé le travail — un tour normal d'architecte, sur un projet réel, fait un million. Et
   * ce cumul ne dit pas ce qu'on croyait : il compte ce qui a transité, cache de prompt compris.
   * Il reste disponible pour qui veut borner explicitement la dépense d'un tour.
   */
  maxInputTokens?: number;
  /**
   * Fraction de la fenêtre de contexte au-delà de laquelle le tour est coupé ; défaut 0,9.
   *
   * Contrairement au précédent, ce seuil ne porte pas sur un nombre absolu deviné : il s'appuie
   * sur `tokenLimit`, que le runtime rend pour le modèle employé, et coupe quand l'agent est
   * réellement près de ne plus pouvoir travailler.
   */
  maxContextFraction?: number;
  onEvent?: (e: AgentEvent) => void;
}

/**
 * Exécute un tour d'agent sans délai fixe (D30) : `send()` non bloquant, chronomètre
 * d'inactivité réarmé par chaque événement, fin sur `idle`, `abort()` puis
 * `TurnTimeoutError` en cas de silence prolongé.
 *
 * Par-dessus, un **plafond de durée totale** (ADR 0026), que rien ne réarme. D30 dit qu'un agent
 * qui travaille ne doit pas être coupé ; l'expérience du 28/09 dit qu'un agent peut « travailler »
 * près de deux heures pour un résultat jeté. Le chronomètre d'inactivité ne voyait rien : chaque
 * événement le réarmait. Le plafond est un filet, pas un ordonnanceur — il est assez large pour
 * qu'un tour légitime, tests compris, passe dessous.
 */
export function runTurn(session: AgentSession, prompt: string, opts: RunTurnOptions = {}): Promise<void> {
  const idleMs = opts.idleMs ?? 5 * 60_000;
  const maxMs = opts.maxMs ?? 30 * 60_000;
  const maxInputTokens = opts.maxInputTokens ?? Infinity;
  const maxContextFraction = opts.maxContextFraction ?? 0.9;
  const debut = Date.now();
  let tokensEntree = 0;
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer = setTimeout(onSilence, idleMs);
    // Armé une seule fois, jamais réarmé — ni par un événement, ni par un battement d'outil.
    const plafond = setTimeout(onPlafond, maxMs);

    const off = session.onEvent((ev) => {
      if (settled) return;
      clearTimeout(timer);
      timer = setTimeout(onSilence, idleMs);
      opts.onEvent?.(ev);
      // Le cumul ne décroît jamais : c'est ce qui a été payé. Regarder le dernier appel ne
      // couperait rien — les appels rétrécissent souvent alors que la facture monte.
      if (ev.type === "usage") tokensEntree += ev.inputTokens ?? 0;
      if (tokensEntree >= maxInputTokens) return arreter(() => new TurnCostError(maxInputTokens, tokensEntree));
      // C'est la **dernière** mesure qui compte, jamais la plus haute atteinte : une compaction
      // vide la fenêtre, et plus rien ne justifie alors de couper. Une limite absente ou nulle ne
      // fait rien couper — on ne divise pas par une mesure manquante.
      if (ev.type === "context" && ev.tokenLimit > 0 && ev.currentTokens / ev.tokenLimit >= maxContextFraction)
        return arreter(() => new TurnContextError(ev.currentTokens, ev.tokenLimit, maxContextFraction));
      if (ev.type === "idle") finish(() => resolve());
      else if (ev.type === "error") finish(() => reject(new EnvFailureError(ev.message)));
    });

    const offBeat = opts.heartbeat?.onBeat(() => {
      if (settled) return;
      clearTimeout(timer);
      timer = setTimeout(onSilence, idleMs);
    });

    function finish(settle: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(plafond);
      off();
      offBeat?.();
      settle();
    }

    function onSilence(): void {
      arreter(() => new TurnTimeoutError(idleMs));
    }

    function onPlafond(): void {
      arreter(() => new TurnBudgetError(maxMs, Date.now() - debut));
    }

    /** Interrompt la session, puis rejette — que l'interruption ait abouti ou non. */
    function arreter(erreur: () => Error): void {
      finish(() => {
        session.abort().then(
          () => reject(erreur()),
          () => reject(erreur()),
        );
      });
    }

    session.send(prompt).catch((err: unknown) => finish(() => reject(err)));
  });
}
