import { describe, expect, it } from "vitest";
import { generateKeyPair } from "../src/package.js";
import { isRevoked, signRevocationList, verifyRevocationList } from "../src/revocation.js";

describe("Liste de révocation signée (D13, §12)", () => {
  const root = generateKeyPair();
  const list = {
    issuedAt: "2026-09-23T10:00:00.000Z",
    revoked: [
      { id: "tiers.lint", versions: ["1.0.0"], reason: "fuite de données" },
      { id: "tiers.pirate", reason: "malveillante" },
    ],
  };

  it("signée par la clé racine : acceptée ; retouchée ou autre clé : refusée", () => {
    const signed = signRevocationList(list, root.privateKeyPem);
    expect(verifyRevocationList(signed, root.publicKeyPem)).toEqual(list);
    const forged = { ...signed, revoked: [] };
    expect(() => verifyRevocationList(forged, root.publicKeyPem)).toThrow(/signature/);
    expect(() => verifyRevocationList(signed, generateKeyPair().publicKeyPem)).toThrow(/signature/);
  });

  it("révocation par version ou toutes versions", () => {
    expect(isRevoked(list, "tiers.lint", "1.0.0")).toEqual({ reason: "fuite de données" });
    expect(isRevoked(list, "tiers.lint", "1.0.1")).toBeNull();
    expect(isRevoked(list, "tiers.pirate", "9.9.9")).toEqual({ reason: "malveillante" });
    expect(isRevoked(list, "diabeo.tdd", "0.1.0")).toBeNull();
  });
});
