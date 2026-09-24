import { useEffect, useRef, useState } from "react";
import type { EventPayload } from "../../shared/ipc-contract";
import { api } from "../api";

/** Accord d'installation : ce que l'extension apporte et ce qu'elle pourra faire, en langage clair (§5.3). */
export function ConsentDialog() {
  const [req, setReq] = useState<EventPayload<"extension-consent:request"> | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => api.on("extension-consent:request", setReq), []);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (req && !d.open) d.showModal();
    if (!req && d.open) d.close();
  }, [req]);

  function answer(accept: boolean) {
    if (!req) return;
    void api.call("extension-consent:respond", { id: req.id, accept });
    setReq(null);
  }

  return (
    <dialog ref={ref} className="consent" onCancel={(e) => (e.preventDefault(), answer(false))}>
      {req && (
        <>
          <h2>
            {req.kind === "install" ? "Installer" : "Mettre à jour"} {req.extensionId} {req.version} ?
          </h2>
          <p className="hint">Éditeur : {req.publisher}{req.signed ? ", signature vérifiée" : ""}</p>
          {req.warnings.map((w) => (
            <p key={w} className="warning">
              {w}
            </p>
          ))}
          {req.commands.length > 0 && (
            <>
              <h3>Ce qu'elle apporte</h3>
              <ul>
                {req.commands.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </>
          )}
          <h3>Ce qu'elle pourra faire</h3>
          <ul>
            {req.permissions.map((p) => (
              <li key={p.permission} className={req.added.some((a) => a.permission === p.permission) ? "added" : ""}>
                {p.description}
                {req.added.some((a) => a.permission === p.permission) && <strong> (nouveau)</strong>}
              </li>
            ))}
          </ul>
          <div className="row end">
            <button onClick={() => answer(false)}>Refuser</button>
            <button className="primary" onClick={() => answer(true)}>
              {req.kind === "install" ? "Installer" : "Mettre à jour"}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
