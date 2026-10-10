export const BRANCHES_CAMPAGNE_US2 = [
  "tests/us-2/extension-1",
  "tests/us-2/workflow-1",
  "tests/us-2/extension-2",
  "tests/us-2/workflow-2",
] as const;

export type BrancheCampagneUs2 = (typeof BRANCHES_CAMPAGNE_US2)[number];

export function verifierBrancheCampagneUs2(value: string): asserts value is BrancheCampagneUs2 {
  if (!(BRANCHES_CAMPAGNE_US2 as readonly string[]).includes(value)) {
    throw new Error(
      `Branche de run refusée : « ${value} ». Utiliser une branche dédiée de campagne : ${BRANCHES_CAMPAGNE_US2.join(", ")}`,
    );
  }
}
