/**
 * Section `composants` de `.agent-studio/projet.yaml` (ADR 0074) : un projet qui mélange les
 * technologies déclare un composant par partie, chacun avec sa racine et sa pile. `pile` seule reste
 * valable (un composant, racine `.`) ; les deux ensemble sont refusés.
 */
import { describe, expect, it } from "vitest";
import { lireFichierProjet } from "../src/profile/fichier-projet.js";

const MIXTE = `
composants:
  - nom: api
    racine: ./services/api/
    pile:
      id: dotnet
      detect: [Tarification.sln]
  - nom: web
    racine: web
    pile:
      id: typescript
      detect: [package.json]
qualite:
  couverture: { reste: 70 }
`;

describe("Section composants de projet.yaml (ADR 0074)", () => {
  it("chaque composant : son nom, sa racine normalisée, sa pile en YAML pour son propre validateur", () => {
    const r = lireFichierProjet(MIXTE);
    if ("error" in r) throw new Error(r.error);
    expect(r.composants?.map((c) => [c.nom, c.racine])).toEqual([["api", "services/api"], ["web", "web"]]);
    expect(r.composants?.[0]!.pile).toMatch(/id: dotnet/);
    expect(r.qualite).toMatch(/reste: 70/);
    expect(r.pile).toBeUndefined();
  });

  it("`pile` et `composants` ensemble : refusé", () => {
    expect(lireFichierProjet(`pile: { id: x }\n${MIXTE}`)).toEqual({ error: expect.stringMatching(/pile.*composants.*l'une ou l'autre/s) });
  });

  it("noms en double, racine absolue ou qui remonte, racines qui se chevauchent : refusé, en nommant le composant", () => {
    const deux = (a: string, b: string) => `composants:\n  - { nom: api, racine: ${a}, pile: { id: x } }\n  - { nom: web, racine: ${b}, pile: { id: y } }\n`;
    expect(lireFichierProjet(deux("api", "web").replace("nom: web", "nom: api"))).toEqual({ error: expect.stringMatching(/« api ».*deux fois/) });
    expect(lireFichierProjet(deux("/srv/api", "web"))).toEqual({ error: expect.stringMatching(/« api ».*racine.*relative/) });
    expect(lireFichierProjet(deux("../voisin", "web"))).toEqual({ error: expect.stringMatching(/« api ».*racine.*\.\./) });
    expect(lireFichierProjet(deux("services", "services/web"))).toEqual({ error: expect.stringMatching(/« api ».*« web ».*chevauchent/) });
    expect(lireFichierProjet(deux(".", "web"))).toEqual({ error: expect.stringMatching(/chevauchent/) });
  });

  it("un composant sans nom, sans racine ou sans pile, ou une liste vide : refusé", () => {
    expect(lireFichierProjet("composants:\n  - { racine: web, pile: { id: x } }\n")).toEqual({ error: expect.stringMatching(/composants\.0.*nom/) });
    expect(lireFichierProjet("composants:\n  - { nom: web, pile: { id: x } }\n")).toEqual({ error: expect.stringMatching(/composants\.0.*racine/) });
    expect(lireFichierProjet("composants:\n  - { nom: web, racine: web }\n")).toEqual({ error: expect.stringMatching(/composants\.0.*pile/) });
    expect(lireFichierProjet("composants: []\n")).toEqual({ error: expect.stringMatching(/au moins un composant/) });
  });
});
