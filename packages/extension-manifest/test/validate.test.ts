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
