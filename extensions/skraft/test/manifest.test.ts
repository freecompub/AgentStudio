import { validateManifest } from "@agent-studio/extension-manifest";
import { describe, expect, it } from "vitest";
import { manifest } from "../src/manifest.js";
import { parseSkraftArgs } from "../src/extension.js";

describe("Manifeste et commande skraft", () => {
  it("manifeste valide (schéma, permissions, contributions)", () => {
    const r = validateManifest(manifest, { appApi: "0.1.0" });
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("chaque rôle de la spec (§6.3) et chaque lentille (§9.2) est déclaré", () => {
    expect(manifest.contributes.agents?.map((a) => a.name).sort()).toEqual([
      "skraft-acceptance",
      "skraft-architect-decide",
      "skraft-architect-model",
      "skraft-classifier",
      "skraft-dev",
      "skraft-lens-architecture",
      "skraft-lens-cold-reader",
      "skraft-lens-quality-gates",
      "skraft-lens-test-integrity",
      // Arbitre des mutants contestés comme équivalents (ADR 0065).
      "skraft-mutation-arbiter",
      "skraft-researcher",
      "skraft-test",
    ]);
  });

  it("/skraft : chemin de la story, --auto pour la confirmation automatique", () => {
    expect(parseSkraftArgs("stories/us-12.md")).toEqual({ storyPath: "stories/us-12.md", confirmDifficulty: true });
    expect(parseSkraftArgs("--auto stories/us-12.md")).toEqual({ storyPath: "stories/us-12.md", confirmDifficulty: false });
    expect(parseSkraftArgs("")).toBeNull();
    // Skill d'architecture transmise à l'appel (docs/15 §5, skills de skraft-plugin v1.15.1).
    expect(parseSkraftArgs("stories/us-12.md --archi java")).toEqual({ storyPath: "stories/us-12.md", confirmDifficulty: true, archi: "java" });
    expect(parseSkraftArgs("--auto --archi clean-architecture-java stories/us-12.md")).toEqual({ storyPath: "stories/us-12.md", confirmDifficulty: false, archi: "clean-architecture-java" });
    expect(parseSkraftArgs("stories/us-12.md --archi")).toBeNull();
  });
});

describe("classes de modèle des rôles (ADR 0048)", async () => {
  const { manifest } = await import("../src/manifest.js");
  const classe = (name: string) => manifest.contributes.agents?.find((a) => a.name === name)?.modelClass;

  it("chaque agent déclare une classe, jamais un modèle", () => {
    for (const a of manifest.contributes.agents ?? []) expect(["strong", "standard", "light"], a.name).toContain(a.modelClass);
  });

  it("concevoir : fort ; produire : standard ; classer ou confronter des faits : léger", () => {
    expect(classe("skraft-architect-model")).toBe("strong");
    expect(classe("skraft-architect-decide")).toBe("strong");
    expect(classe("skraft-dev")).toBe("standard");
    expect(classe("skraft-lens-cold-reader")).toBe("standard");
    // quality-gates ne fait que confronter les livrables aux faits mesurés par le code (ADR 0028).
    expect(classe("skraft-classifier")).toBe("light");
    expect(classe("skraft-lens-quality-gates")).toBe("light");
  });
});
