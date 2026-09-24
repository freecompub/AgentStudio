import { useEffect, useState } from "react";
import type { AuthStatusDto, EventPayload } from "../../shared/ipc-contract";
import { api } from "../api";

/** Où se connecter. D'autres fournisseurs d'IA viendront s'ajouter ici (D35). */
type Cible = "github" | "enterprise";

export function AuthScreen({ status, onDone }: { status: AuthStatusDto; onDone: () => void }) {
  const [code, setCode] = useState<EventPayload<"auth:device-code"> | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dejaEnterprise = status.hostname !== "github.com";
  const [cible, setCible] = useState<Cible>(dejaEnterprise ? "enterprise" : "github");
  const [domaine, setDomaine] = useState(dejaEnterprise ? status.hostname : "");

  useEffect(() => api.on("auth:device-code", setCode), []);

  const patRefused = status.loggedIn && !status.copilotCompatible;
  const pretAConnecter = cible === "github" || domaine.trim().length > 0;

  async function login() {
    setPending(true);
    setError(null);
    setCode(null);
    try {
      const next = await api.call("auth:login", cible === "enterprise" ? { hostname: domaine.trim() } : {});
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
          <>
            <fieldset className="cibles">
              <legend>Où se trouve votre compte ?</legend>
              <label>
                <input type="radio" name="cible" checked={cible === "github"} onChange={() => setCible("github")} />
                <span>GitHub.com</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="cible"
                  checked={cible === "enterprise"}
                  onChange={() => setCible("enterprise")}
                />
                <span>GitHub Enterprise</span>
              </label>
            </fieldset>

            {cible === "enterprise" && (
              <div className="stack">
                <label>
                  Adresse de votre instance
                  <input
                    type="text"
                    value={domaine}
                    onChange={(e) => setDomaine(e.target.value)}
                    placeholder="github.exemple.fr"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <span className="hint">Le domaine seul, sans https:// ni chemin.</span>
              </div>
            )}

            <button className="primary" disabled={pending || !pretAConnecter} onClick={() => void login()}>
              {pending ? "Ouverture de GitHub…" : "Se connecter avec GitHub"}
            </button>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}
