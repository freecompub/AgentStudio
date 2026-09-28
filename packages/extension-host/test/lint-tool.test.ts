/**
 * Outil `run_lint` : rendre le linter du projet accessible à l'agent **pendant** son travail.
 *
 * `StackAdapter.lint()` existait déjà, mais n'était lu qu'après coup par la porte `deliver` :
 * l'agent découvrait le refus du linter quand la porte le recalait, et repartait pour un tour.
 * Même mesure, même source de vérité — seulement disponible plus tôt.
 *
 * Règle qui gouverne tout ce fichier : **un résumé ne doit jamais attester ce qui n'a pas été
 * mesuré.** Absence de violation ne vaut conformité que si le linter a réellement examiné les
 * fichiers. Sans quoi l'agent lit « aucune violation » et coche C4 sur du vide.
 */
import { describe, expect, it, vi } from "vitest";
import type { LintReport } from "@agent-studio/stack-adapters";
import { runLintTool, summarizeLint } from "../src/lint-tool.js";

const outil = (lint: (opts: { files?: string[] }) => Promise<LintReport | null>) =>
  runLintTool({ lint: (o) => lint(o) }, { beat: () => undefined });

describe("summarizeLint", () => {
  it("pas de linter configuré : le dit, et dit que ça ne vaut pas conformité", () => {
    const s = summarizeLint({ available: false, violations: [] });
    expect(s).toContain("aucun linter");
    expect(s).toMatch(/ne vaut pas|ne prouve/i);
    expect(s).not.toMatch(/aucune violation|conforme/i);
  });

  it("linter présent mais qui n'a examiné aucun fichier : refuse d'en conclure quoi que ce soit", () => {
    // ESLint qui ignore le fichier demandé, SwiftLint filtré sur la sévérité : l'outil a tourné,
    // il rend zéro violation, et il n'a rien jugé. C'est le défaut réintroduit trois fois en S6.
    const s = summarizeLint({ available: true, tool: "eslint", analyzed: [], violations: [] });
    expect(s).toContain("n'a examiné aucun fichier");
    expect(s).not.toMatch(/aucune violation|conforme/i);
  });

  it("fichiers examinés et rien trouvé : là, et seulement là, le dit", () => {
    const s = summarizeLint({ available: true, tool: "eslint", analyzed: ["src/a.ts", "src/b.ts"], violations: [] });
    expect(s).toContain("2 fichier(s)");
    expect(s).toMatch(/aucune violation/i);
  });

  it("violations : fichier, ligne, règle et message, tronqués", () => {
    const s = summarizeLint({
      available: true,
      tool: "eslint",
      analyzed: ["src/a.ts"],
      violations: [{ file: "src/a.ts", line: 12, rule: "complexity", message: "trop complexe" }],
    });
    expect(s).toContain("src/a.ts:12");
    expect(s).toContain("complexity");
    expect(s).toContain("trop complexe");
  });

  it("beaucoup de violations : en montre un nombre borné et annonce le reste", () => {
    const violations = Array.from({ length: 60 }, (_, i) => ({ file: `src/f${i}.ts`, rule: "r", message: "m" }));
    const s = summarizeLint({ available: true, tool: "eslint", analyzed: ["src/f0.ts"], violations });
    expect(s.split("\n").length).toBeLessThan(40);
    expect(s).toContain("60");
  });
});

describe("runLintTool", () => {
  it("la stack ne sait pas linter : le dit sans rien attester", async () => {
    const r = await outil(async () => null).handler({});
    expect(String(r)).toMatch(/ne propose pas de linter/i);
    expect(String(r)).not.toMatch(/aucune violation|conforme/i);
  });

  it("réarme le watchdog : un linter lent ne doit pas passer pour une session inactive", async () => {
    const beat = vi.fn();
    const t = runLintTool({ lint: async () => ({ available: true, analyzed: ["a"], violations: [] }) }, { beat });
    await t.handler({});
    expect(beat).toHaveBeenCalled();
  });

  it("transmet les fichiers demandés, et n'en accepte pas d'autre forme", async () => {
    const lint = vi.fn(async () => ({ available: true, analyzed: ["src/a.ts"], violations: [] }) as LintReport);
    await runLintTool({ lint }, { beat: () => undefined }).handler({ files: ["src/a.ts"] });
    expect(lint).toHaveBeenCalledWith({ files: ["src/a.ts"] });
    await runLintTool({ lint }, { beat: () => undefined }).handler({});
    expect(lint).toHaveBeenLastCalledWith({});
  });

  it("ne rend jamais de preuve : le linter informe l'agent, il n'atteste rien pour la porte", () => {
    // La porte `deliver` relance le linter elle-même (deliver-effects.ts). Enregistrer cette
    // exécution-ci comme preuve laisserait l'agent choisir le moment de la mesure.
    expect(runLintTool({ lint: async () => null }, { beat: () => undefined }).name).toBe("run_lint");
  });
});
