import { useEffect, useRef, useState } from "react";
import type { EventPayload } from "../../shared/ipc-contract";
import { api } from "../api";

/** Demandes d'autorisation de l'arbitre du cœur, traitées une à une dans l'ordre d'arrivée. */
export function ConfirmDialog() {
  const [queue, setQueue] = useState<EventPayload<"confirm:request">[]>([]);
  const ref = useRef<HTMLDialogElement>(null);
  const current = queue[0];

  useEffect(() => api.on("confirm:request", (req) => setQueue((q) => [...q, req])), []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (current && !d.open) d.showModal();
    if (!current && d.open) d.close();
  }, [current]);

  function answer(answer: "allow-once" | "allow-always" | "deny") {
    if (!current) return;
    void api.call("confirm:respond", { id: current.id, answer });
    setQueue((q) => q.slice(1));
  }

  return (
    <dialog ref={ref} className="confirm" onCancel={(e) => (e.preventDefault(), answer("deny"))}>
      {current && (
        <>
          <h2>{current.title}</h2>
          <pre>{current.detail}</pre>
          <div className="row end">
            <button onClick={() => answer("deny")}>Refuser</button>
            <button onClick={() => answer("allow-always")}>Toujours autoriser</button>
            <button className="warn" onClick={() => answer("allow-once")}>
              Autoriser une fois
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
