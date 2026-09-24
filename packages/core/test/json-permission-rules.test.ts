/**
 * Règles « toujours autoriser » persistées (D27). Elles s'ajoutent depuis la fenêtre, donc
 * potentiellement plusieurs à la suite sans que la précédente soit relue.
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonPermissionRules } from "../src/guards/permission-arbiter.js";

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agent-studio-rules-"));
  file = join(dir, "sous-dossier", "rules.json");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("createJsonPermissionRules", () => {
  it("enregistre une règle et la relit", async () => {
    const rules = createJsonPermissionRules(file);
    await rules.add({ kind: "shell", value: "npm test" });
    expect(await createJsonPermissionRules(file).list()).toEqual([{ kind: "shell", value: "npm test" }]);
  });

  it("une règle déjà connue n'est pas ajoutée deux fois", async () => {
    const rules = createJsonPermissionRules(file);
    await rules.add({ kind: "url", value: "example.org" });
    await rules.add({ kind: "url", value: "example.org" });
    expect(await rules.list()).toHaveLength(1);
  });

  it("des ajouts simultanés ne se perdent pas", async () => {
    // Sans sérialisation, chaque appel relit l'état d'avant et réécrit par-dessus : seule la
    // dernière règle survit, et l'utilisateur croit avoir autorisé les autres.
    const rules = createJsonPermissionRules(file);
    await Promise.all([
      rules.add({ kind: "shell", value: "npm test" }),
      rules.add({ kind: "shell", value: "npm run build" }),
      rules.add({ kind: "url", value: "example.org" }),
    ]);
    expect(await rules.list()).toHaveLength(3);
  });

  it("le fichier reste lisible pendant des écritures concurrentes", async () => {
    const rules = createJsonPermissionRules(file);
    await Promise.all(Array.from({ length: 12 }, (_, i) => rules.add({ kind: "shell", value: `commande-${i}` })));
    // Un fichier temporaire partagé pourrait être renommé à moitié écrit : le JSON serait cassé.
    expect(() => JSON.parse(readFileSync(file, "utf8"))).not.toThrow();
    expect(await rules.list()).toHaveLength(12);
  });

  it("un fichier absent ou illisible vaut aucune règle", async () => {
    expect(await createJsonPermissionRules(join(dir, "absent.json")).list()).toEqual([]);
  });
});
