import type { AuthStatus, CommandRunner, GitHubAuth, ProcessSpawner, TokenKind } from "./protocols.js";

export interface GhAuthDeps {
  runner: CommandRunner;
  spawner: ProcessSpawner;
  hostname?: string;
  /** Délai d'apparition du code de connexion ; au-delà, la connexion est abandonnée. */
  deviceCodeTimeoutMs?: number;
}

export function tokenKindOf(token: string): TokenKind {
  if (token.startsWith("gho_") || token.startsWith("ghu_")) return "oauth";
  if (token.startsWith("ghp_")) return "classic-pat";
  if (token.startsWith("github_pat_")) return "fine-grained-pat";
  return "unknown";
}

const DEVICE_CODE = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/;

/**
 * Nom d'hôte acceptable : un domaine, rien d'autre. Ce texte vient de l'utilisateur et part en
 * argument de `gh` — refuser tout ce qui pourrait passer pour une option ou un chemin.
 */
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function verifierHote(h: string): string {
  if (!HOSTNAME.test(h)) throw new Error(`Hôte GitHub refusé : « ${h} ». Attendu un domaine, par exemple github.exemple.fr.`);
  return h;
}

/** Authentification déléguée à GitHub CLI (`gh auth …`, D4). */
export function createGhAuth(deps: GhAuthDeps): GitHubAuth {
  let host = deps.hostname ? verifierHote(deps.hostname) : "github.com";

  async function gh(...args: string[]) {
    try {
      return await deps.runner.run("gh", args);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error("GitHub CLI (gh) introuvable : installez-le depuis https://cli.github.com puis relancez l'application.", { cause: err });
      throw err;
    }
  }

  async function status(): Promise<AuthStatus> {
    const s = await gh("auth", "status", "--hostname", host);
    if (s.code !== 0) return { loggedIn: false, hostname: host };
    const user = await gh("api", "--hostname", host, "user", "--jq", ".login");
    const token = await gh("auth", "token", "--hostname", host);
    if (user.code !== 0 || token.code !== 0) return { loggedIn: false, hostname: host };
    const tokenKind = tokenKindOf(token.stdout.trim());
    return { loggedIn: true, user: user.stdout.trim(), tokenKind, copilotCompatible: tokenKind !== "classic-pat", hostname: host };
  }

  return {
    status,

    hostname: () => host,

    async logout() {
      // `gh` sort en erreur si aucun compte n'est connecté : ce n'est pas un échec pour nous.
      await gh("auth", "logout", "--hostname", host);
    },

    async token() {
      const r = await gh("auth", "token", "--hostname", host);
      const token = r.stdout.trim();
      if (r.code !== 0 || !token) throw new Error("Vous n'êtes pas connecté à GitHub.");
      return token;
    },

    async login(onCode, opts) {
      // L'hôte visé ne devient l'hôte courant qu'une fois la connexion réussie : un échec
      // laisserait sinon toute la session pointée sur la mauvaise instance.
      const cible = opts?.hostname !== undefined ? verifierHote(opts.hostname) : host;
      const proc = deps.spawner.spawn("gh", ["auth", "login", "--hostname", cible, "--git-protocol", "https", "--web"]);
      let buffer = "";
      let sent = false;
      const vu = new Promise<void>((resolve) => {
        proc.onOutput((chunk) => {
          buffer += chunk;
          const m = DEVICE_CODE.exec(buffer);
          if (m?.[1] && !sent) {
            sent = true;
            onCode({ code: m[1], verificationUrl: `https://${cible}/login/device` });
            proc.write("\n"); // valide « Press Enter to open … in your browser »
            resolve();
          }
        });
      });

      // `gh` attend cet appui sur Entrée : sans code reconnu, il ne rend jamais la main.
      // Un format de message qui change ne doit pas figer l'application.
      const delai = deps.deviceCodeTimeoutMs ?? 60_000;
      let minuteur: ReturnType<typeof setTimeout> | undefined;
      const expire = new Promise<never>((_, reject) => {
        minuteur = setTimeout(() => reject(new Error("Le code de connexion GitHub n'est pas apparu à temps. Réessayez, ou lancez `gh auth login --web` dans un terminal.")), delai);
      });
      try {
        await Promise.race([vu, proc.exited, expire]);
      } catch (err) {
        proc.kill?.();
        throw err;
      } finally {
        clearTimeout(minuteur);
      }

      const code = await proc.exited;
      if (code !== 0) throw new Error(`La connexion GitHub a échoué (code ${code}).`);
      host = cible;
      return status();
    },
  };
}
