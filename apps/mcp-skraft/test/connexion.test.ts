/**
 * Authentification sans fenêtre (ADR 0068, point 7) : déjà connecté avec `gh`, rien à faire ;
 * sinon `skraft_connexion` lance le flux d'appareil et rend le code et l'adresse, sans attendre la
 * fin. Le jeton ne sort jamais.
 */
import type { AgentRuntime } from "@agent-studio/core";
import type { AuthStatus, DeviceCode, GitHubAuth } from "@agent-studio/github-auth";
import { describe, expect, it } from "vitest";
import { createConnexion } from "../src/connexion.js";

const JETON = "gho_secret";

function fauxAuth(depart: AuthStatus) {
  let status = depart;
  let fin: ((s: AuthStatus) => void) | null = null;
  let echec: ((e: Error) => void) | null = null;
  let logins = 0;
  const auth: GitHubAuth = {
    status: async () => status,
    copilotQuota: async () => null,
    token: async () => JETON,
    async login(onCode: (c: DeviceCode) => void) {
      logins++;
      onCode({ code: "ABCD-1234", verificationUrl: "https://github.com/login/device" });
      return new Promise<AuthStatus>((res, rej) => {
        fin = (s) => ((status = s), res(s));
        echec = rej;
      });
    },
    logout: async () => {},
    hostname: () => "github.com",
  };
  return {
    auth,
    valider: () => fin!({ loggedIn: true, user: "octo", tokenKind: "oauth", copilotCompatible: true, hostname: "github.com" }),
    echouer: () => echec!(new Error("Connexion abandonnée")),
    logins: () => logins,
  };
}

const connecte: AuthStatus = { loggedIn: true, user: "octo", tokenKind: "oauth", copilotCompatible: true, hostname: "github.com" };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("Connexion à GitHub sans fenêtre (ADR 0068, point 7)", () => {
  it("déjà connecté avec un jeton accepté par Copilot : rien à faire", async () => {
    const f = fauxAuth(connecte);
    const c = createConnexion(f.auth);
    expect(await c.verifier()).toEqual({ ok: true });
    expect(await c.connecter()).toEqual({ ok: true, texte: "Déjà connecté à GitHub (github.com) en tant que octo." });
    expect(f.logins()).toBe(0);
  });

  it("non connecté : les outils renvoient vers skraft_connexion, qui rend le code sans attendre la validation", async () => {
    const f = fauxAuth({ loggedIn: false, hostname: "github.com" });
    const c = createConnexion(f.auth);
    expect(await c.verifier()).toEqual({ ok: false, motif: expect.stringMatching(/Non connecté.*skraft_connexion/) });
    const r = await c.connecter();
    expect(r.texte).toContain("ABCD-1234");
    expect(r.texte).toContain("https://github.com/login/device");
    // Pendant l'attente : même code, pas de second flux.
    expect((await c.connecter()).texte).toMatch(/en attente.*ABCD-1234/s);
    expect(f.logins()).toBe(1);
    f.valider();
    await tick();
    expect(await c.connecter()).toEqual({ ok: true, texte: expect.stringMatching(/Connecté à GitHub.*octo/) });
    expect(await c.verifier()).toEqual({ ok: true });
  });

  it("jeton personnel classique, refusé par Copilot : il faut se reconnecter par le navigateur", async () => {
    const f = fauxAuth({ loggedIn: true, user: "octo", tokenKind: "classic-pat", copilotCompatible: false, hostname: "github.com" });
    const c = createConnexion(f.auth);
    expect(await c.verifier()).toEqual({ ok: false, motif: expect.stringMatching(/jeton personnel classique.*skraft_connexion/s) });
    expect((await c.connecter()).texte).toContain("ABCD-1234");
  });

  it("connexion échouée : dit une fois, puis un nouvel appel relance le flux", async () => {
    const f = fauxAuth({ loggedIn: false, hostname: "github.com" });
    const c = createConnexion(f.auth);
    await c.connecter();
    f.echouer();
    await tick();
    expect(await c.connecter()).toEqual({ ok: false, texte: expect.stringContaining("Connexion abandonnée") });
    await c.connecter();
    expect(f.logins()).toBe(2);
  });

  it("le runtime reçoit le jeton, une seule fois démarré ; non connecté, il refuse avec le motif ; le jeton n'apparaît dans aucune réponse", async () => {
    const f = fauxAuth({ loggedIn: false, hostname: "github.com" });
    const c = createConnexion(f.auth);
    const recus: string[] = [];
    let demarrages = 0;
    const runtime = c.runtime((jeton) => {
      recus.push(jeton);
      return { start: async () => void demarrages++ } as unknown as AgentRuntime;
    });
    await expect(runtime()).rejects.toThrow(/skraft_connexion/);
    const textes = [(await c.connecter()).texte];
    f.valider();
    await tick();
    textes.push((await c.connecter()).texte);
    await runtime();
    await runtime();
    expect(recus).toEqual([JETON]);
    expect(demarrages).toBe(1);
    expect(textes.join("\n")).not.toContain(JETON);
  });
});
