import { describe, expect, it } from "vitest";
import { BRANCHES_CAMPAGNE_US2, verifierBrancheCampagneUs2 } from "./branches-campagne.js";

describe("branches dédiées de la campagne US-2", () => {
  it.each(BRANCHES_CAMPAGNE_US2)("accepte %s", (branch) => {
    expect(() => verifierBrancheCampagneUs2(branch)).not.toThrow();
  });

  it.each(["main", "master", "run/us-2-2026-10-10-abcd", "tests/us-2/autre"])(
    "refuse une branche non réservée à la campagne : %s",
    (branch) => {
      expect(() => verifierBrancheCampagneUs2(branch)).toThrow("Branche de run refusée");
    },
  );
});
