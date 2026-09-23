import { useState, type FormEvent } from "react";
import type { WorkspaceInfoDto } from "../../shared/ipc-contract";
import { api } from "../api";

export function ProjectScreen({ user, onOpened }: { user: string; onOpened: (ws: WorkspaceInfoDto) => void }) {
  const [url, setUrl] = useState("");
  const [dest, setDest] = useState("");
  const [busy, setBusy] = useState<"open" | "clone" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "open" | "clone", action: () => Promise<WorkspaceInfoDto | null>) {
    setBusy(kind);
    setError(null);
    try {
      const ws = await action();
      if (ws) onOpened(ws);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const openExisting = () =>
    run("open", async () => {
      const path = await api.call("workspace:pick-folder", {});
      return path ? api.call("workspace:open", { path }) : null;
    });

  async function chooseDest() {
    const path = await api.call("workspace:pick-folder", {});
    if (path) setDest(path);
  }

  function clone(e: FormEvent) {
    e.preventDefault();
    void run("clone", () => api.call("workspace:clone", { url: url.trim(), dest }));
  }

  return (
    <main className="centered">
      <div className="panel project">
        <h1>Sur quel projet travaille-t-on, {user} ?</h1>

        <section>
          <h2>Un dossier déjà sur cet ordinateur</h2>
          <p className="hint">Le dossier doit être un dépôt Git.</p>
          <button className="primary" disabled={busy !== null} onClick={() => void openExisting()}>
            {busy === "open" ? "Ouverture…" : "Choisir un dossier"}
          </button>
        </section>

        <section>
          <h2>Un dépôt GitHub à récupérer</h2>
          <form onSubmit={clone} className="stack">
            <label>
              Adresse du dépôt
              <input
                type="url"
                required
                placeholder="https://github.com/organisation/projet.git"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label>
              Dossier de destination (vide)
              <span className="row">
                <input required readOnly value={dest} placeholder="Aucun dossier choisi" />
                <button type="button" onClick={() => void chooseDest()}>
                  Parcourir
                </button>
              </span>
            </label>
            <button className="primary" type="submit" disabled={busy !== null || !url || !dest}>
              {busy === "clone" ? "Récupération en cours…" : "Récupérer le dépôt"}
            </button>
          </form>
        </section>
        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}
