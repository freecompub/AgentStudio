import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manifest as tddManifest } from "@agent-studio/ext-tdd";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadExtensions } from "../src/main/extension-loader.js";

describe("Chargeur d'extensions (manifestes validés, J4)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agent-studio-ext-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  async function install(name: string, manifest: unknown, withEntry = true) {
    await mkdir(join(dir, name, "dist"), { recursive: true });
    await writeFile(join(dir, name, "manifest.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
    if (withEntry) await writeFile(join(dir, name, "dist/index.mjs"), "export default { activate() {} };");
  }

  it("charge une extension au manifeste valide, entrée résolue dans son dossier", async () => {
    await install("diabeo.tdd", tddManifest);
    const r = await loadExtensions(dir, { appApi: "0.1.0" });
    expect(r.rejected).toEqual([]);
    expect(r.loaded).toEqual([{ manifest: expect.objectContaining({ id: "diabeo.tdd" }), directory: join(dir, "diabeo.tdd"), entry: join(dir, "diabeo.tdd/dist/index.mjs") }]);
  });

  it("écarte, avec les raisons, un manifeste invalide, illisible, incompatible ou sans entrée", async () => {
    await install("a", { ...tddManifest, id: "diabeo.a", engines: { appApi: "^9.0" } });
    await install("b", "{ cassé");
    await install("c", { ...tddManifest, id: "diabeo.c" }, false);
    await install("d", { ...tddManifest, id: "diabeo.d", main: undefined });
    const r = await loadExtensions(dir, { appApi: "0.1.0" });
    expect(r.loaded).toEqual([]);
    expect(r.rejected.map((x) => [x.directory.split("/").at(-1), x.errors[0]])).toEqual([
      ["a", expect.stringMatching(/incompatible/)],
      ["b", expect.stringMatching(/illisible/)],
      ["c", expect.stringMatching(/Entrée introuvable/)],
      ["d", expect.stringMatching(/main/)],
    ]);
  });

  it("dossier absent : aucune extension, aucune erreur", async () => {
    expect(await loadExtensions(join(dir, "absent"), { appApi: "0.1.0" })).toEqual({ loaded: [], rejected: [] });
  });

  it("refuse deux extensions de même identifiant", async () => {
    await install("x1", tddManifest);
    await install("x2", tddManifest);
    const r = await loadExtensions(dir, { appApi: "0.1.0" });
    expect(r.loaded).toHaveLength(1);
    expect(r.rejected[0]?.errors[0]).toMatch(/déjà chargée/);
  });
});
