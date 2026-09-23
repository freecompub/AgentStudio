import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonInteractionStore } from "../src/interactions/json-interaction-store.js";
import type { InteractionRequest } from "../src/protocols/interactions.js";

const req = (id: string, over: Partial<InteractionRequest> = {}): InteractionRequest => ({
  id,
  taskId: "t1",
  extensionId: "diabeo.tdd",
  kind: "decision",
  title: "Cycle TDD bloqué",
  detail: "mauvais test",
  options: [{ id: "retry", label: "Relancer" }],
  createdAt: "2026-09-23T10:00:00.000Z",
  status: "pending",
  ...over,
});

describe("JsonInteractionStore (demandes persistées, D31)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agent-studio-int-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("relit les demandes depuis une nouvelle instance (redémarrage), réponse comprise", async () => {
    await createJsonInteractionStore(dir).save(req("int-1"));
    await createJsonInteractionStore(dir).save(req("int-2", { status: "answered", answer: { option: "retry", answeredAt: "2026-09-23T11:00:00.000Z" } }));
    const list = await createJsonInteractionStore(dir).list();
    expect(list.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      req("int-1"),
      req("int-2", { status: "answered", answer: { option: "retry", answeredAt: "2026-09-23T11:00:00.000Z" } }),
    ]);
  });

  it("une mise à jour remplace l'enregistrement ; aucun fichier temporaire ne reste", async () => {
    const store = createJsonInteractionStore(dir);
    await store.save(req("int-1"));
    await store.save(req("int-1", { status: "cancelled" }));
    expect((await store.list()).map((r) => r.status)).toEqual(["cancelled"]);
    expect(await readdir(dir)).toEqual(["int-1.json"]);
  });

  it("dossier absent : liste vide ; fichier corrompu : ignoré", async () => {
    expect(await createJsonInteractionStore(join(dir, "absent")).list()).toEqual([]);
    const store = createJsonInteractionStore(dir);
    await store.save(req("int-1"));
    await writeFile(join(dir, "int-2.json"), "{ cassé");
    expect((await store.list()).map((r) => r.id)).toEqual(["int-1"]);
  });

  it("refuse un identifiant qui ressemble à un chemin", async () => {
    await expect(createJsonInteractionStore(dir).save(req("../x"))).rejects.toThrow(/Identifiant/);
  });
});
