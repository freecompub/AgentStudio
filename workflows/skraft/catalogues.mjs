/**
* Les catalogues d'anti-patrons des skills, auxquels une leçon se rattache (LEC-2, freecompub/AgentStudio#33) :
* pour chaque fichier, les titres de ses sections. Le script ne lit pas le dossier du workflow : ces
* titres sont recopiés ici, et un test vérifie qu'ils sont ceux des fichiers (`tests/workflow-skraft/test/lecons.test.ts`).
*/
export const CATALOGUES = {
  "architecture-patterns/references/anti-patterns.md": [
    "AP-01: Anemic Domain Model",
    "AP-02: Big Ball of Mud",
    "AP-03: Transaction Script",
    "AP-04: Repository Used in Domain",
    "AP-05: Fat Aggregate",
    "AP-06: Event Sourcing Everywhere",
    "AP-07: Leaky Abstraction",
    "AP-08: Missing Anti-Corruption Layer",
    "AP-09: God Use Case",
    "AP-10: CQRS Without Read Models",
  ],
  "bdd-methodology/references/anti-patterns.md": [
    "AP-01: UI Testing in Gherkin",
    "AP-02: Too Many Steps (>7)",
    "AP-03: Multiple When Clauses",
    "AP-04: Incidental Details (Test Data Noise)",
    "AP-05: Vague Then",
    "AP-06: Technical Identifiers in Steps",
    "AP-07: Implementation Leaking into Then",
    "AP-08: Passive Voice Outcome",
    "AP-09: Missing Given (Implicit State)",
    "AP-10: Duplicated Scenarios (No Scenario Outline)",
  ],
  "craft-discipline/references/test-theater-patterns.md": [
    "1. Tautological Test",
    "2. Mock-Dominated Test",
    "3. Circular Verification",
    "4. Implementation Mirroring",
    "5. Fixture Theater",
  ],
  "architecture-review-criteria/references/clean-arch-violations.md": [
    "V-CA-01: Domain Importing from Infrastructure",
    "V-CA-02: Application Importing from Infrastructure",
    "V-CA-03: Repository Interface Defined in Infrastructure",
    "V-CA-04: Domain Event Raised from API Layer",
    "V-CA-05: Use Case Bypassing Domain Logic",
    "V-CA-06: Infrastructure Details Leaking into Application Contracts",
    "V-CA-07: Multiple Use Cases Sharing Mutable State",
    "V-CA-08: Application Layer Importing Framework-Specific Types",
  ],
  "architecture-review-criteria/references/ddd-violations.md": [
    "V-DDD-01: Aggregate Crossing Bounded Context Boundary",
    "V-DDD-02: Domain Event Raised from Application Service",
    "V-DDD-03: Anemic Aggregate",
    "V-DDD-04: Repository Defined in Domain Layer",
    "V-DDD-05: Cross-Aggregate Invariant Enforcement",
    "V-DDD-06: Missing Anti-Corruption Layer Between Conflicting Models",
    "V-DDD-07: God Aggregate",
    "V-DDD-08: Domain Service Doing What an Aggregate Should Do",
    "V-DDD-09: Core Subdomain in a Conformist Relationship",
    "V-DDD-10: Conformist Mislabel (Published Contract + Local Copy)",
  ],
};
/** Titres génériques d'un catalogue, qui ne sont pas des entrées. */
const GENERIQUES = ["Overview", "Patterns"];
/** Les entrées d'un catalogue : ses titres de niveau 2 ou 3, hors titres génériques. */
export function entreesDuCatalogue(md) {
  return [...md.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].trim()).filter((t) => !GENERIQUES.includes(t));
}
