import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonTaskStore } from "../src/stores/json-task-store.js";
import type { TaskRecord } from "../src/protocols.js";

const rec = (id: string, over: Partial<TaskRecord> = {}): TaskRecord => ({
  id,
  name: "tdd-cycle",
  state: { phase: "RED" },
  pending: [{ kind: "runTestAgent" }],
  inflight: { effect: { kind: "verifyRed" }, checkpointId: "cp-1", startedAt: "2026-09-23T10:00:00.000Z" },
  status: "running",
  createdAt: "2026-09-23T10:00:00.000Z",
  updatedAt: "2026-09-23T10:00:00.000Z",
  ...over,
});

describe("JsonTaskStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agent-studio-tasks-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("enregistre et relit une tâche, depuis une autre instance", async () => {
    await createJsonTaskStore(dir).save(rec("t1"));
    expect(await createJsonTaskStore(dir).load("t1")).toEqual(rec("t1"));
  });

  it("liste toutes les tâches, sans fichiers temporaires", async () => {
    const store = createJsonTaskStore(dir);
    await store.save(rec("t1"));
    await store.save(rec("t2", { status: "finished" }));
    await store.save(rec("t1", { status: "waiting" }));
    expect((await store.list()).map((r) => [r.id, r.status]).sort()).toEqual([
      ["t1", "waiting"],
      ["t2", "finished"],
    ]);
    expect((await readdir(dir)).every((f) => f.endsWith(".json"))).toBe(true);
  });

  it("renvoie null pour une tâche inconnue et refuse un identifiant de chemin", async () => {
    const store = createJsonTaskStore(dir);
    expect(await store.load("absente")).toBeNull();
    await expect(store.load("../x")).rejects.toThrow(/Identifiant/);
  });

  it("ignore un fichier corrompu à la lecture de la liste", async () => {
    const store = createJsonTaskStore(dir);
    await store.save(rec("t1"));
    await writeFile(join(dir, "t2.json"), "{ cassé");
    expect((await store.list()).map((r) => r.id)).toEqual(["t1"]);
  });
});
