import { useCallback, useEffect, useState } from "react";
import type { AuthStatusDto, ProfileInfoDto, UiMode, WorkspaceInfoDto } from "../shared/ipc-contract";
import { api } from "./api";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ConsentDialog } from "./components/ConsentDialog";
import { UiModeContext } from "./ui-mode";
import { AuthScreen } from "./screens/AuthScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { ProjectScreen } from "./screens/ProjectScreen";

type Phase =
  | { kind: "loading" }
  | { kind: "auth"; status: AuthStatusDto }
  | { kind: "project"; user: string }
  | { kind: "chat"; user: string; workspace: WorkspaceInfoDto }
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
      const status = await api.call("auth:status", {});
      if (!status.loggedIn || !status.copilotCompatible) return setPhase({ kind: "auth", status });
      const ws = await api.call("workspace:current", {});
      setPhase(ws ? { kind: "chat", user: status.user, workspace: ws } : { kind: "project", user: status.user });
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
      {phase.kind === "auth" && <AuthScreen status={phase.status} onDone={() => void boot()} />}
      {phase.kind === "project" && (
        <ProjectScreen user={phase.user} onOpened={(workspace) => setPhase({ kind: "chat", user: phase.user, workspace })} />
      )}
      {phase.kind === "chat" && (
        <ChatScreen
          user={phase.user}
          workspace={phase.workspace}
          profile={profile}
          mode={mode}
          onModeChange={changeMode}
          onProjectClosed={() => setPhase({ kind: "project", user: phase.user })}
        />
      )}
      <ConfirmDialog />
      <ConsentDialog />
    </UiModeContext.Provider>
  );
}
