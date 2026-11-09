/**
 * Programmes acceptés « toujours » par l'utilisateur, par projet (ADR 0075). Gardés hors du dépôt,
 * dans le dossier des tâches : un agent qui écrit dans le projet ne peut pas s'en accorder un.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProgrammesAcceptesFichier } from "../src/programmes-acceptes.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "programmes-acceptes-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("createProgrammesAcceptesFichier", () => {
  it("accepté pour un projet, pas pour un autre ; relu par un autre stockage ; sans doublon", async () => {
    const f = join(dir, "sous", "programmes-acceptes.json");
    expect(await createProgrammesAcceptesFichier(f).accepte("/p/a", "uv")).toBe(false);
    await createProgrammesAcceptesFichier(f).ajouter("/p/a", "uv");
    await createProgrammesAcceptesFichier(f).ajouter("/p/a", "uv");
    await createProgrammesAcceptesFichier(f).ajouter("/p/b", "make");
    const relu = createProgrammesAcceptesFichier(f);
    expect(await relu.accepte("/p/a", "uv")).toBe(true);
    expect(await relu.accepte("/p/b", "uv")).toBe(false);
    expect(await relu.accepte("/p/b", "make")).toBe(true);
    expect(JSON.parse(await (await import("node:fs/promises")).readFile(f, "utf8"))).toEqual({ projets: { "/p/a": ["uv"], "/p/b": ["make"] } });
  });

  it("fichier illisible ou d'une autre forme : rien n'est accepté", async () => {
    const f = join(dir, "programmes-acceptes.json");
    await writeFile(f, "{ pas du json");
    expect(await createProgrammesAcceptesFichier(f).accepte("/p/a", "uv")).toBe(false);
    await writeFile(f, JSON.stringify({ projets: { "/p/a": "uv" } }));
    expect(await createProgrammesAcceptesFichier(f).accepte("/p/a", "uv")).toBe(false);
    // Une clé héritée de l'objet n'est pas un projet.
    await writeFile(f, JSON.stringify({ projets: {} }));
    expect(await createProgrammesAcceptesFichier(f).accepte("constructor", "uv")).toBe(false);
  });
});
