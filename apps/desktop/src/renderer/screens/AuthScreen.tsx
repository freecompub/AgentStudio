import { useEffect, useState } from "react";
import type { AuthStatusDto, EventPayload } from "../../shared/ipc-contract";
import { api } from "../api";

export function AuthScreen({ status, onDone }: { status: AuthStatusDto; onDone: () => void }) {
  const [code, setCode] = useState<EventPayload<"auth:device-code"> | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => api.on("auth:device-code", setCode), []);

  const patRefused = status.loggedIn && !status.copilotCompatible;

  async function login() {
    setPending(true);
    setError(null);
    setCode(null);
    try {
      const next = await api.call("auth:login", {});
      if (next.loggedIn && next.copilotCompatible) onDone();
      else setError("La connexion n'a pas abouti. Réessayez.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="centered">
      <div className="panel auth">
        <h1>Connectez votre compte GitHub</h1>
        {patRefused ? (
          <p>
            Vous êtes connecté en tant que <strong>{status.user}</strong> avec un jeton personnel classique. Copilot ne
            l'accepte pas : reconnectez-vous par le navigateur.
          </p>
        ) : (
          <p>L'agent utilise votre abonnement GitHub Copilot. La connexion se fait dans votre navigateur.</p>
        )}

        {code ? (
          <div className="device">
            <p>Saisissez ce code sur la page GitHub qui vient de s'ouvrir :</p>
            <output className="device-code" aria-live="polite">
              {code.code}
            </output>
            <button className="link" onClick={() => void api.call("shell:open-device-page", {})}>
              Rouvrir la page GitHub
            </button>
            <p className="hint">Cette fenêtre continuera toute seule une fois le code validé.</p>
          </div>
        ) : (
          <button className="primary" disabled={pending} onClick={() => void login()}>
            {pending ? "Ouverture de GitHub…" : "Se connecter avec GitHub"}
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}
