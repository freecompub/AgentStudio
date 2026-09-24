import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonSettingsStore } from "../src/main/settings-store.js";

describe("JsonSettingsStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agent-studio-settings-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("réglages vides au premier lancement", async () => {
    expect(await createJsonSettingsStore(join(dir, "s.json")).load()).toEqual({});
  });

  it("relit ce qui a été enregistré", async () => {
    const file = join(dir, "sub", "s.json");
    await createJsonSettingsStore(file).save({ lastWorkspace: "/projets/demo" });
    expect(await createJsonSettingsStore(file).load()).toEqual({ lastWorkspace: "/projets/demo" });
  });

  it("un fichier illisible ou hors schéma vaut réglages vides", async () => {
    const file = join(dir, "s.json");
    await writeFile(file, "{ cassé");
    expect(await createJsonSettingsStore(file).load()).toEqual({});
    await writeFile(file, JSON.stringify({ lastWorkspace: 42 }));
    expect(await createJsonSettingsStore(file).load()).toEqual({});
  });
});
