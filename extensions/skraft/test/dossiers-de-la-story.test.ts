/**
 * L'orchestrateur prépare l'arborescence (ADR 0037).
 *
 * La trace du 29/09 a expliqué trois runs perdus. L'outil `create` du CLI documente lui-même :
 * « Parent directories must exist before creating the file ». Notre garde n'a refusé **aucune**
 * écriture — 18 lectures et 2 écritures autorisées, zéro refus — mais elle refuse le shell, donc
 * `mkdir`. Le CLI ne sait pas créer le dossier, et nous lui retirons le seul autre moyen.
 *
 * L'agent l'avait diagnostiqué seul, après avoir essayé six contournements dont le lancement d'un
 * sous-agent : « this is likely a harness limitation […] the orchestrator itself needs to create
 * the target directory rather than me. »
 *
 * Pris séparément, chaque choix est défendable ; c'est leur intersection qui laisse le trou.
 */
import { describe, expect, it } from "vitest";
import { dossiersDeLaStory } from "../src/effects.js";

describe("dossiersDeLaStory", () => {
  const d = dossiersDeLaStory("us-2");

  it("couvre les quatre emplacements que les portes attendent", () => {
    expect(d).toEqual([".skraft/us-2/research", ".skraft/us-2/design", ".skraft/us-2/distill/features", ".skraft/us-2/reviews"]);
  });

  it("tout est sous le dossier de la story : rien ailleurs dans le dépôt", () => {
    for (const p of d) expect(p.startsWith(".skraft/us-2/"), p).toBe(true);
  });

  it("reste dans le périmètre d'écriture des rôles", () => {
    // Créer un dossier hors périmètre serait refusé par l'hôte, et l'agent se retrouverait dans la
    // même impasse — avec une erreur de plus.
    for (const p of d) expect(p.startsWith(".skraft/"), p).toBe(true);
  });

  it("ne touche jamais à la barre de qualité, qui vit aussi sous .skraft", () => {
    expect(d.some((p) => p.includes("quality"))).toBe(false);
  });
});
