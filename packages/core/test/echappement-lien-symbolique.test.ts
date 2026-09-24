/**
 * Les gardes de périmètre comparent des chemins. Un lien symbolique placé **dans** le projet et
 * pointant dehors produit un chemin sans `..` : sans résolution, l'écriture est autorisée et
 * atteint la cible du lien. L'agent peut créer ce lien lui-même, puisque c'est une écriture
 * dans le projet.
 */
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mainSessionPolicy } from "../src/guards/permission-arbiter.js";
import { createTaskAgentGuard } from "../src/guards/task-agent-guard.js";

let base: string;
let projet: string;
let dehors: string;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "agent-studio-lien-"));
  projet = join(base, "projet");
  dehors = join(base, "dehors");
  await mkdir(projet, { recursive: true });
  await mkdir(dehors, { recursive: true });
  await writeFile(join(dehors, "secret.txt"), "secret\n");
  await symlink(dehors, join(projet, "evasion"));
});
afterAll(() => rm(base, { recursive: true, force: true }));

describe("Échappement par lien symbolique", () => {
  it("la politique de la session principale refuse d'écrire à travers un lien sortant", () => {
    const v = mainSessionPolicy(projet, { kind: "write", toolName: "write", path: "evasion/secret.txt" });
    expect(v).toMatchObject({ decision: "deny" });
  });

  it("la garde d'un agent de tâche refuse aussi, en lecture comme en écriture", async () => {
    const guard = createTaskAgentGuard({ root: projet, writable: ["**"] });
    expect(await guard.check({ kind: "write", toolName: "write", path: "evasion/secret.txt" })).toMatchObject({ decision: "deny" });
    expect(await guard.check({ kind: "read", toolName: "read", path: "evasion/secret.txt" })).toMatchObject({ decision: "deny" });
  });

  it("un chemin ordinaire du projet reste autorisé", async () => {
    await mkdir(join(projet, "src"), { recursive: true });
    await writeFile(join(projet, "src", "a.ts"), "");
    expect(mainSessionPolicy(projet, { kind: "write", toolName: "write", path: "src/a.ts" })).toMatchObject({ decision: "allow" });
    const guard = createTaskAgentGuard({ root: projet, writable: ["src/**"] });
    expect(await guard.check({ kind: "write", toolName: "write", path: "src/a.ts" })).toMatchObject({ decision: "allow" });
  });

  it("un fichier encore inexistant reste jugeable : la politique demeure utilisable sans disque", () => {
    expect(mainSessionPolicy(projet, { kind: "write", toolName: "write", path: "src/pas-encore.ts" })).toMatchObject({ decision: "allow" });
    expect(mainSessionPolicy("/projets/imaginaire", { kind: "write", toolName: "write", path: "src/a.ts" })).toMatchObject({ decision: "allow" });
    expect(mainSessionPolicy("/projets/imaginaire", { kind: "write", toolName: "write", path: "../dehors.ts" })).toMatchObject({ decision: "deny" });
  });
});
