import { useEffect, useState } from "react";
import type { InteractionDto, TaskCardDto } from "../../shared/ipc-contract";
import { api } from "../api";

/**
 * « En attente de vous » puis « Tâches » (§7.2, §11) : une carte par tâche, mise à jour en place.
 * Les décisions sont des boutons explicites ; rien ne bloque la conversation.
 */
export function TaskPanel() {
  const [tasks, setTasks] = useState<Map<string, TaskCardDto>>(new Map());
  const [pending, setPending] = useState<InteractionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const offs = [
      api.on("task:update", (card) => setTasks((m) => new Map(m).set(card.id, card))),
      api.on("interactions:changed", ({ pending }) => setPending(pending)),
    ];
    api.call("tasks:list", {}).then((list) => setTasks(new Map(list.map((c) => [c.id, c]))), () => undefined);
    api.call("interactions:list", {}).then(setPending, () => undefined);
    return () => offs.forEach((off) => off());
  }, []);

  async function respond(id: string, option: string) {
    setBusy(id);
    setError(null);
    try {
      await api.call("interaction:respond", { id, option });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const visible = [...tasks.values()]
    .filter((t) => t.status !== "finished" || Date.now() - Date.parse(t.updatedAt) < 10 * 60_000)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (visible.length === 0 && pending.length === 0) return null;

  return (
    <aside className="task-panel" aria-label="Tâches">
      {pending.length > 0 && (
        <section className="waiting-for-you">
          <h2>En attente de vous</h2>
          {pending.map((p) => (
            <article key={p.id} className="decision">
              <h3>{p.title}</h3>
              {p.detail && <pre className="decision-detail">{p.detail}</pre>}
              <div className="row">
                {p.options.map((o, i) => (
                  <button key={o.id} className={i === 0 ? "primary" : ""} disabled={busy === p.id} onClick={() => void respond(p.id, o.id)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </article>
          ))}
          {error && <p className="error">{error}</p>}
        </section>
      )}
      {visible.map((t) => (
        <article key={t.id} className={`task-card ${t.status}${t.alert ? " alert" : ""}`}>
          <h3>{t.title}</h3>
          <p className="task-phase">
            {t.phaseLabel}
            {t.step && t.status !== "finished" && (
              <span className="hint">
                , étape {t.step.index} sur {t.step.total} : {t.step.behavior}
              </span>
            )}
          </p>
          {t.step && <progress max={t.step.total} value={t.status === "finished" ? t.step.total : t.step.index - 1} />}
          {t.feedback && t.status !== "finished" && <p className="hint">Dernier rejet : {t.feedback}</p>}
          {t.status !== "finished" && (
            <button className="link" onClick={() => void api.call("task:cancel", { taskId: t.id })}>
              Annuler la tâche
            </button>
          )}
        </article>
      ))}
    </aside>
  );
}
