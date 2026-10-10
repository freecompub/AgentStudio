import { describe, expect, it } from "vitest";
import { createGhAuth } from "../src/gh-auth.js";
import type { CommandResult, CommandRunner, InteractiveProcess, ProcessSpawner } from "../src/protocols.js";

function runner(table: Record<string, CommandResult>): CommandRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(cmd, args) {
      const key = [cmd, ...args].join(" ");
      calls.push(key);
      const r = table[key];
      if (!r) throw new Error(`commande inattendue : ${key}`);
      return r;
    },
  };
}

const ok = (stdout: string): CommandResult => ({ code: 0, stdout, stderr: "" });
const ko = (stderr: string): CommandResult => ({ code: 1, stdout: "", stderr });

const LOGGED_IN = {
  "gh auth status --hostname github.com": ok(""),
  "gh api --hostname github.com user --jq .login": ok("octo\n"),
  "gh auth token --hostname github.com": ok("gho_abc\n"),
};

describe("GhAuth", () => {
  it("statut connecté avec le nom d'utilisateur", async () => {
    const auth = createGhAuth({ runner: runner(LOGGED_IN), spawner: null as never });
    expect(await auth.status()).toEqual({ loggedIn: true, user: "octo", tokenKind: "oauth", copilotCompatible: true, hostname: "github.com" });
  });

  it.each([
    ["ghp_x", "classic-pat", false],
    ["github_pat_x", "fine-grained-pat", true],
    ["gho_x", "oauth", true],
    ["autre", "unknown", true],
  ] as const)("jeton %s : nature %s, compatible Copilot = %s", async (token, tokenKind, copilotCompatible) => {
    const auth = createGhAuth({
      runner: runner({ ...LOGGED_IN, "gh auth token --hostname github.com": ok(`${token}\n`) }),
      spawner: null as never,
    });
    expect(await auth.status()).toMatchObject({ tokenKind, copilotCompatible });
  });

  it("statut déconnecté", async () => {
    const auth = createGhAuth({
      runner: runner({ "gh auth status --hostname github.com": ko("You are not logged into any GitHub hosts") }),
      spawner: null as never,
    });
    expect(await auth.status()).toEqual({ loggedIn: false, hostname: "github.com" });
  });

  it("gh absent : message explicite", async () => {
    const auth = createGhAuth({
      runner: { run: async () => Promise.reject(Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" })) },
      spawner: null as never,
    });
    await expect(auth.status()).rejects.toThrow(/GitHub CLI.*introuvable/);
  });

  it("jeton : sortie de gh auth token, espaces retirés", async () => {
    const auth = createGhAuth({
      runner: runner({ "gh auth token --hostname github.com": ok("gho_abc\n") }),
      spawner: null as never,
    });
    expect(await auth.token()).toBe("gho_abc");
  });

  it("jeton : échec explicite si non connecté", async () => {
    const auth = createGhAuth({
      runner: runner({ "gh auth token --hostname github.com": ko("no oauth token") }),
      spawner: null as never,
    });
    await expect(auth.token()).rejects.toThrow(/connecté/);
  });

  it.each([
    ["ancien format", "! First copy your one-time code: AB12-CD34\nPress Enter to open github.com in your browser...", ["\n"]],
    ["format sans terminal de gh 2.101", "! One-time code (AB12-CD34) copied to clipboard\nOpen this URL to continue in your web browser: https://github.com/login/device", []],
  ])("connexion (%s) : transmet le code d'appareil puis renvoie le statut", async (_nom, sortie, entree) => {
    const written: string[] = [];
    let emit: (s: string) => void = () => {};
    let exit: (c: number) => void = () => {};
    const proc: InteractiveProcess = {
      onOutput: (cb) => (emit = cb),
      write: (d) => written.push(d),
      exited: new Promise((r) => (exit = r)),
    };
    const spawned: string[] = [];
    const spawner: ProcessSpawner = {
      spawn: (cmd, args) => {
        spawned.push([cmd, ...args].join(" "));
        return proc;
      },
    };
    const auth = createGhAuth({ runner: runner(LOGGED_IN), spawner });
    const codes: unknown[] = [];
    const done = auth.login((c) => codes.push(c));

    emit(sortie.slice(0, 24));
    emit(sortie.slice(24));
    exit(0);

    expect(await done).toMatchObject({ loggedIn: true, user: "octo" });
    expect(spawned[0]).toBe("gh auth login --hostname github.com --git-protocol https --web");
    expect(codes).toEqual([{ code: "AB12-CD34", verificationUrl: "https://github.com/login/device" }]);
    expect(written).toEqual(entree);
  });

  it("le statut indique l'hôte auquel on est connecté", async () => {
    const auth = createGhAuth({ runner: runner(LOGGED_IN), spawner: null as never });
    expect(await auth.status()).toMatchObject({ hostname: "github.com" });
  });

  it("GitHub Enterprise : toutes les commandes visent l'hôte choisi", async () => {
    const HOTE = "github.exemple.fr";
    const table = {
      [`gh auth status --hostname ${HOTE}`]: ok(""),
      [`gh api --hostname ${HOTE} user --jq .login`]: ok("salarie\n"),
      [`gh auth token --hostname ${HOTE}`]: ok("gho_ent\n"),
    };
    const auth = createGhAuth({ runner: runner(table), spawner: null as never, hostname: HOTE });
    expect(await auth.status()).toMatchObject({ loggedIn: true, user: "salarie", hostname: HOTE });
  });

  it("se connecter à une instance Enterprise vise cet hôte et le retient", async () => {
    const HOTE = "github.exemple.fr";
    const table = {
      [`gh auth status --hostname ${HOTE}`]: ok(""),
      [`gh api --hostname ${HOTE} user --jq .login`]: ok("salarie\n"),
      [`gh auth token --hostname ${HOTE}`]: ok("gho_ent\n"),
    };
    const spawned: string[] = [];
    const proc: InteractiveProcess = { onOutput: () => {}, write: () => {}, exited: Promise.resolve(0) };
    const auth = createGhAuth({
      runner: runner(table),
      spawner: { spawn: (cmd, args) => (spawned.push([cmd, ...args].join(" ")), proc) },
    });

    expect(await auth.login(() => {}, { hostname: HOTE })).toMatchObject({ user: "salarie", hostname: HOTE });
    expect(spawned[0]).toBe(`gh auth login --hostname ${HOTE} --git-protocol https --web`);
    // L'hôte est retenu : le statut suivant l'interroge sans qu'on le repasse.
    expect(await auth.status()).toMatchObject({ hostname: HOTE });
  });

  it("un hôte qui n'est pas un nom de domaine est refusé", async () => {
    const auth = createGhAuth({ runner: runner(LOGGED_IN), spawner: null as never });
    for (const mauvais of ["--version", "a b", "http://x.fr", "", "x/y"])
      await expect(auth.login(() => {}, { hostname: mauvais })).rejects.toThrow(/hôte/i);
  });

  it("déconnexion : appelle gh puis le statut redevient déconnecté", async () => {
    const table = { ...LOGGED_IN, "gh auth logout --hostname github.com": ok("") };
    const r = runner(table);
    const auth = createGhAuth({ runner: r, spawner: null as never });
    await auth.logout();
    expect(r.calls).toContain("gh auth logout --hostname github.com");
  });

  it("déconnexion : ne se plaint pas si personne n'était connecté", async () => {
    const table = { "gh auth logout --hostname github.com": ko("not logged in") };
    const auth = createGhAuth({ runner: runner(table), spawner: null as never });
    await expect(auth.logout()).resolves.toBeUndefined();
  });

  it("une connexion en échec ne change pas l'hôte courant", async () => {
    // Sinon toute la session vise ensuite la mauvaise instance : statut, jeton, déconnexion.
    const proc: InteractiveProcess = { onOutput: () => {}, write: () => {}, exited: Promise.resolve(1) };
    const auth = createGhAuth({ runner: runner(LOGGED_IN), spawner: { spawn: () => proc } });
    await expect(auth.login(() => {}, { hostname: "github.exemple.fr" })).rejects.toThrow(/a échoué/);
    expect(auth.hostname()).toBe("github.com");
    expect(await auth.status()).toMatchObject({ hostname: "github.com" });
  });

  it("code d'appareil jamais reconnu : on abandonne au lieu d'attendre indéfiniment", async () => {
    // `gh` attend un appui sur Entrée qu'on n'envoie qu'après avoir reconnu le code. Si le
    // format de son message change, sans délai personne ne rend jamais la main.
    let tue = false;
    const proc: InteractiveProcess = {
      onOutput: (cb) => cb("un message dont le format a changé"),
      write: () => {},
      kill: () => void (tue = true),
      exited: new Promise(() => {}), // ne se termine jamais
    };
    const auth = createGhAuth({ runner: runner(LOGGED_IN), spawner: { spawn: () => proc }, deviceCodeTimeoutMs: 20 });
    await expect(auth.login(() => {})).rejects.toThrow(/code de connexion/i);
    expect(tue).toBe(true);
  });

  it("connexion : échec si gh se termine en erreur", async () => {
    const proc: InteractiveProcess = { onOutput: () => {}, write: () => {}, exited: Promise.resolve(1) };
    const auth = createGhAuth({ runner: runner(LOGGED_IN), spawner: { spawn: () => proc } });
    await expect(auth.login(() => {})).rejects.toThrow(/connexion GitHub a échoué/);
  });
});

/**
 * Réserve de requêtes premium Copilot (ADR 0044).
 *
 * Le 29/09, six runs de mesure ont été lancés dans la journée ; le dernier s'est arrêté sans que
 * rien n'indique pourquoi il fallait s'arrêter. La réserve était à **28 requêtes sur 1500**, et
 * `overage_permitted: false` — à zéro, les appels sont refusés, pas facturés. L'information
 * existait, à un appel d'ici, et personne ne la demandait.
 *
 * La charge utile ci-dessous est celle que GitHub a réellement rendue ce jour-là, réduite aux
 * champs lus. Le point d'accès n'est pas documenté publiquement : tout y est traité comme
 * facultatif, et une surprise rend `null` plutôt que d'empêcher de travailler.
 */
const QUOTA_CMD = "gh api --hostname github.com -H Editor-Version: agent-studio /copilot_internal/user";
const REPONSE_REELLE = JSON.stringify({
  login: "octo",
  copilot_plan: "individual",
  quota_reset_date: "2026-10-01",
  quota_snapshots: {
    chat: { unlimited: true, percent_remaining: 100.0 },
    completions: { unlimited: true, percent_remaining: 100.0 },
    premium_interactions: {
      entitlement: 1500,
      credits_used: 1471,
      remaining: 28,
      percent_remaining: 1.8,
      overage_permitted: false,
      unlimited: false,
    },
  },
});

describe("Réserve de requêtes premium Copilot", () => {
  const avec = (r: CommandResult) => createGhAuth({ runner: runner({ ...LOGGED_IN, [QUOTA_CMD]: r }), spawner: null as never });

  it("lit les chiffres que GitHub rend vraiment", async () => {
    expect(await avec(ok(REPONSE_REELLE)).copilotQuota()).toEqual({
      total: 1500,
      utilisees: 1471,
      restantes: 28,
      pourcentageRestant: 1.8,
      depassementAutorise: false,
      remiseAZero: "2026-10-01",
    });
  });

  it("interroge le point d'accès des éditeurs, en-tête compris : sans lui GitHub refuse", async () => {
    const r = runner({ ...LOGGED_IN, [QUOTA_CMD]: ok(REPONSE_REELLE) });
    await createGhAuth({ runner: r, spawner: null as never }).copilotQuota();
    expect(r.calls).toContain(QUOTA_CMD);
  });

  it("un dépassement autorisé est rapporté tel quel : à zéro, tout le monde ne s'arrête pas", async () => {
    const permis = REPONSE_REELLE.replace('"overage_permitted":false', '"overage_permitted":true');
    expect((await avec(ok(permis)).copilotQuota())?.depassementAutorise).toBe(true);
  });

  it.each([
    ["gh en échec", ko("HTTP 404")],
    ["réponse illisible", ok("<html>maintenance</html>")],
    ["champ premium_interactions disparu", ok(JSON.stringify({ quota_snapshots: {} }))],
    ["chiffres absents", ok(JSON.stringify({ quota_snapshots: { premium_interactions: { unlimited: true } } }))],
  ])("%s : rend null, jamais une exception — une réserve inconnue n'empêche pas de travailler", async (_, r) => {
    await expect(avec(r).copilotQuota()).resolves.toBeNull();
  });

  it("gh absent : rend null aussi, sans le message d'installation", async () => {
    const auth = createGhAuth({ runner: { run: async () => Promise.reject(Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" })) }, spawner: null as never });
    await expect(auth.copilotQuota()).resolves.toBeNull();
  });
});
