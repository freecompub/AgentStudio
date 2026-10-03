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

  it("relit tous les réglages, pas seulement le dernier projet", async () => {
    const file = join(dir, "s.json");
    const tout = {
      lastWorkspace: "/projets/demo",
      uiMode: "simple" as const,
      models: { "/projets/demo": "claude-sonnet-4.5" },
      modelClasses: { "/projets/demo": { strong: "claude-sonnet-5.5", light: "gpt-5-mini" } },
      authHostname: "github.exemple.fr",
    };
    await createJsonSettingsStore(file).save(tout);
    expect(await createJsonSettingsStore(file).load()).toEqual(tout);
  });

  it("enregistrer un réglage n'efface pas les autres", async () => {
    const file = join(dir, "s.json");
    const store = createJsonSettingsStore(file);
    await store.save({ lastWorkspace: "/projets/demo", authHostname: "github.exemple.fr", uiMode: "advanced" });

    // Comme le contrôleur : relire, modifier une clé, réécrire.
    await store.save({ ...(await store.load()), uiMode: "simple" });

    expect(await store.load()).toEqual({
      lastWorkspace: "/projets/demo",
      authHostname: "github.exemple.fr",
      uiMode: "simple",
    });
  });

  it("une clé inconnue est ignorée sans faire perdre les autres", async () => {
    const file = join(dir, "s.json");
    await writeFile(file, JSON.stringify({ lastWorkspace: "/projets/demo", inconnu: 1 }));
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
