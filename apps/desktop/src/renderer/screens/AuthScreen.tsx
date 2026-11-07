import { useEffect, useState } from "react";
import type { AuthStatusDto, EventPayload, RuntimeKindDto, RuntimeStatusDto } from "../../shared/ipc-contract";
import { api } from "../api";
import { RUNTIMES } from "../runtimes";

/** Où se connecter. D'autres fournisseurs d'IA viendront s'ajouter ici (D35). */
type Cible = "github" | "enterprise";

export function AuthScreen({ status, runtime, onDone }: { status: AuthStatusDto; runtime: RuntimeStatusDto; onDone: () => void }) {
  const [code, setCode] = useState<EventPayload<"auth:device-code"> | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dejaEnterprise = status.hostname !== "github.com";
  const [cible, setCible] = useState<Cible>(dejaEnterprise ? "enterprise" : "github");
  const [domaine, setDomaine] = useState(dejaEnterprise ? status.hostname : "");

  async function ouvrirPage() {
    try {
      await api.call("shell:open-device-page", {});
    } catch (err) {
      setError(`Impossible d'ouvrir le navigateur : ${(err as Error).message}. Ouvrez l'adresse affichée manuellement.`);
    }
  }

  useEffect(() => api.on("auth:device-code", (next) => {
    setCode(next);
    void ouvrirPage();
  }), []);

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

  async function choisir(r: RuntimeKindDto) {
    setError(null);
    try {
      await api.call("runtime:set", { runtime: r });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Runtime des agents (ADR 0070), proposé seulement si l'application sait lancer Claude.
  const choix =
    runtime.disponibles.length > 1 ? (
      <fieldset className="cibles">
        <legend>Quels agents ?</legend>
        {runtime.disponibles.map((r) => (
          <label key={r}>
            <input type="radio" name="runtime" checked={runtime.choisi === r} onChange={() => void choisir(r)} />
            <span>{RUNTIMES[r]}</span>
          </label>
        ))}
      </fieldset>
    ) : null;

  if (runtime.choisi === "claude")
    return (
      <main className="centered">
        <div className="panel auth">
          <h1>Connectez Claude Code</h1>
          {choix}
          {runtime.claude?.etat === "absent" ? (
            <p>
              Claude Code (claude) n'est pas installé sur cette machine : installez-le, puis connectez-vous avec{" "}
              <code>claude auth login</code> dans un terminal.
            </p>
          ) : (
            <p>
              Les agents utilisent votre connexion à Claude Code. Lancez <code>claude auth login</code> dans un terminal
              et suivez les instructions, puis revenez ici.
            </p>
          )}
          <button className="primary" onClick={onDone}>
            Vérifier la connexion
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      </main>
    );

  return (
    <main className="centered">
      <div className="panel auth">
        <h1>Connectez votre compte GitHub</h1>
        {choix}
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
            <p>Saisissez ce code sur la page GitHub :</p>
            <output className="device-code" aria-live="polite">
              {code.code}
            </output>
            <p className="hint">{code.verificationUrl}</p>
            <button className="link" onClick={() => void ouvrirPage()}>
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
