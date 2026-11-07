import { manifest as tddManifest } from "@agent-studio/ext-tdd";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../src/validate.js";

const base = () => structuredClone({ ...tddManifest, main: "dist/index.js" }) as Record<string, any>;

function errorsOf(m: unknown): string[] {
  const r = validateManifest(m, { appApi: "0.1.0" });
  return r.ok ? [] : r.errors;
}

describe("Validation du manifeste (§5.1, D11, D13)", () => {
  it("le manifeste de tdd est valide", () => {
    const r = validateManifest(base(), { appApi: "0.1.0" });
    expect(r.ok).toBe(true);
  });

  it("champs obligatoires et formats", () => {
    expect(errorsOf({})).toEqual(expect.arrayContaining([expect.stringMatching(/^id/), expect.stringMatching(/^version/)]));
    expect(errorsOf({ ...base(), id: "Pas Valide" })).toEqual([expect.stringMatching(/^id/)]);
    expect(errorsOf({ ...base(), version: "1.0" })).toEqual([expect.stringMatching(/^version/)]);
  });

  it("compatibilité de l'API (engines.appApi)", () => {
    expect(errorsOf({ ...base(), engines: { appApi: "^0.2" } })).toEqual(["engines.appApi : ^0.2 incompatible avec l'API 0.1.0 de l'application"]);
  });

  it("permissions : grammaire fermée", () => {
    expect(errorsOf({ ...base(), permissions: [...base().permissions, "root:all"] })).toEqual([expect.stringMatching(/permission inconnue : root:all/)]);
  });

  it("un agent ne peut écrire que sous une permission fs:write déclarée", () => {
    const m = base();
    m.permissions = m.permissions.filter((p: string) => p !== "fs:write:src/**");
    expect(errorsOf(m)).toEqual(expect.arrayContaining([expect.stringMatching(/tdd-dev.*src\/\*\*/)]));
  });

  it("run_tests exige shell:test", () => {
    const m = base();
    m.permissions = m.permissions.filter((p: string) => p !== "shell:test");
    expect(errorsOf(m)).toEqual(expect.arrayContaining([expect.stringMatching(/run_tests.*shell:test/)]));
  });

  it("titres et descriptions obligatoires (D5), noms uniques", () => {
    const empty = base();
    empty.contributes.commands = [{ name: "tdd", title: "", description: "d" }];
    expect(errorsOf(empty)).toEqual([expect.stringMatching(/^contributes\.commands\.0\.title/)]);
    const dup = base();
    dup.contributes.commands = [{ name: "tdd", title: "T", description: "D" }, { name: "tdd", title: "T", description: "D" }];
    expect(errorsOf(dup)).toEqual(["commands : nom en double : tdd"]);
  });

  it("outils d'agent : standard ou déclarés par l'extension", () => {
    const m = base();
    m.contributes.agents[0].tools = ["render_adr"];
    expect(errorsOf(m)).toEqual([expect.stringMatching(/outil inconnu render_adr/)]);
    m.contributes.tools = [{ name: "render_adr", description: "Rédige un ADR" }];
    expect(errorsOf(m)).toEqual([]);
  });

  it("entrée compilée : chemin relatif sans remontée", () => {
    expect(errorsOf({ ...base(), main: "../../etc/x.js" })).toEqual([expect.stringMatching(/^main/)]);
    expect(errorsOf({ ...base(), main: "/abs/x.js" })).toEqual([expect.stringMatching(/^main/)]);
  });

  it("une tâche déclare au moins un libellé d'état ; jalons et alertes parmi ces états", () => {
    const m = base();
    m.contributes.tasks[0].milestones = ["INCONNU"];
    expect(errorsOf(m)).toEqual([expect.stringMatching(/INCONNU/)]);
  });
});

describe("Agents en fichiers Markdown et skills (D12, D26)", () => {
  const withAgent = (agent: Record<string, unknown>, skills?: unknown) => {
    const m = base();
    m.contributes.agents = [{ name: "dev", title: "Dév", output: "report_phase", ...agent }];
    if (skills !== undefined) m.contributes.skills = skills;
    return m;
  };

  it("rôle en fichier, consignes facultatives, skills déclarées et référencées (avec section)", () => {
    const m = withAgent(
      { prompt: "agents/dev.agent.md", skills: { mandatory: ["outside-in-tdd#RED"], onDemand: ["craft-discipline"] } },
      [
        { name: "outside-in-tdd", path: "skills/outside-in-tdd" },
        { name: "craft-discipline", path: "skills/craft-discipline/SKILL.md" },
      ],
    );
    expect(errorsOf(m)).toEqual([]);
  });

  it("ni fichier ni consignes : refusé", () => {
    expect(errorsOf(withAgent({}))).toEqual(["agents.dev : ni fichier de rôle (prompt) ni consignes (role)"]);
  });

  it("chemins hors du dossier de l'extension, ou qui ne sont pas des .md : refusés", () => {
    for (const prompt of ["../x.md", "/etc/x.md", "agents/../../x.md", "agents/./x.md", "C:/x.md"])
      expect(errorsOf(withAgent({ prompt })), prompt).toEqual([expect.stringMatching(/^contributes\.agents\.0\.prompt : chemin relatif/)]);
    expect(errorsOf(withAgent({ prompt: "agents/dev.txt" }))).toEqual([expect.stringMatching(/fichier \.md attendu/)]);
    expect(errorsOf(withAgent({ role: "r" }, [{ name: "s", path: "../s" }]))).toEqual([expect.stringMatching(/^contributes\.skills\.0\.path : chemin relatif/)]);
  });

  it("skill référencée mais non déclarée, ou déclarée deux fois : refusé", () => {
    expect(errorsOf(withAgent({ role: "r", skills: { onDemand: ["inconnue#A"] } }, []))).toEqual(["agents.dev : skill non déclarée dans contributes.skills : inconnue"]);
    expect(errorsOf(withAgent({ role: "r" }, [{ name: "s", path: "a" }, { name: "s", path: "b" }]))).toEqual(["skills : nom en double : s"]);
  });

  it("classe de modèle d'un agent (ADR 0048) : fort, standard ou léger, jamais un identifiant de modèle", () => {
    const avec = (modelClass: unknown) => {
      const m = base();
      m.contributes.agents = [{ name: "lecteur", title: "Lecteur", role: "Relis.", output: "report_phase", modelClass }];
      return errorsOf(m);
    };
    expect(avec("light")).toEqual([]);
    expect(avec("strong")).toEqual([]);
    expect(avec("claude-opus-5")).toEqual([expect.stringMatching(/modelClass/)]);
  });

  it("mémoire d'un agent (ADR 0053) : « tache » ou « tour », rien d'autre", () => {
    const avec = (memoire: unknown) => {
      const m = base();
      m.contributes.agents = [{ name: "lecteur", title: "Lecteur", role: "Relis.", output: "report_phase", memoire }];
      return errorsOf(m);
    };
    expect(avec("tache")).toEqual([]);
    expect(avec("tour")).toEqual([]);
    expect(avec("toujours")).toEqual([expect.stringMatching(/memoire/)]);
  });
});
