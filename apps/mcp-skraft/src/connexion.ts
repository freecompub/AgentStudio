/**
 * Connexion à GitHub sans fenêtre (ADR 0068, point 7), par `gh` comme l'application
 * (`@agent-studio/github-auth`). Le flux d'appareil dure le temps que l'utilisateur valide dans son
 * navigateur : `connecter()` le lance et rend aussitôt le code et l'adresse ; l'appel suivant dit où
 * il en est. Le jeton ne va qu'au runtime : il n'apparaît dans aucune réponse.
 */
import type { AgentRuntime } from "@agent-studio/core";
import type { AuthStatus, DeviceCode, GitHubAuth } from "@agent-studio/github-auth";

export type FabriqueRuntime = (jeton: string, hostname: string) => AgentRuntime;

export interface Connexion {
  /** Connexion utilisable par Copilot, ou ce qu'il faut faire. */
  verifier(): Promise<{ ok: true } | { ok: false; motif: string }>;
  /** Outil `skraft_connexion` : lance le flux, ou dit où il en est. */
  connecter(): Promise<{ ok: boolean; texte: string }>;
  /** Runtime démarré une fois, au premier besoin, avec le jeton courant. */
  runtime(fabrique: FabriqueRuntime): () => Promise<AgentRuntime>;
}

export function createConnexion(auth: GitHubAuth): Connexion {
  let flux: { code: DeviceCode; termine: boolean; erreur?: string } | null = null;

  async function verifier(): Promise<{ ok: true } | { ok: false; motif: string }> {
    const s = await auth.status();
    if (!s.loggedIn) return { ok: false, motif: `Non connecté à GitHub (${s.hostname}) : appelle skraft_connexion.` };
    if (!s.copilotCompatible)
      return {
        ok: false,
        motif: "La connexion GitHub utilise un jeton personnel classique, refusé par Copilot : appelle skraft_connexion pour te reconnecter par le navigateur.",
      };
    return { ok: true };
  }

  const consigne = (c: DeviceCode) =>
    `Ouvre ${c.verificationUrl} et saisis le code ${c.code}, puis rappelle skraft_connexion pour vérifier la connexion.`;

  async function lancer(): Promise<{ ok: boolean; texte: string }> {
    const code = await new Promise<DeviceCode>((resolve, reject) => {
      auth
        .login((c) => {
          flux = { code: c, termine: false };
          resolve(c);
        })
        .then(
          (s: AuthStatus) => {
            if (flux) flux.termine = true;
            if (!s.loggedIn && flux) flux.erreur = "la connexion n'a pas abouti";
          },
          (e: unknown) => {
            const motif = e instanceof Error ? e.message : String(e);
            if (flux) {
              flux.termine = true;
              flux.erreur = motif;
            } else reject(e);
          },
        );
    });
    return { ok: true, texte: `Connexion à GitHub lancée. ${consigne(code)}` };
  }

  return {
    verifier,
    async connecter() {
      if (flux && !flux.termine) return { ok: true, texte: `Connexion en attente de validation. ${consigne(flux.code)}` };
      if (flux?.erreur) {
        const motif = flux.erreur;
        flux = null;
        return { ok: false, texte: `La connexion à GitHub a échoué : ${motif}. Rappelle skraft_connexion pour recommencer.` };
      }
      const etaitEnCours = flux !== null;
      flux = null;
      const v = await verifier();
      if (v.ok) {
        const s = (await auth.status()) as Extract<AuthStatus, { loggedIn: true }>;
        return { ok: true, texte: etaitEnCours ? `Connecté à GitHub (${s.hostname}) en tant que ${s.user}.` : `Déjà connecté à GitHub (${s.hostname}) en tant que ${s.user}.` };
      }
      return lancer();
    },
    runtime(fabrique) {
      let demarrage: Promise<AgentRuntime> | null = null;
      return () => {
        demarrage ??= (async () => {
          const v = await verifier();
          if (!v.ok) throw new Error(v.motif);
          const rt = fabrique(await auth.token(), auth.hostname());
          await rt.start();
          return rt;
        })().catch((e: unknown) => {
          // Un échec n'est pas retenu : l'appel suivant, après connexion, réessaie.
          demarrage = null;
          throw e;
        });
        return demarrage;
      };
    },
  };
}
