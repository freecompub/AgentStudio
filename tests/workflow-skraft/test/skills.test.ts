/**
 * Skills des agents du workflow : chacune existe dans `workflows/skraft/skills/`. Une skill exigée
 * introuvable, l'agent découvre le manque au moment d'en avoir besoin, et travaille quand même.
 */
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { meta } from "../../../workflows/skraft/workflow.mjs";

const SKILLS_DIR = resolve(import.meta.dirname, "../../../workflows/skraft/skills");
type Grant = { obligatoires?: string[]; aLaDemande?: string[] };
const agents = Object.entries((meta as { agents: Record<string, { skills?: Grant }> }).agents);

describe("Skills des agents du workflow skraft", () => {
  it("aucune skill accordée à un agent n'est absente du dossier", async () => {
    const presentes = new Set(await readdir(SKILLS_DIR));
    for (const [nom, a] of agents)
      for (const s of [...(a.skills?.obligatoires ?? []), ...(a.skills?.aLaDemande ?? [])]) expect(presentes, `${nom} → ${s}`).toContain(s.split("#")[0]!);
  });

  it("en BDD, l'agent d'acceptance peut charger la skill des définitions d'étapes (ADR 0074 §3)", () => {
    const acceptance = agents.find(([nom]) => nom === "skraft-acceptance")![1];
    expect(acceptance.skills?.aLaDemande).toContain("bdd-step-definitions");
  });
});
