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
      "skraft-researcher",
      "skraft-test",
    ]);
  });

  it("/skraft : chemin de la story, --auto pour la confirmation automatique", () => {
    expect(parseSkraftArgs("stories/us-12.md")).toEqual({ storyPath: "stories/us-12.md", confirmDifficulty: true });
    expect(parseSkraftArgs("--auto stories/us-12.md")).toEqual({ storyPath: "stories/us-12.md", confirmDifficulty: false });
    expect(parseSkraftArgs("")).toBeNull();
  });
});
