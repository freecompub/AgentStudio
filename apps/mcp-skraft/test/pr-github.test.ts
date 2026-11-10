/**
 * La PR d'une US GitHub, à la fin du run (ADR 0078) : pousser la branche du run et ouvrir une PR liée à
 * l'issue (« Closes #n »). git et gh sont doublés : on vérifie les commandes, rien n'est publié.
 */
import { describe, expect, it } from "vitest";
import { publierPr } from "../src/pr-github.js";

function doublure(o: { origin?: string; prExistante?: string; echecPush?: boolean } = {}) {
  const lances: string[] = [];
  return {
    lances,
    executer: async (cmd: string, args: string[]) => {
      lances.push([cmd, ...args].join(" "));
      const a = args.join(" ");
      if (cmd === "git" && a.includes("remote get-url origin")) return { code: 0, sortie: `${o.origin ?? "https://github.com/org/app.git"}\n` };
      if (cmd === "git" && a.includes("push")) return o.echecPush ? { code: 1, sortie: "rejected" } : { code: 0, sortie: "" };
      if (cmd === "gh" && a.includes("defaultBranchRef")) return { code: 0, sortie: "main\n" };
      if (cmd === "gh" && a.startsWith("pr list")) return { code: 0, sortie: o.prExistante ? `${o.prExistante}\n` : "" };
      if (cmd === "gh" && a.startsWith("pr create")) return { code: 0, sortie: "https://github.com/org/app/pull/99\n" };
      return { code: 0, sortie: "" };
    },
  };
}

const BASE = { root: "/projets/app", branche: "skraft/us-12", ref: { hostname: "github.com", owner: "org", repo: "app", numero: 12 }, titre: "US-12 — Payer par carte", bilan: "Bilan : 3 scénarios livrés." };

describe("publierPr", () => {
  it("pousse la branche, ouvre la PR sur la branche par défaut, liée à l'issue", async () => {
    const d = doublure();
    expect(await publierPr(BASE, d.executer)).toEqual({ ok: true, url: "https://github.com/org/app/pull/99", nouvelle: true });
    expect(d.lances).toContain("git -C /projets/app push -u origin skraft/us-12");
    const pr = d.lances.find((l) => l.startsWith("gh pr create"))!;
    expect(pr).toContain("--repo org/app --base main --head skraft/us-12");
    expect(pr).toContain("--title US-12 — Payer par carte");
    expect(pr).toMatch(/--body [\s\S]*Closes #12[\s\S]*Bilan : 3 scénarios livrés\./);
  });

  it("une PR déjà ouverte pour la branche : la branche est poussée, la PR existante est rendue", async () => {
    const d = doublure({ prExistante: "https://github.com/org/app/pull/7" });
    expect(await publierPr(BASE, d.executer)).toEqual({ ok: true, url: "https://github.com/org/app/pull/7", nouvelle: false });
    expect(d.lances.some((l) => l.startsWith("gh pr create"))).toBe(false);
  });

  it("le remote origin n'est pas le dépôt de l'issue : rien n'est poussé", async () => {
    const d = doublure({ origin: "git@github.com:autre/depot.git" });
    expect(await publierPr(BASE, d.executer)).toEqual({ ok: false, motif: expect.stringMatching(/origin.*autre\/depot.*org\/app/) });
    expect(d.lances.some((l) => l.includes("push"))).toBe(false);
  });

  it("origin en SSH vers le bon dépôt : accepté ; un push refusé : la raison de git", async () => {
    expect((await publierPr(BASE, doublure({ origin: "git@github.com:org/app.git" }).executer)).ok).toBe(true);
    expect(await publierPr(BASE, doublure({ echecPush: true }).executer)).toEqual({ ok: false, motif: expect.stringMatching(/push.*rejected/) });
  });

  it("une issue d'un autre dépôt que celui du projet est liée par son nom complet", async () => {
    const d = doublure({ origin: "https://github.com/org/app.git" });
    await publierPr({ ...BASE, depotDuProjet: { owner: "org", repo: "app" }, ref: { ...BASE.ref, repo: "backlog" } }, d.executer);
    expect(d.lances.find((l) => l.startsWith("gh pr create"))).toMatch(/Closes org\/backlog#12/);
  });
});
