import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonEvidenceStore } from "../src/evidence/json-evidence-store.js";
import type { Evidence } from "../src/protocols/evidence.js";

const ev = (id: string, taskId = "t1"): Evidence => ({
  id,
  taskId,
  stepId: "s1",
  source: "run_tests",
  phase: "RED",
  at: "2026-09-23T10:00:00.000Z",
  exitCode: 1,
  timedOut: false,
  durationMs: 10,
  counts: { passed: 1, failed: 1, skipped: 0 },
  testIds: ["a", "b"],
  failing: [{ id: "b", failureKind: "assertion" }],
  testsHash: "h",
  head: "sha",
});

describe("JsonEvidenceStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agent-studio-ev-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("ajoute en fin de journal (JSONL) et relit dans l'ordre, par tâche", async () => {
    const store = createJsonEvidenceStore(dir);
    await store.append(ev("e1"));
    await store.append(ev("e2"));
    await store.append(ev("x", "t2"));
    expect((await createJsonEvidenceStore(dir).list("t1")).map((e) => e.id)).toEqual(["e1", "e2"]);
    expect((await readFile(join(dir, "t1.jsonl"), "utf8")).trim().split("\n")).toHaveLength(2);
  });

  it("tâche sans preuve : liste vide ; ligne corrompue ignorée", async () => {
    const store = createJsonEvidenceStore(dir);
    expect(await store.list("t1")).toEqual([]);
    await store.append(ev("e1"));
    const { appendFile } = await import("node:fs/promises");
    await appendFile(join(dir, "t1.jsonl"), "{ cassé\n");
    await store.append(ev("e2"));
    expect((await store.list("t1")).map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("appends concurrents : aucune ligne perdue ni entrelacée", async () => {
    const store = createJsonEvidenceStore(dir);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.append(ev(`e${i}`))));
    expect(await store.list("t1")).toHaveLength(20);
  });
});
