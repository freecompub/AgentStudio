import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ChatMessageDto, WorkspaceInfoDto } from "../../shared/ipc-contract";
import { api } from "../api";
import { TurnChanges } from "../components/TurnChanges";

interface ToolActivity {
  id: string;
  name: string;
  state: "running" | "done" | "failed" | "denied";
  note?: string;
}

export function ChatScreen(props: { user: string; workspace: WorkspaceInfoDto; onChangeProject: () => void }) {
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [tools, setTools] = useState<ToolActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [armedUndo, setArmedUndo] = useState<string | null>(null);
  const [openChanges, setOpenChanges] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offs = [
      api.on("chat:messages", ({ messages }) => {
        setMessages(messages);
        setStreaming("");
      }),
      api.on("chat:busy", ({ busy }) => {
        setBusy(busy);
        if (busy) setTools([]);
      }),
      api.on("chat:agent", ({ event }) => {
        if (event.type === "message-delta") setStreaming((s) => s + event.text);
        else if (event.type === "tool-start")
          setTools((t) => [...t, { id: event.toolCallId, name: event.toolName, state: "running" }]);
        else if (event.type === "tool-end")
          setTools((t) => t.map((x) => (x.id === event.toolCallId ? { ...x, state: event.success ? "done" : "failed" } : x)));
        else if (event.type === "tool-denied")
          setTools((t) => [...t, { id: `${Date.now()}`, name: event.toolName, state: "denied", note: event.reason }]);
      }),
    ];
    api.call("chat:start", {}).then(setMessages, (err: Error) => setError(err.message));
    return () => offs.forEach((off) => off());
  }, [props.workspace.root]);

  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [messages, streaming, tools]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setError(null);
    try {
      await api.call("chat:send", { text });
    } catch (err) {
      setError((err as Error).message);
      setDraft(text);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  async function undo(id: string) {
    if (armedUndo !== id) {
      setArmedUndo(id);
      setTimeout(() => setArmedUndo((cur) => (cur === id ? null : cur)), 5_000);
      return;
    }
    setArmedUndo(null);
    setOpenChanges(null);
    try {
      await api.call("chat:undo", { messageId: id });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function sync() {
    setSyncNote("Synchronisation…");
    try {
      const r = await api.call("workspace:sync", {});
      setSyncNote(
        r.pulled === 0 && r.pushed === 0
          ? "Déjà à jour"
          : [r.pulled && `${r.pulled} modification(s) récupérée(s)`, r.pushed && `${r.pushed} envoyée(s)`].filter(Boolean).join(", "),
      );
    } catch (err) {
      setSyncNote(null);
      setError((err as Error).message);
    }
  }

  return (
    <div className="chat-layout">
      <header className="topbar">
        <span className="brand">agent-studio</span>
        <button className="project-switch" onClick={props.onChangeProject} title={props.workspace.root}>
          {props.workspace.name}
        </button>
        <span className="spacer" />
        {syncNote && <span className="hint">{syncNote}</span>}
        <button onClick={() => void sync()}>Synchroniser</button>
        <span className="user">{props.user}</span>
      </header>

      <main className="thread" aria-live="polite">
        {messages.length === 0 && !busy && (
          <div className="empty">
            <h1>Que voulez-vous faire dans {props.workspace.name} ?</h1>
            <p>
              Décrivez la tâche en langage courant. Avant chaque réponse, l'application garde un point de retour : vous
              pourrez annuler les modifications de l'agent d'un clic.
            </p>
          </div>
        )}

        <ol className="rail">
          {messages.map((m) => (
            <li key={m.id} className={`msg ${m.role}${m.undone ? " undone" : ""}`}>
              {m.role === "user" && <span className="notch" aria-hidden="true" />}
              <div className="body">{m.text}</div>
              {m.role === "user" && m.checkpointId && (
                <div className="turn-actions">
                  {m.undone ? (
                    <span className="hint">Annulé</span>
                  ) : (
                    <>
                      <button className="link" onClick={() => setOpenChanges(openChanges === m.id ? null : m.id)}>
                        {openChanges === m.id ? "Masquer les changements" : "Voir les changements"}
                      </button>
                      <button className={`link${armedUndo === m.id ? " danger" : ""}`} disabled={busy} onClick={() => void undo(m.id)}>
                        {armedUndo === m.id ? "Confirmer : tout annuler depuis ici" : "Annuler depuis ici"}
                      </button>
                    </>
                  )}
                </div>
              )}
              {openChanges === m.id && <TurnChanges messageId={m.id} />}
            </li>
          ))}
          {busy && (
            <li className="msg assistant live">
              {tools.length > 0 && (
                <ul className="tools">
                  {tools.map((t) => (
                    <li key={t.id} className={`tool ${t.state}`}>
                      <code>{t.name}</code>
                      {t.state === "running" && " en cours"}
                      {t.state === "failed" && " a échoué"}
                      {t.state === "denied" && ` refusé : ${t.note ?? ""}`}
                    </li>
                  ))}
                </ul>
              )}
              <div className="body">{streaming || "L'agent réfléchit…"}</div>
            </li>
          )}
        </ol>
        <div ref={endRef} />
      </main>

      <form className="composer" onSubmit={(e) => void send(e)}>
        {error && <p className="error">{error}</p>}
        <textarea
          aria-label="Votre message"
          rows={3}
          placeholder="Par exemple : ajoute une section « Installation » au README"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="row end">
          <span className="hint">Entrée pour envoyer, Maj+Entrée pour aller à la ligne</span>
          {busy ? (
            <button type="button" onClick={() => void api.call("chat:abort", {})}>
              Arrêter l'agent
            </button>
          ) : (
            <button className="primary" type="submit" disabled={!draft.trim()}>
              Envoyer
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
