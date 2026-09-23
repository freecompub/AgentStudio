import { useEffect, useState } from "react";
import type { WorkspaceDiffDto } from "../../shared/ipc-contract";
import { api } from "../api";
import { useAdvanced } from "../ui-mode";

const LABEL = { added: "ajouté", modified: "modifié", deleted: "supprimé" } as const;

/** Fichiers changés depuis le point de retour d'un tour ; le détail ligne à ligne est repliable. */
export function TurnChanges({ messageId }: { messageId: string }) {
  const [diff, setDiff] = useState<WorkspaceDiffDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const advanced = useAdvanced();

  useEffect(() => {
    api.call("chat:turn-changes", { messageId }).then(setDiff, (e: Error) => setError(e.message));
  }, [messageId]);

  if (error) return <p className="error">{error}</p>;
  if (!diff) return <p className="hint">Calcul des changements…</p>;
  if (diff.files.length === 0) return <p className="hint">Aucun fichier modifié depuis ce point.</p>;
  return (
    <div className="changes">
      <p>
        {diff.files.length} fichier{diff.files.length > 1 ? "s" : ""} modifié{diff.files.length > 1 ? "s" : ""} depuis ce
        point :
      </p>
      <ul>
        {diff.files.map((f) => (
          <li key={f.path} className={f.status}>
            <code>{f.path}</code> <span className="hint">{LABEL[f.status]}</span>
          </li>
        ))}
      </ul>
      {advanced && (
        <details>
          <summary>Détail ligne à ligne</summary>
          <pre className="patch">{diff.patch}</pre>
        </details>
      )}
    </div>
  );
}
