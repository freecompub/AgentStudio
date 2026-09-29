/**
 * Outil `list_files` (ADR 0034) : explorer le projet sans shell.
 *
 * La trace du 29/09 a montré le chercheur tenter
 *
 *   ls -la .skraft/us-2/research/ && find .skraft -type f
 *
 * La garde refuse toute commande, et elle a raison : juger une commande inoffensive demanderait de
 * l'analyser, et `ls .skraft; rm -rf /` passerait n'importe quelle liste blanche. Mais l'intention
 * — voir l'arborescence — est légitime, et la seule voie ouverte était de lister les dossiers un
 * par un. Or chaque aller-retour réemporte tout le contexte accumulé : dix listages pour une carte.
 *
 * Même réponse que pour les tests : l'agent ne lance pas la commande, le code la lui rend bornée.
 */
import { describe, expect, it, vi } from "vitest";
import { listFilesTool, LIMITE_CHEMINS } from "../src/agents/list-files-tool.js";

const fichiers = (n: number) => Array.from({ length: n }, (_, i) => `src/M${i}/F${i}.cs`);
const outil = (liste: string[]) => listFilesTool({ list: async () => liste });

describe("listFilesTool", () => {
  it("sans motif, rend tous les chemins du projet", async () => {
    const r = String(await outil(["src/A.cs", "tests/B.cs"]).handler({}));
    expect(r).toContain("src/A.cs");
    expect(r).toContain("tests/B.cs");
  });

  it("avec un motif, ne rend que ce qui correspond", async () => {
    const r = String(await outil(["src/A.cs", "src/B.ts", "tests/C.cs"]).handler({ glob: "src/**/*.cs" }));
    expect(r).toContain("src/A.cs");
    expect(r).not.toContain("src/B.ts");
    expect(r).not.toContain("tests/C.cs");
  });

  it("au-delà de la borne, coupe ET dit combien de chemins sont omis", async () => {
    // Une liste tronquée en silence se lit comme une liste complète : l'agent conclurait que le
    // projet ne contient que ce qu'il voit.
    const r = String(await outil(fichiers(LIMITE_CHEMINS + 37)).handler({}));
    expect(r).toContain(`37 autre`);
    expect(r.split("\n").length).toBeLessThan(LIMITE_CHEMINS + 10);
  });

  it("aucune correspondance : le dit, au lieu de rendre du vide", async () => {
    const r = String(await outil(["src/A.cs"]).handler({ glob: "docs/**" }));
    expect(r).toMatch(/aucun/i);
    expect(r).toContain("docs/**");
  });

  it("un motif illisible est signalé, il ne fait pas échouer le tour", async () => {
    const r = String(await outil(["src/A.cs"]).handler({ glob: 42 as never }));
    expect(r).toMatch(/motif/i);
  });

  it("réarme le chien de garde : lister un gros dépôt peut être long", async () => {
    const beat = vi.fn();
    await listFilesTool({ list: async () => ["a"] }, { beat }).handler({});
    expect(beat).toHaveBeenCalled();
  });

  it("ne rend jamais de preuve : explorer n'atteste rien", async () => {
    expect(outil([]).name).toBe("list_files");
  });
});

/**
 * Le cœur ignore les langages (D10).
 *
 * J'avais mis un motif en « .cs » en exemple dans la description de l'outil — celle que le modèle lit.
 * Sur un projet Swift ou Python, cet exemple oriente l'agent vers une extension qui n'existe pas
 * chez lui, et il fait entrer une connaissance de pile dans le cœur, où seul l'adaptateur en a.
 */
describe("Aucune connaissance de langage dans ce que l'agent lit", () => {
  const EXTENSIONS = /\.(cs|swift|ts|js|py|java|kt|rb|go|rs|php|cpp|scala)\b/i;
  const outil = listFilesTool({ list: async () => [] });

  it("la description de l'outil ne cite aucune extension de fichier", () => {
    expect(outil.description).not.toMatch(EXTENSIONS);
  });

  it("le motif des paramètres non plus", () => {
    expect(JSON.stringify(outil.parameters)).not.toMatch(EXTENSIONS);
  });

  it("ni le message d'erreur sur un motif illisible", async () => {
    expect(String(await outil.handler({ glob: 1 as never }))).not.toMatch(EXTENSIONS);
  });
});
