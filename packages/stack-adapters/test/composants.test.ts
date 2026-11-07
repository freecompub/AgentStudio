/**
 * Adaptateur composé (ADR 0074, brique 1) : les composants d'un projet derrière le même port
 * `StackAdapter`. Chaque composant travaille dans sa racine, avec ses chemins à lui ; l'adaptateur
 * ramène tout à la racine du projet, et préfixe les identifiants de tests pour qu'ils ne se
 * confondent pas d'un composant à l'autre.
 */
import { describe, expect, it } from "vitest";
import { createComposedAdapter } from "../src/composants.js";
import type { StackAdapter } from "../src/protocols.js";

/** Un adaptateur simulé, qui note où et avec quels fichiers on l'appelle. */
function faux(id: string, o: Partial<StackAdapter> = {}) {
  const appels: { quoi: string; root: string; files?: string[] }[] = [];
  const a: StackAdapter = {
    id: id as StackAdapter["id"],
    layout: { acceptanceTests: ["tests/acceptance/**"], unitTests: ["tests/**"], sources: ["src/**"] },
    infrastructureModules: [`${id}-infra`],
    detect: async () => false,
    isTestFile: (p) => p.startsWith("tests/"),
    testFilePattern: "^tests/",
    runTests: async ({ root }) => (appels.push({ quoi: "tests", root }), {
      results: [{ id: "tests/a.test > passe", file: "tests/a.test", status: "passed" }, { id: "tests/acceptance/x > ac-1", file: "tests/acceptance/x", status: "failed", failureKind: "assertion" }],
      exitCode: 1, timedOut: false, output: `sortie ${id}`, durationMs: 10,
      coverage: { files: [{ file: "src/a.ts", covered: 1, total: 2, score: 50 }] },
    }),
    lint: async ({ root, files }) => (appels.push({ quoi: "lint", root, files: [...(files ?? [])] }), { available: true, tool: `lint-${id}`, analyzed: [...(files ?? [])], violations: files?.length ? [{ file: files[0]!, line: 3, rule: "r", message: "m" }] : [] }),
    ...o,
  };
  return { a, appels };
}

describe("Adaptateur composé (ADR 0074)", () => {
  const api = faux("dotnet");
  const web = faux("typescript");
  // Un composant sans linter : l'opération est absente de son adaptateur.
  delete (web.a as { lint?: unknown }).lint;
  const c = createComposedAdapter([{ nom: "api", racine: "services/api", adapter: api.a }, { nom: "web", racine: "web", adapter: web.a }]);

  it("emplacements et modules d'infrastructure réunis, ramenés à la racine du projet", () => {
    expect(c.layout).toEqual({
      acceptanceTests: ["services/api/tests/acceptance/**", "web/tests/acceptance/**"],
      unitTests: ["services/api/tests/**", "web/tests/**"],
      sources: ["services/api/src/**", "web/src/**"],
    });
    expect(c.infrastructureModules).toEqual(["dotnet-infra", "typescript-infra"]);
  });

  it("un fichier est un test selon le composant qui le contient ; hors de tout composant, non", () => {
    expect(c.isTestFile("web/tests/a.test.ts")).toBe(true);
    expect(c.isTestFile("web/src/a.ts")).toBe(false);
    expect(c.isTestFile("tests/a.test.ts")).toBe(false);
    expect(new RegExp(c.testFilePattern).test("services/api/tests/Unit.cs")).toBe(true);
    expect(new RegExp(c.testFilePattern).test("services/api/src/Domaine.cs")).toBe(false);
  });

  it("tests : chaque composant dans sa racine ; résultats préfixés, fichiers et couverture ramenés à la racine du projet", async () => {
    const r = await c.runTests({ root: "/projet" });
    expect(api.appels.at(-1)).toEqual({ quoi: "tests", root: "/projet/services/api" });
    expect(web.appels.at(-1)).toEqual({ quoi: "tests", root: "/projet/web" });
    expect(r.results.map((x) => [x.id, x.file, x.status])).toEqual([
      ["services/api: tests/a.test > passe", "services/api/tests/a.test", "passed"],
      ["services/api: tests/acceptance/x > ac-1", "services/api/tests/acceptance/x", "failed"],
      ["web: tests/a.test > passe", "web/tests/a.test", "passed"],
      ["web: tests/acceptance/x > ac-1", "web/tests/acceptance/x", "failed"],
    ]);
    expect(r.coverage?.files.map((f) => f.file)).toEqual(["services/api/src/a.ts", "web/src/a.ts"]);
    expect(r).toMatchObject({ exitCode: 1, timedOut: false, durationMs: 20 });
    expect(r.output).toContain("sortie dotnet");
    expect(r.output).toContain("sortie typescript");
  });

  it("lint : chaque composant ne reçoit que ses fichiers, relatifs à sa racine ; un composant sans linter ne juge pas les siens", async () => {
    const r = await c.lint!({ root: "/projet", files: ["services/api/src/A.cs", "web/src/b.ts", "README.md"] });
    expect(api.appels.at(-1)).toEqual({ quoi: "lint", root: "/projet/services/api", files: ["src/A.cs"] });
    expect(r).toEqual({ available: true, tool: "lint-dotnet", analyzed: ["services/api/src/A.cs"], violations: [{ file: "services/api/src/A.cs", line: 3, rule: "r", message: "m" }] });
  });

  it("aucun composant n'a l'outil : l'opération est absente, comme pour une pile seule", () => {
    expect(createComposedAdapter([{ nom: "web", racine: "web", adapter: web.a }]).lint).toBeUndefined();
  });

  it("détecte le projet si l'un des composants le reconnaît", async () => {
    const oui = faux("x", { detect: async (root) => root === "/projet/web" });
    expect(await createComposedAdapter([{ nom: "api", racine: "services/api", adapter: api.a }, { nom: "web", racine: "web", adapter: oui.a }]).detect("/projet")).toBe(true);
  });

  it("format : chaque composant touché vérifie ses fichiers ; un composant touché sans commande de format, rien n'est attesté", async () => {
    const ok = faux("a", { format: async () => ({ available: true, ok: true, tool: "fmt-a" }) });
    const ko = faux("b", { format: async () => ({ available: true, ok: false, tool: "fmt-b", sortie: "src/x.ts" }) });
    const deux = createComposedAdapter([{ nom: "a", racine: "a", adapter: ok.a }, { nom: "b", racine: "b", adapter: ko.a }]);
    expect(await deux.format!({ root: "/p", files: ["a/src/x.ts"] })).toEqual({ available: true, ok: true, tool: "fmt-a" });
    expect(await deux.format!({ root: "/p", files: ["a/src/x.ts", "b/src/x.ts"] })).toEqual({ available: true, ok: false, tool: "fmt-a, fmt-b", sortie: "── b ──\nsrc/x.ts" });
    const sans = createComposedAdapter([{ nom: "a", racine: "a", adapter: ok.a }, { nom: "web", racine: "web", adapter: web.a }]);
    expect(await sans.format!({ root: "/p", files: ["a/src/x.ts", "web/src/y.ts"] })).toEqual({ available: false, ok: false });
  });

  it("mutation : les fichiers de chaque composant, ramenés à la racine du projet ; score pondéré par le nombre de fichiers", async () => {
    const m1 = faux("a", { mutation: async () => ({ score: 100, files: [{ file: "src/a.ts", score: 100, survived: [] }] }) });
    const m2 = faux("b", { mutation: async () => ({ score: 40, files: [{ file: "src/b.ts", score: 40, survived: [] }, { file: "src/c.ts", score: 40, survived: [] }] }) });
    const r = await createComposedAdapter([{ nom: "a", racine: "a", adapter: m1.a }, { nom: "b", racine: "b", adapter: m2.a }]).mutation!({ root: "/p" });
    expect(r.files.map((f) => f.file)).toEqual(["a/src/a.ts", "b/src/b.ts", "b/src/c.ts"]);
    expect(r.score).toBe(60);
  });

  it("imports : une règle en chemins est ramenée à la racine de son composant ; violations ramenées à la racine du projet", async () => {
    const vues: unknown[] = [];
    const arch = faux("a", { architecture: async ({ rules }) => (vues.push(rules), { modules: [{ name: "Domain", imports: [] }], violations: [{ module: "Domain", file: "src/domain/a.ts", imported: "src/infra/db.js" }] }) });
    const r = await createComposedAdapter([{ nom: "api", racine: "services/api", adapter: arch.a }]).architecture!({ root: "/p", rules: [{ module: "services/api/src/domain", forbidden: ["src/infra"] }, { module: "Domain", forbidden: ["Infrastructure"] }] });
    expect(vues[0]).toEqual([{ module: "src/domain", forbidden: ["src/infra"] }, { module: "Domain", forbidden: ["Infrastructure"] }]);
    expect(r.violations).toEqual([{ module: "Domain", file: "services/api/src/domain/a.ts", imported: "src/infra/db.js" }]);
  });
});
