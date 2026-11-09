/**
 * Dépôts acceptés « toujours » par l'utilisateur (ADR 0075), gardés par le serveur hors des dépôts :
 * un autre serveur, ou le même après redémarrage, ne redemande pas.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDepotsFichier } from "../src/depots.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mcp-depots-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("createDepotsFichier", () => {
  it("vide au départ ; un dépôt ajouté est relu par un autre stockage sur le même fichier, sans doublon", async () => {
    const f = join(dir, "sous", "depots-acceptes.json");
    expect(await createDepotsFichier(f).liste()).toEqual([]);
    await createDepotsFichier(f).ajouter("/projets/a");
    await createDepotsFichier(f).ajouter("/projets/b");
    await createDepotsFichier(f).ajouter("/projets/a");
    expect(await createDepotsFichier(f).liste()).toEqual(["/projets/a", "/projets/b"]);
  });

  it("fichier illisible ou d'une autre forme : aucun dépôt accepté, jamais une liste devinée", async () => {
    const f = join(dir, "depots-acceptes.json");
    await writeFile(f, "{ pas du json");
    expect(await createDepotsFichier(f).liste()).toEqual([]);
    await writeFile(f, JSON.stringify({ depots: ["/a", 3] }));
    expect(await createDepotsFichier(f).liste()).toEqual([]);
  });
});
