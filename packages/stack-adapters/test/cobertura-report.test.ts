/**
 * Lecture d'un rapport de couverture Cobertura.
 *
 * Ce format est choisi parce qu'il est le seul que produisent, nativement ou par une option,
 * `dotnet test --collect "XPlat Code Coverage"`, `vitest --coverage.reporter=cobertura`,
 * `pytest --cov-report=xml` et les convertisseurs JaCoCo. Un seul lecteur pour quatre écosystèmes,
 * là où un format par outil en aurait demandé quatre.
 *
 * La couverture n'est pas redondante avec la mutation : elle en est le **plancher**. La mutation
 * est plus sévère, mais elle est coûteuse et souvent absente — le projet .NET d'essai n'en a pas.
 * Un projet sans outil de mutation n'a, sans cela, aucune mesure du tout.
 */
import { describe, expect, it } from "vitest";
import { parseCoberturaReport } from "../src/coverage/cobertura-report.js";

const rapport = (classes: string) => `<?xml version="1.0"?>
<coverage line-rate="0.75" version="1.9">
  <packages><package name="p"><classes>${classes}</classes></package></packages>
</coverage>`;

const classe = (filename: string, lignes: [number, number][]) =>
  `<class name="C" filename="${filename}"><lines>${lignes.map(([n, hits]) => `<line number="${n}" hits="${hits}"/>`).join("")}</lines></class>`;

describe("parseCoberturaReport", () => {
  it("rend un pourcentage par fichier, calculé sur les lignes réellement exécutables", () => {
    const r = parseCoberturaReport(rapport(classe("src/Panier.cs", [[1, 1], [2, 1], [3, 0], [4, 1]])), "/p");
    expect(r?.files).toEqual([{ file: "src/Panier.cs", covered: 3, total: 4, score: 75 }]);
  });

  it("regroupe les classes d'un même fichier : en C# comme en TS, plusieurs classes y cohabitent", () => {
    const r = parseCoberturaReport(rapport(classe("src/A.cs", [[1, 1]]) + classe("src/A.cs", [[2, 0]])), "/p");
    expect(r?.files).toEqual([{ file: "src/A.cs", covered: 1, total: 2, score: 50 }]);
  });

  it("une ligne comptée deux fois ne l'est qu'une : les partiels ne doivent pas gonfler le total", () => {
    const r = parseCoberturaReport(rapport(classe("src/A.cs", [[1, 1], [1, 0]])), "/p");
    // La ligne 1 est couverte quelque part : elle compte pour couverte, une seule fois.
    expect(r?.files).toEqual([{ file: "src/A.cs", covered: 1, total: 1, score: 100 }]);
  });

  it("ramène les chemins absolus à la racine du projet, liens symboliques résolus", () => {
    const r = parseCoberturaReport(rapport(classe("/p/src/A.cs", [[1, 1]])), "/p");
    expect(r?.files[0]?.file).toBe("src/A.cs");
  });

  it("un fichier sans aucune ligne exécutable est ignoré plutôt que compté à 0 %", () => {
    // Une interface ou un fichier de constantes n'a rien à couvrir ; le compter à zéro ferait
    // échouer une porte sur un fichier qu'aucun test ne peut atteindre.
    const r = parseCoberturaReport(rapport(classe("src/I.cs", [])), "/p");
    expect(r?.files).toEqual([]);
  });

  it("un rapport illisible rend `null` : la porte dira qu'elle n'a rien mesuré", () => {
    expect(parseCoberturaReport("pas du XML", "/p")).toBeNull();
    expect(parseCoberturaReport("<autre/>", "/p")).toBeNull();
  });

  it("un rapport valide mais vide rend une liste vide, pas `null`", () => {
    // La différence compte : « mesuré, rien à dire » n'est pas « pas mesuré ».
    expect(parseCoberturaReport(rapport(""), "/p")).toEqual({ files: [] });
  });
});
