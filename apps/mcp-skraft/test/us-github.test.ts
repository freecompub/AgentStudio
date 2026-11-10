/**
 * Préparer une US donnée par une issue GitHub (ADR 0078) : gh vérifié, US lue, refus si un bloqueur est
 * ouvert, contexte écrit, story reprise telle quelle ou mise en forme par un agent, puis vérifiée par le
 * code (aucune valeur inventée). gh, le disque et l'agent sont doublés.
 */
import type { IssueLue, UsGithub } from "@agent-studio/github-auth";
import { describe, expect, it } from "vitest";
import { preparerUsGithub, type MiseEnForme } from "../src/us-github.js";

const issue = (numero: number, o: Partial<IssueLue> = {}): IssueLue => ({ numero, titre: `Issue ${numero}`, etat: "open", url: `https://github.com/org/app/issues/${numero}`, corps: "", labels: [], ...o });
const FORMATEE = "En tant que client, je paie par carte.\n\n## Critères d'acceptation\n\n1. Un paiement de 120 € est accepté.\n";

function us(o: Partial<UsGithub> = {}): UsGithub {
  return { ref: { hostname: "github.com", owner: "org", repo: "app", numero: 12 }, issue: issue(12, { titre: "Payer par carte", corps: FORMATEE }), commentaires: [], sousIssues: [], bloqueePar: [], bloque: [], citees: [], lacunes: [], ...o };
}

function monter(o: { us?: UsGithub; verifier?: { ok: true } | { ok: false; motif: string }; mettreEnForme?: MiseEnForme } = {}) {
  const fichiers = new Map<string, string>();
  return {
    fichiers,
    preparer: (texte = "org/app#12") =>
      preparerUsGithub({
        texte,
        hote: "github.com",
        gh: { verifier: async () => o.verifier ?? { ok: true }, lire: async () => o.us ?? us() },
        lire: async (rel) => fichiers.get(rel) ?? null,
        ecrire: async (rel, contenu) => void fichiers.set(rel, contenu),
        ...(o.mettreEnForme ? { mettreEnForme: o.mettreEnForme } : {}),
      }),
  };
}

describe("preparerUsGithub", () => {
  it("gh qui ne va pas : refus avec sa raison, rien n'est écrit", async () => {
    const m = monter({ verifier: { ok: false, motif: "`gh` n'est pas installé." } });
    expect(await m.preparer()).toEqual({ ok: false, motif: "`gh` n'est pas installé." });
    expect(m.fichiers.size).toBe(0);
  });

  it("bloquée par une issue ouverte : on ne démarre pas, et le bloqueur est nommé ; un bloqueur fermé ne gêne pas", async () => {
    const bloquee = monter({ us: us({ bloqueePar: [issue(10, { titre: "Créer le compte client" }), issue(11, { etat: "closed" })] }) });
    expect(await bloquee.preparer()).toEqual({ ok: false, motif: expect.stringMatching(/bloquée par #10 « Créer le compte client » \(ouverte\)[\s\S]*ne démarre pas/) });
    expect(bloquee.fichiers.size).toBe(0);
    expect((await monter({ us: us({ bloqueePar: [issue(11, { etat: "closed" })] }) }).preparer()).ok).toBe(true);
  });

  it("issue déjà au format, sans commentaire : reprise telle quelle, avec le lien vers son contexte", async () => {
    const m = monter();
    expect(await m.preparer()).toEqual({ ok: true, chemin: ".skraft/github/US-12.md", notes: [expect.stringMatching(/reprise telle quelle/)] });
    const story = m.fichiers.get(".skraft/github/US-12.md")!;
    expect(story).toMatch(/^# US-12 — Payer par carte\n/);
    expect(story).toContain("`.skraft/github/US-12-contexte.md`");
    expect(story).toContain("1. Un paiement de 120 € est accepté.");
    expect(m.fichiers.get(".skraft/github/US-12-contexte.md")).toMatch(/^# Contexte GitHub de org\/app#12/);
  });

  it("issue sans le format, ou avec des commentaires : mise en forme par l'agent, puis vérifiée", async () => {
    const entrees: Parameters<MiseEnForme>[0][] = [];
    const m = monter({
      us: us({ issue: issue(12, { titre: "Payer par carte", corps: "Le client paie par carte. Montant mini 10 €." }), commentaires: [{ auteur: "po", corps: "Plafond : 500 €.", date: "2026-11-01" }] }),
      mettreEnForme: async (e) => {
        entrees.push(e);
        m.fichiers.set(e.chemin, "# US-12 — Payer par carte\n\nLe client paie par carte.\n\n## Critères d'acceptation\n\n1. Un paiement de 10 € est accepté.\n2. Un paiement au-delà de 500 € est refusé.\n");
        return { ok: true };
      },
    });
    const r = await m.preparer();
    expect(r).toEqual({ ok: true, chemin: ".skraft/github/US-12.md", notes: [expect.stringMatching(/mise en forme par un agent/)] });
    expect(entrees[0]!.contexte).toContain("Plafond : 500 €.");
    // Le code ajoute lui-même le lien vers le contexte s'il manque.
    expect(m.fichiers.get(".skraft/github/US-12.md")).toContain("`.skraft/github/US-12-contexte.md`");
  });

  it("une valeur inventée est refusée : l'agent reçoit le motif ; au troisième refus, on ne démarre pas", async () => {
    const motifs: string[][] = [];
    const m = monter({
      us: us({ issue: issue(12, { titre: "Payer par carte", corps: "Plafond de 500 €." }) }),
      mettreEnForme: async (e) => {
        if (e.precedent) motifs.push(e.precedent.motifs);
        m.fichiers.set(e.chemin, "# US-12 — Payer par carte\n\nx\n\n## Critères d'acceptation\n\n1. Un paiement de 750 € est refusé.\n");
        return { ok: true };
      },
    });
    const r = await m.preparer();
    expect(motifs).toHaveLength(2);
    expect(motifs[0]).toEqual(["Critère 1 : « 750 » ne vient ni de l'issue, ni de ses commentaires, ni de ses dépendances."]);
    expect(r).toEqual({ ok: false, motif: expect.stringMatching(/refusée 3 fois[\s\S]*750/) });
  });

  it("une story mal formée ou au mauvais identifiant est refusée", async () => {
    const vues: string[][] = [];
    let n = 0;
    const m = monter({
      us: us({ issue: issue(12, { corps: "sans format" }) }),
      mettreEnForme: async (e) => {
        if (e.precedent) vues.push(e.precedent.motifs);
        m.fichiers.set(e.chemin, n++ === 0 ? "pas de titre" : "# US-99 — x\n\n## Critères d'acceptation\n\n1. a\n");
        return { ok: true };
      },
    });
    await m.preparer();
    expect(vues[0]!.join(" ")).toMatch(/Titre attendu/);
    expect(vues[1]!.join(" ")).toMatch(/US-12/);
  });

  it("sans agent de mise en forme, une issue hors format est refusée, avec ce qu'il faut faire", async () => {
    expect(await monter({ us: us({ issue: issue(12, { corps: "sans format" }) }) }).preparer()).toEqual({ ok: false, motif: expect.stringMatching(/format[\s\S]*Critères d'acceptation/) });
  });
});
