/**
 * L'US donnée par une issue GitHub (ADR 0078) : `gh` vérifié, puis l'issue, ses commentaires et ses
 * dépendances lus par le code, en lecture seule. `gh` est doublé : on vérifie les appels et ce qu'on
 * en tire, sans réseau.
 */
import { describe, expect, it } from "vitest";
import { bloqueursOuverts, createGhIssues, lireRefIssue, refsCitees, rendreContexte } from "../src/issues.js";
import type { CommandResult, CommandRunner } from "../src/protocols.js";

const issue = (n: number, o: { titre?: string; etat?: "open" | "closed"; corps?: string; depot?: string } = {}) => ({
  number: n,
  title: o.titre ?? `Issue ${n}`,
  state: o.etat ?? "open",
  html_url: `https://github.com/${o.depot ?? "org/app"}/issues/${n}`,
  body: o.corps ?? "",
  labels: [{ name: "us" }],
  user: { login: "po" },
});

/** `gh` doublé : chaque route d'API rend une réponse JSON, ou une erreur (code, texte). */
function gh(routes: Record<string, unknown | { code: number; stderr: string }>, o: { absent?: boolean; nonConnecte?: boolean } = {}) {
  const appels: string[] = [];
  const runner: CommandRunner = {
    async run(cmd, args): Promise<CommandResult> {
      appels.push([cmd, ...args].join(" "));
      if (o.absent) throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
      if (args[0] === "--version") return { code: 0, stdout: "gh version 2.102.0", stderr: "" };
      if (args[0] === "auth") return o.nonConnecte ? { code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts." } : { code: 0, stdout: "", stderr: "" };
      const route = args.find((a) => a.startsWith("repos/"))!.replace(/\?.*$/, "");
      const r = routes[route];
      if (r === undefined) return { code: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
      if (typeof r === "object" && r !== null && "code" in r) {
        const e = r as unknown as { code: number; stderr: string };
        return { code: e.code, stdout: "", stderr: e.stderr };
      }
      return { code: 0, stdout: JSON.stringify(r), stderr: "" };
    },
  };
  return { runner, appels };
}

describe("lireRefIssue", () => {
  it("une URL d'issue, avec son hôte ; ou org/depot#n sur l'hôte par défaut", () => {
    expect(lireRefIssue("https://github.com/org/app/issues/12")).toEqual({ hostname: "github.com", owner: "org", repo: "app", numero: 12 });
    expect(lireRefIssue("https://ghe.exemple.fr/equipe/app/issues/7#issuecomment-1")).toEqual({ hostname: "ghe.exemple.fr", owner: "equipe", repo: "app", numero: 7 });
    expect(lireRefIssue("org/app#12", "ghe.exemple.fr")).toEqual({ hostname: "ghe.exemple.fr", owner: "org", repo: "app", numero: 12 });
    expect(lireRefIssue("stories/US-2.md")).toBeNull();
    expect(lireRefIssue("https://github.com/org/app/pull/3")).toBeNull();
  });
});

describe("refsCitees", () => {
  it("les #n du même dépôt et les liens d'issues, sans l'issue elle-même ni les doublons", () => {
    const ref = { hostname: "github.com", owner: "org", repo: "app", numero: 12 };
    expect(refsCitees("Voir #34 et #12, puis https://github.com/org/lib/issues/5 et encore #34.", ref)).toEqual([
      { hostname: "github.com", owner: "org", repo: "app", numero: 34 },
      { hostname: "github.com", owner: "org", repo: "lib", numero: 5 },
    ]);
  });
});

describe("createGhIssues : verifier", () => {
  const ref = { hostname: "github.com", owner: "org", repo: "app", numero: 12 };
  it("gh absent : dit de l'installer", async () => {
    expect(await createGhIssues({ runner: gh({}, { absent: true }).runner }).verifier(ref)).toEqual({ ok: false, motif: expect.stringMatching(/gh.*n'est pas installé.*cli\.github\.com/s) });
  });
  it("non connecté à l'hôte : dit la commande de connexion", async () => {
    expect(await createGhIssues({ runner: gh({}, { nonConnecte: true }).runner }).verifier(ref)).toEqual({ ok: false, motif: expect.stringContaining("gh auth login --hostname github.com") });
  });
  it("dépôt illisible : refusé, avec le dépôt ; lisible : ok", async () => {
    expect(await createGhIssues({ runner: gh({}).runner }).verifier(ref)).toEqual({ ok: false, motif: expect.stringContaining("org/app") });
    expect(await createGhIssues({ runner: gh({ "repos/org/app": { full_name: "org/app" } }).runner }).verifier(ref)).toEqual({ ok: true });
  });
});

describe("createGhIssues : lire", () => {
  const ref = { hostname: "github.com", owner: "org", repo: "app", numero: 12 };
  const routes = {
    "repos/org/app/issues/12": issue(12, { titre: "Payer par carte", corps: "En tant que client… Voir #40." }),
    "repos/org/app/issues/12/comments": [{ user: { login: "po" }, body: "Plafond : 500 €.", created_at: "2026-11-01T10:00:00Z" }],
    "repos/org/app/issues/12/parent": issue(1, { titre: "Epic paiement" }),
    "repos/org/app/issues/12/sub_issues": [issue(13)],
    "repos/org/app/issues/12/dependencies/blocked_by": [issue(10, { titre: "Créer le compte client", etat: "closed" })],
    "repos/org/app/issues/12/dependencies/blocking": [issue(14)],
    "repos/org/app/issues/40": issue(40, { titre: "Moyens de paiement acceptés" }),
  };

  it("l'issue, ses commentaires, sa parente, ses sous-issues, ses bloqueurs, ce qu'elle bloque, les issues citées", async () => {
    const { runner, appels } = gh(routes);
    const us = await createGhIssues({ runner }).lire(ref);
    expect(us.issue).toMatchObject({ numero: 12, titre: "Payer par carte", etat: "open" });
    expect(us.commentaires).toEqual([{ auteur: "po", corps: "Plafond : 500 €.", date: "2026-11-01T10:00:00Z" }]);
    expect(us.parent?.titre).toBe("Epic paiement");
    expect(us.sousIssues.map((i) => i.numero)).toEqual([13]);
    expect(us.bloqueePar.map((i) => [i.numero, i.etat])).toEqual([[10, "closed"]]);
    expect(us.bloque.map((i) => i.numero)).toEqual([14]);
    expect(us.citees.map((i) => i.numero)).toEqual([40]);
    expect(us.lacunes).toEqual([]);
    expect(appels.every((a) => a.includes("--hostname github.com"))).toBe(true);
    expect(appels.some((a) => / -X | --method /.test(a))).toBe(false);
  });

  it("pas de parente (404) : rien ; une API absente (instance ancienne) : notée, le reste est lu", async () => {
    const { parent: _p, ...sans } = { ...routes, parent: 0 };
    const r = { ...sans } as Record<string, unknown>;
    delete r["repos/org/app/issues/12/parent"];
    r["repos/org/app/issues/12/dependencies/blocked_by"] = { code: 1, stderr: "gh: Not Found (HTTP 404)" };
    r["repos/org/app/issues/12/sub_issues"] = { code: 1, stderr: "HTTP 500" };
    const us = await createGhIssues({ runner: gh(r).runner }).lire(ref);
    expect(us.parent).toBeUndefined();
    expect(us.sousIssues).toEqual([]);
    // Un 404 sur une liste veut dire « API absente » (instance ancienne) : noté, contrairement à la parente.
    expect(us.lacunes).toEqual([expect.stringMatching(/sous-issues.*HTTP 500/), expect.stringMatching(/bloquée par.*404/)]);
    expect(us.issue.numero).toBe(12);
  });

  it("l'issue elle-même illisible : erreur, avec la raison de gh", async () => {
    await expect(createGhIssues({ runner: gh({}).runner }).lire(ref)).rejects.toThrow(/org\/app#12.*Not Found/);
  });

  it("les issues citées sont bornées", async () => {
    const corps = Array.from({ length: 30 }, (_, i) => `#${100 + i}`).join(" ");
    const r: Record<string, unknown> = { "repos/org/app/issues/12": issue(12, { corps }) };
    for (const l of ["comments", "sub_issues", "dependencies/blocked_by", "dependencies/blocking"]) r[`repos/org/app/issues/12/${l}`] = [];
    for (let i = 0; i < 30; i++) r[`repos/org/app/issues/${100 + i}`] = issue(100 + i);
    const us = await createGhIssues({ runner: gh(r).runner }).lire(ref);
    expect(us.citees).toHaveLength(10);
    expect(us.lacunes).toEqual([expect.stringMatching(/20 issues citées non lues/)]);
  });
});

describe("bloqueursOuverts et rendreContexte", () => {
  const base = {
    ref: { hostname: "github.com", owner: "org", repo: "app", numero: 12 },
    issue: { numero: 12, titre: "Payer par carte", etat: "open" as const, url: "u12", corps: "En tant que client…", labels: ["us"] },
    commentaires: [{ auteur: "po", corps: "Plafond : 500 €.", date: "2026-11-01T10:00:00Z" }],
    sousIssues: [],
    bloque: [],
    citees: [],
    lacunes: [],
  };
  it("seuls les bloqueurs encore ouverts empêchent de démarrer", () => {
    const ouvert = { numero: 10, titre: "Créer le compte", etat: "open" as const, url: "u10", corps: "", labels: [] };
    expect(bloqueursOuverts({ ...base, bloqueePar: [ouvert, { ...ouvert, numero: 11, etat: "closed" as const }] }).map((i) => i.numero)).toEqual([10]);
  });
  it("le contexte dit l'issue, ses commentaires et chaque dépendance, avec son état", () => {
    const md = rendreContexte({ ...base, bloqueePar: [{ numero: 10, titre: "Créer le compte", etat: "closed", url: "u10", corps: "", labels: [] }], parent: { numero: 1, titre: "Epic", etat: "open", url: "u1", corps: "Le paiement.", labels: [] } });
    expect(md).toMatch(/^# Contexte GitHub de org\/app#12 — Payer par carte/);
    expect(md).toContain("Plafond : 500 €.");
    expect(md).toMatch(/## Issue parente[\s\S]*#1 — Epic \(ouverte\)/);
    expect(md).toMatch(/## Bloquée par[\s\S]*#10 — Créer le compte \(fermée\)/);
  });
});
