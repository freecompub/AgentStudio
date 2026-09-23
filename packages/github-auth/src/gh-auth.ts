import type { AuthStatus, CommandRunner, GitHubAuth, ProcessSpawner, TokenKind } from "./protocols.js";

export interface GhAuthDeps {
  runner: CommandRunner;
  spawner: ProcessSpawner;
  hostname?: string;
}

export function tokenKindOf(token: string): TokenKind {
  if (token.startsWith("gho_") || token.startsWith("ghu_")) return "oauth";
  if (token.startsWith("ghp_")) return "classic-pat";
  if (token.startsWith("github_pat_")) return "fine-grained-pat";
  return "unknown";
}

const DEVICE_CODE = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/;

/** Authentification déléguée à GitHub CLI (`gh auth …`, D4). */
export function createGhAuth(deps: GhAuthDeps): GitHubAuth {
  const host = deps.hostname ?? "github.com";

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
    if (s.code !== 0) return { loggedIn: false };
    const user = await gh("api", "--hostname", host, "user", "--jq", ".login");
    const token = await gh("auth", "token", "--hostname", host);
    if (user.code !== 0 || token.code !== 0) return { loggedIn: false };
    const tokenKind = tokenKindOf(token.stdout.trim());
    return { loggedIn: true, user: user.stdout.trim(), tokenKind, copilotCompatible: tokenKind !== "classic-pat" };
  }

  return {
    status,

    async token() {
      const r = await gh("auth", "token", "--hostname", host);
      const token = r.stdout.trim();
      if (r.code !== 0 || !token) throw new Error("Vous n'êtes pas connecté à GitHub.");
      return token;
    },

    async login(onCode) {
      const proc = deps.spawner.spawn("gh", ["auth", "login", "--hostname", host, "--git-protocol", "https", "--web"]);
      let buffer = "";
      let sent = false;
      proc.onOutput((chunk) => {
        buffer += chunk;
        const m = DEVICE_CODE.exec(buffer);
        if (m?.[1] && !sent) {
          sent = true;
          onCode({ code: m[1], verificationUrl: `https://${host}/login/device` });
          proc.write("\n"); // valide « Press Enter to open … in your browser »
        }
      });
      const code = await proc.exited;
      if (code !== 0) throw new Error(`La connexion GitHub a échoué (code ${code}).`);
      return status();
    },
  };
}
