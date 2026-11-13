import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ChatMessageDto, CommandListingDto, ModelListingDto, AdminInfoDto, RuntimeKindDto, RuntimeStatusDto, UiMode, WorkspaceInfoDto } from "../../shared/ipc-contract";
import { api } from "../api";
import { ExtensionsPanel } from "../components/ExtensionsPanel";
import { ModelsPanel } from "../components/ModelsPanel";
import { GuidedActions } from "../components/GuidedActions";
import { TaskPanel } from "../components/TaskPanel";
import { TurnChanges } from "../components/TurnChanges";
import { RUNTIMES } from "../runtimes";

interface ToolActivity {
  id: string;
  name: string;
  state: "running" | "done" | "failed" | "denied";
  note?: string;
}

export function ChatScreen(props: {
  user: string;
  runtime: RuntimeStatusDto;
  onRuntimeChanged: () => void;
  workspace: WorkspaceInfoDto;
  admin: AdminInfoDto | null;
  mode: UiMode;
  onModeChange: (m: UiMode) => void;
  onProjectClosed: () => void;
  onLoggedOut: () => void;
}) {
  const advanced = props.mode === "advanced";
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [tools, setTools] = useState<ToolActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [armedUndo, setArmedUndo] = useState<string | null>(null);
  const [openChanges, setOpenChanges] = useState<string | null>(null);
  const [commands, setCommands] = useState<CommandListingDto[]>([]);
  const [models, setModels] = useState<ModelListingDto>({ models: [], selected: null });
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
    const loadCommands = () => api.call("commands:list", {}).then(setCommands, () => undefined);
    void loadCommands();
    void api.call("models:list", {}).then(setModels, () => undefined);
    offs.push(api.on("extensions:changed", () => void loadCommands()));
    return () => offs.forEach((off) => off());
  }, [props.workspace.root]);

  // Corps en bloc : la valeur de retour d'un effet sert de nettoyage, `scrollIntoView` n'en est pas un.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming, tools]);

  async function send(e?: FormEvent, override?: string) {
    e?.preventDefault();
    const text = (override ?? draft).trim();
    if (!text || busy) return;
    if (!override) setDraft("");
    setActionsOpen(false);
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

  function chooseModel(id: string) {
    const selected = id === "" ? null : id;
    setModels((m) => ({ ...m, selected }));
    api.call("model:set", { id: selected }).catch((err: Error) => setError(err.message));
  }

  async function chooseRuntime(runtime: RuntimeKindDto) {
    setError(null);
    try {
      await api.call("runtime:set", { runtime });
      props.onRuntimeChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function logout() {
    setError(null);
    try {
      await api.call("auth:logout", {});
      props.onLoggedOut();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function closeProject() {
    setError(null);
    try {
      await api.call("workspace:close", {});
      props.onProjectClosed();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="chat-layout">
      <header className="topbar">
        <span className="brand">agent-studio</span>
        <span className="project-name" title={props.workspace.root}>
          {props.workspace.name}
        </span>
        <button className="project-close" onClick={() => void closeProject()}>
          Fermer le projet
        </button>
        <span className="spacer" />
        {syncNote && <span className="hint">{syncNote}</span>}
        <button onClick={() => void sync()}>Synchroniser</button>
        <button onClick={() => setExtensionsOpen(true)}>Extensions</button>
        {/* Réglage fin, réservé au mode avancé (ADR 0048). */}
        {advanced && <button onClick={() => setModelsOpen(true)}>Modèles des agents</button>}
        {advanced && props.runtime.disponibles.length > 1 && (
          <label className="model-pick">
            <span>Agents</span>
            <select value={props.runtime.choisi} onChange={(e) => void chooseRuntime(e.target.value as RuntimeKindDto)}>
              {props.runtime.disponibles.map((r) => (
                <option key={r} value={r}>
                  {RUNTIMES[r]}
                </option>
              ))}
            </select>
          </label>
        )}
        {models.models.length > 0 && (
          <label className="model-pick">
            <span>Modèle</span>
            <select value={models.selected ?? ""} onChange={(e) => chooseModel(e.target.value)}>
              <option value="">Automatique</option>
              {models.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.multiplier === undefined ? m.name : `${m.name} (×${m.multiplier})`}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="mode-switch" role="group" aria-label="Mode d'affichage">
          <button aria-pressed={!advanced} onClick={() => props.onModeChange("simple")}>
            Simple
          </button>
          <button aria-pressed={advanced} onClick={() => props.onModeChange("advanced")}>
            Avancé
          </button>
        </div>
        <span className="user">{props.user}</span>
        {/* La déconnexion est celle de GitHub : avec Claude, elle se fait dans le terminal. */}
        {props.runtime.choisi === "copilot" && (
          <button className="link" onClick={() => void logout()}>
            Se déconnecter
          </button>
        )}
      </header>

      <TaskPanel />

      <main className="thread" aria-live="polite">
        {messages.length === 0 && !busy && (
          <div className="empty">
            <h1>Que voulez-vous faire dans {props.workspace.name} ?</h1>
            <p>
              Décrivez la tâche en langage courant. Avant chaque réponse, l'application garde un point de retour : vous
              pourrez annuler les modifications de l'agent d'un clic.
            </p>
            <GuidedActions commands={commands} disabled={busy} onRun={(t) => void send(undefined, t)} />
          </div>
        )}

        <ol className="rail">
          {messages.map((m) => (
            <li key={m.id} className={`msg ${m.role}${m.undone ? " undone" : ""}`}>
              {m.role === "user" && m.checkpointId && <span className="notch" aria-hidden="true" />}
              {m.origin && <span className="origin">{m.origin}</span>}
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
              {!advanced && tools.length > 0 && (
                <p className="hint">
                  L'agent travaille ({tools.length} action{tools.length > 1 ? "s" : ""})
                  {tools.some((t) => t.state === "denied") ? ", une action a été refusée" : ""}.
                </p>
              )}
              {advanced && tools.length > 0 && (
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
        {messages.length > 0 && commands.length > 0 && (
          <div className="row">
            <button type="button" className="link" onClick={() => setActionsOpen((o) => !o)}>
              {actionsOpen ? "Masquer les actions" : "Lancer une action"}
            </button>
          </div>
        )}
        {actionsOpen && <GuidedActions commands={commands} disabled={busy} onRun={(t) => void send(undefined, t)} />}
        {draft.startsWith("/") && !draft.includes(" ") && (
          <ul className="command-hints" aria-label="Commandes disponibles">
            {commands
              .filter((c) => `/${c.invocation}`.startsWith(draft))
              .map((c) => (
                <li key={c.invocation}>
                  <button type="button" className="link" onClick={() => setDraft(`/${c.invocation} `)}>
                    /{c.invocation}
                  </button>{" "}
                  <span className="hint">
                    {c.title} : {c.description}
                  </span>
                </li>
              ))}
          </ul>
        )}
        <textarea
          aria-label="Votre message"
          rows={3}
          placeholder="Par exemple : ajoute une section « Installation » au README, ou /tdd pour une fonctionnalité en TDD"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="row end">
          <span className="hint">Entrée pour envoyer, Maj+Entrée pour aller à la ligne</span>
          <ExtensionsPanel open={extensionsOpen} onClose={() => setExtensionsOpen(false)} developerMode={props.admin?.developerMode ?? false} />
          <ModelsPanel open={modelsOpen} onClose={() => setModelsOpen(false)} />
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
