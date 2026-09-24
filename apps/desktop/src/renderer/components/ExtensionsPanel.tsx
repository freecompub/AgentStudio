import { useEffect, useRef, useState } from "react";
import type { ExtensionInfoDto } from "../../shared/ipc-contract";
import { api } from "../api";

/** Écran des extensions : liste, installation depuis un fichier, désinstallation (§11, §12). */
export function ExtensionsPanel({ open, onClose, developerMode }: { open: boolean; onClose: () => void; developerMode: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [list, setList] = useState<ExtensionInfoDto[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => api.call("extensions:list", {}).then(setList, () => undefined);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setMessage(null);
      void refresh();
    }
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => api.on("extensions:changed", () => void refresh()), []);

  async function install() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.call("extensions:install", {});
      if (r.status === "installed") setMessage({ kind: "ok", text: `Extension installée : ${r.id} ${r.version}. Ses commandes sont disponibles.` });
      else if (r.status === "rejected") setMessage({ kind: "error", text: r.reason ?? "Installation refusée." });
      else if (r.status === "declined") setMessage({ kind: "error", text: "Installation annulée : vous n'avez pas donné votre accord." });
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="extensions" onCancel={(e) => (e.preventDefault(), onClose())} aria-label="Extensions">
      <h2>Extensions</h2>
      {developerMode && <p className="warning">Mode développeur actif : des extensions non signées peuvent être installées.</p>}
      <ul className="extension-list">
        {list.map((e) => (
          <li key={e.id} className={e.status}>
            <div>
              <strong>{e.id}</strong> <span className="hint">{e.version}, {e.publisher}</span>
              {!e.signed && <span className="warning"> Non signée</span>}
              {e.status === "disabled" && <p className="error">{e.reason}</p>}
              {e.commands.length > 0 && <p className="hint">Apporte : {e.commands.join(", ")}</p>}
            </div>
            {!e.builtIn && (
              <button className="link" onClick={() => void api.call("extensions:uninstall", { id: e.id })}>
                Désinstaller
              </button>
            )}
          </li>
        ))}
      </ul>
      {message && <p className={message.kind === "ok" ? "hint" : "error"}>{message.text}</p>}
      <div className="row end">
        <button onClick={onClose}>Fermer</button>
        <button className="primary" disabled={busy} onClick={() => void install()}>
          {busy ? "Installation…" : "Installer depuis un fichier"}
        </button>
      </div>
    </dialog>
  );
}
