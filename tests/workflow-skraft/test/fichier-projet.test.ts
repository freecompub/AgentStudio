// @ts-nocheck — le workflow est en JavaScript, sans types (ADR 0055) : ce test vérifie son comportement, pas ses types.
/**
 * Fichier de projet (ADR 0071), côté workflow : la barre de qualité est lue dans la section `qualite`
 * de `.agent-studio/projet.yaml` avant les anciens fichiers ; `projet.yaml` est gelé pour les agents.
 */
import { describe, expect, it } from "vitest";
import { barreDeQualite } from "../../../workflows/skraft/livraison.mjs";
import { GELÉS } from "../../../workflows/skraft/support.mjs";

const fauxW = (fichiers: Record<string, string>) => ({
  lireFichier: async (p: string) => {
    if (!(p in fichiers)) throw new Error(`absent : ${p}`);
    return fichiers[p];
  },
  listerFichiers: async () => Object.keys(fichiers),
});
const disp = { sources: ["src/**"] };

describe("Fichier de projet (ADR 0071), workflow", () => {
  it("la barre vient de projet.yaml, section qualite ; les anciens fichiers encore là sont signalés", async () => {
    const r = await barreDeQualite(fauxW({ ".agent-studio/projet.yaml": "qualite:\n  couverture:\n    reste: 70\n", ".agent-studio/quality.yaml": "couverture:\n  reste: 10\n" }), disp);
    expect(r.barre.coverage).toEqual({ rest: 70 });
    expect(r.notes).toContainEqual(expect.stringMatching(/quality\.yaml.*ignorés.*projet\.yaml/s));
  });

  it("section qualite invalide : panne, qui nomme le fichier et la section", async () => {
    await expect(barreDeQualite(fauxW({ ".agent-studio/projet.yaml": "qualite:\n  couverture:\n    reste: 120\n" }), disp)).rejects.toThrow(/projet\.yaml.*section qualite/);
  });

  it("projet.yaml est gelé pour les agents, comme les anciens fichiers de la barre", () => {
    expect(GELÉS).toContain(".agent-studio/projet.yaml");
  });
});
