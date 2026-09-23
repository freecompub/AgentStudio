import { describe, expect, it } from "vitest";
import { createJsonLogger } from "../src/logging/json-logger.js";
import { fixedClock } from "../src/testing/memory-doubles.js";

describe("createJsonLogger", () => {
  it("écrit une ligne JSON par entrée avec niveau, horodatage et champs hérités", () => {
    const lines: string[] = [];
    const log = createJsonLogger({ write: (l) => lines.push(l), clock: fixedClock() });
    log.child({ sessionId: "s1" }).warn("hook en échec", { extensionId: "tdd", skipped: undefined });
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { ts: "2026-09-23T10:00:00.000Z", level: "warn", msg: "hook en échec", sessionId: "s1", extensionId: "tdd" },
    ]);
  });

  it("filtre sous le niveau minimal", () => {
    const lines: string[] = [];
    const log = createJsonLogger({ write: (l) => lines.push(l), clock: fixedClock(), level: "info" });
    log.debug("bavard");
    log.info("utile");
    expect(lines).toHaveLength(1);
  });
});
