/**
 * Progression d'une tâche (§7.2, D33) : une carte mise à jour en place (au plus deux fois par
 * seconde), des jalons aux états déclarés (regroupés au-delà d'un toutes les dix secondes),
 * des alertes immédiates. Rien n'est jamais injecté dans le contexte d'un LLM.
 */
export interface ProgressSnapshot {
  taskId: string;
  extensionId: string;
  title: string;
  phase: string;
  phaseLabel: string;
  /** L'état courant est déclaré comme jalon dans le manifeste. */
  milestone: boolean;
  /** L'état courant est déclaré comme alerte dans le manifeste. */
  alert: boolean;
  step?: { index: number; total: number; behavior: string };
  detail?: string;
}

export interface ProgressReporterDeps {
  onCard(s: ProgressSnapshot): void;
  onMilestone(s: ProgressSnapshot, text: string): void;
  onAlert(s: ProgressSnapshot, text: string): void;
  cardIntervalMs?: number;
  milestoneWindowMs?: number;
}

export interface ProgressReporter {
  update(s: ProgressSnapshot): void;
  dispose(): void;
}

interface TaskTrack {
  lastPhase?: string;
  lastCardAt: number;
  cardTimer?: ReturnType<typeof setTimeout> | undefined;
  pendingCard?: ProgressSnapshot | undefined;
  lastMilestoneAt: number;
  groupTimer?: ReturnType<typeof setTimeout> | undefined;
  grouped: ProgressSnapshot[];
}

export function createProgressReporter(deps: ProgressReporterDeps): ProgressReporter {
  const cardInterval = deps.cardIntervalMs ?? 500;
  const window = deps.milestoneWindowMs ?? 10_000;
  const tracks = new Map<string, TaskTrack>();
  let disposed = false;

  const track = (id: string): TaskTrack => {
    let t = tracks.get(id);
    if (!t) tracks.set(id, (t = { lastCardAt: -Infinity, lastMilestoneAt: -Infinity, grouped: [] }));
    return t;
  };

  const describe = (s: ProgressSnapshot) =>
    `${s.title} : ${s.phaseLabel}${s.step ? ` (étape ${s.step.index} sur ${s.step.total} : ${s.step.behavior})` : ""}`;

  function card(t: TaskTrack, s: ProgressSnapshot): void {
    const now = Date.now();
    if (now - t.lastCardAt >= cardInterval && !t.cardTimer) {
      t.lastCardAt = now;
      deps.onCard(s);
      return;
    }
    t.pendingCard = s;
    t.cardTimer ??= setTimeout(() => {
      t.cardTimer = undefined;
      if (disposed || !t.pendingCard) return;
      t.lastCardAt = Date.now();
      deps.onCard(t.pendingCard);
      t.pendingCard = undefined;
    }, Math.max(0, cardInterval - (now - t.lastCardAt)));
  }

  function milestone(t: TaskTrack, s: ProgressSnapshot): void {
    const now = Date.now();
    if (now - t.lastMilestoneAt >= window && !t.groupTimer) {
      t.lastMilestoneAt = now;
      deps.onMilestone(s, describe(s));
      return;
    }
    t.grouped.push(s);
    t.groupTimer ??= setTimeout(() => {
      t.groupTimer = undefined;
      if (disposed || t.grouped.length === 0) return;
      const items = t.grouped;
      t.grouped = [];
      t.lastMilestoneAt = Date.now();
      const last = items[items.length - 1]!;
      deps.onMilestone(last, items.length === 1 ? describe(last) : `${last.title} : ${items.length} jalons (${items.map((i) => i.phaseLabel).join(", ")})`);
    }, Math.max(0, window - (now - t.lastMilestoneAt)));
  }

  return {
    update(s) {
      if (disposed) return;
      const t = track(s.taskId);
      card(t, s);
      const entered = s.phase !== t.lastPhase;
      t.lastPhase = s.phase;
      if (!entered) return;
      if (s.alert) deps.onAlert(s, `${describe(s)}${s.detail ? `. ${s.detail}` : ""}`);
      else if (s.milestone) milestone(t, s);
    },
    dispose() {
      disposed = true;
      for (const t of tracks.values()) {
        clearTimeout(t.cardTimer);
        clearTimeout(t.groupTimer);
      }
    },
  };
}
