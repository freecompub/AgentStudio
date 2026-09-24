import { useState, type FormEvent } from "react";
import type { CommandListingDto } from "../../shared/ipc-contract";

/**
 * Actions guidées (§11, D5) : chaque commande d'extension est présentée par son titre et sa
 * description ; l'utilisateur décrit son besoin en une phrase, sans connaître la syntaxe `/`.
 */
export function GuidedActions({ commands, disabled, onRun }: { commands: CommandListingDto[]; disabled: boolean; onRun: (text: string) => void }) {
  const [chosen, setChosen] = useState<CommandListingDto | null>(null);
  const [text, setText] = useState("");

  if (commands.length === 0) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen || !text.trim()) return;
    onRun(`/${chosen.invocation} ${text.trim()}`);
    setChosen(null);
    setText("");
  }

  return (
    <section className="guided" aria-label="Actions disponibles">
      <h2>Ce que vous pouvez lancer</h2>
      {chosen ? (
        <form className="stack" onSubmit={submit}>
          <p>
            <strong>{chosen.title}</strong> : {chosen.description}
          </p>
          <label>
            Décrivez ce que vous voulez obtenir
            <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Par exemple : plafonner la dose proposée au maximum défini par le médecin" />
          </label>
          <div className="row end">
            <button type="button" onClick={() => setChosen(null)}>
              Retour
            </button>
            <button className="primary" type="submit" disabled={disabled || !text.trim()}>
              Lancer
            </button>
          </div>
        </form>
      ) : (
        <ul className="actions">
          {commands.map((c) => (
            <li key={c.invocation}>
              <button className="action" onClick={() => setChosen(c)} disabled={disabled}>
                <strong>{c.title}</strong>
                <span>{c.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
