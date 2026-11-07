import { useCallback, useEffect, useState } from "react";
import type { AuthStatusDto, ProfileInfoDto, RuntimeStatusDto, UiMode, WorkspaceInfoDto } from "../shared/ipc-contract";
import { api } from "./api";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ConsentDialog } from "./components/ConsentDialog";
import { UiModeContext } from "./ui-mode";
import { AuthScreen } from "./screens/AuthScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { ProjectScreen } from "./screens/ProjectScreen";

type Phase =
  | { kind: "loading" }
  | { kind: "auth"; status: AuthStatusDto; runtime: RuntimeStatusDto }
  | { kind: "project"; user: string; runtime: RuntimeStatusDto }
  | { kind: "chat"; user: string; workspace: WorkspaceInfoDto; runtime: RuntimeStatusDto }
  | { kind: "fatal"; message: string };

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [profile, setProfile] = useState<ProfileInfoDto | null>(null);
  const [mode, setMode] = useState<UiMode>("simple");

  const boot = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([api.call("profile:get", {}), api.call("ui:get-mode", {})]);
      setProfile(p);
      setMode(m);
      const [status, runtime] = await Promise.all([api.call("auth:status", {}), api.call("runtime:status", {})]);
      // Avec Claude (ADR 0070), seule compte la connexion de Claude Code : GitHub n'est pas demandé.
      const pret = runtime.choisi === "claude" ? runtime.claude?.etat === "connecte" : status.loggedIn && status.copilotCompatible;
      if (!pret) return setPhase({ kind: "auth", status, runtime });
      const user = status.loggedIn ? status.user : "Claude";
      const ws = await api.call("workspace:current", {});
      setPhase(ws ? { kind: "chat", user, workspace: ws, runtime } : { kind: "project", user, runtime });
    } catch (err) {
      setPhase({ kind: "fatal", message: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  function changeMode(next: UiMode) {
    setMode(next);
    void api.call("ui:set-mode", { mode: next });
  }

  return (
    <UiModeContext.Provider value={mode}>
      {phase.kind === "loading" && <div className="splash" aria-busy="true" />}
      {phase.kind === "fatal" && (
        <main className="centered">
          <div className="panel">
            <h1>L'application n'a pas pu démarrer</h1>
            <p className="error">{phase.message}</p>
            <button className="primary" onClick={() => void boot()}>
              Réessayer
            </button>
          </div>
        </main>
      )}
      {phase.kind === "auth" && <AuthScreen status={phase.status} runtime={phase.runtime} onDone={() => void boot()} />}
      {phase.kind === "project" && (
        <ProjectScreen user={phase.user} onOpened={(workspace) => setPhase({ kind: "chat", user: phase.user, workspace, runtime: phase.runtime })} />
      )}
      {phase.kind === "chat" && (
        // Changer de runtime ferme la conversation côté principal : la clé la rouvre, sur le nouveau.
        <ChatScreen
          key={phase.runtime.choisi}
          user={phase.user}
          runtime={phase.runtime}
          onRuntimeChanged={() => void boot()}
          workspace={phase.workspace}
          profile={profile}
          mode={mode}
          onModeChange={changeMode}
          onProjectClosed={() => setPhase({ kind: "project", user: phase.user, runtime: phase.runtime })}
          onLoggedOut={() => void boot()}
        />
      )}
      <ConfirmDialog />
      <ConsentDialog />
    </UiModeContext.Provider>
  );
}
