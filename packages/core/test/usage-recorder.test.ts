import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUsageRecorder, sumUsage } from "../src/usage/usage-recorder.js";

describe("Enregistreur d'usage (D37)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agent-studio-usage-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("cumule par état, dans l'ordre d'apparition, et notifie", async () => {
    const rec = createUsageRecorder(dir);
    const seen: number[] = [];
    rec.onChange((_t, rows) => seen.push(rows.length));
    await rec.add("t1", "PLANNING", { requests: 1, inputTokens: 100, outputTokens: 20 });
    await rec.add("t1", "RED", { requests: 1, durationMs: 500, effects: 1 });
    await rec.add("t1", "PLANNING", { requests: 2, retries: 1 });
    expect(await rec.report("t1")).toEqual([
      { phase: "PLANNING", requests: 3, inputTokens: 100, outputTokens: 20, retries: 1, durationMs: 0, effects: 0 },
      { phase: "RED", requests: 1, inputTokens: 0, outputTokens: 0, retries: 0, durationMs: 500, effects: 1 },
    ]);
    expect(seen).toEqual([1, 2, 2]);
  });

  it("persistant : relu par une nouvelle instance (redémarrage) ; tâches isolées", async () => {
    await createUsageRecorder(dir).add("t1", "RED", { requests: 2 });
    await createUsageRecorder(dir).add("t2", "RED", { requests: 5 });
    expect((await createUsageRecorder(dir).report("t1"))[0]?.requests).toBe(2);
  });

  it("ajouts concurrents : rien n'est perdu", async () => {
    const rec = createUsageRecorder(dir);
    await Promise.all(Array.from({ length: 25 }, () => rec.add("t1", "RED", { requests: 1 })));
    expect((await rec.report("t1"))[0]?.requests).toBe(25);
  });

  it("total", () => {
    expect(
      sumUsage([
        { phase: "A", requests: 1, inputTokens: 2, outputTokens: 3, retries: 0, durationMs: 10, effects: 1 },
        { phase: "B", requests: 2, inputTokens: 0, outputTokens: 1, retries: 1, durationMs: 5, effects: 2 },
      ]),
    ).toEqual({ phase: "total", requests: 3, inputTokens: 2, outputTokens: 4, retries: 1, durationMs: 15, effects: 3 });
  });
});
