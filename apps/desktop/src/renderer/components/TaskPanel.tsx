import { useEffect, useState } from "react";
import type { InteractionDto, TaskCardDto, UsageRowDto } from "../../shared/ipc-contract";
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
          {t.usage && <UsageSummary usage={t.usage} />}
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

const nf = new Intl.NumberFormat("fr-FR");
const duration = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);

/** Usage par état (D37), dans l'unité du fournisseur : requêtes pour Copilot, tokens sinon. */
function UsageSummary({ usage }: { usage: NonNullable<TaskCardDto["usage"]> }) {
  const main = (r: UsageRowDto) => (usage.unit === "requests" ? `${nf.format(r.requests)} requête${r.requests > 1 ? "s" : ""}` : `${nf.format(r.inputTokens + r.outputTokens)} tokens`);
  return (
    <details className="usage">
      <summary>
        Usage : {main(usage.total)}
        {usage.total.retries > 0 && `, ${usage.total.retries} réessai${usage.total.retries > 1 ? "s" : ""}`}
      </summary>
      <table>
        <thead>
          <tr>
            <th scope="col">État</th>
            <th scope="col">Requêtes</th>
            <th scope="col">Tokens entrée</th>
            <th scope="col">Tokens sortie</th>
            <th scope="col">Réessais</th>
            <th scope="col">Durée</th>
          </tr>
        </thead>
        <tbody>
          {usage.rows.map((r) => (
            <tr key={r.phase}>
              <th scope="row">{r.label}</th>
              <td>{nf.format(r.requests)}</td>
              <td>{nf.format(r.inputTokens)}</td>
              <td>{nf.format(r.outputTokens)}</td>
              <td>{r.retries}</td>
              <td>{duration(r.durationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
