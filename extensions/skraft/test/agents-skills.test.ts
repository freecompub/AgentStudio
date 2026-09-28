/**
 * Rôles et skills en fichiers Markdown (ADR 0024) : un seul contenu pour deux usages — orchestré par
 * agent-studio (manifeste + contrat du cœur), ou chargé tel quel par Copilot CLI / Claude Code.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionFileReader, loadAgentPrompts, parseMarkdownDoc } from "@agent-studio/extension-host";
import { describe, expect, it } from "vitest";
import { manifest } from "../src/manifest.js";
import { ROLE_SKILLS, SKILLS } from "../src/roles.js";
import { EXTENSION_DIR } from "./support/harness.js";

const agentFiles = async () => (await readdir(join(EXTENSION_DIR, "agents"))).filter((f) => f.endsWith(".agent.md")).sort();

describe("Rôles de skraft en fichiers Markdown", () => {
  it("un fichier par agent déclaré, et aucun fichier orphelin", async () => {
    const declared = (manifest.contributes.agents ?? []).map((a) => a.prompt).sort();
    expect(declared.every(Boolean)).toBe(true);
    expect((await agentFiles()).map((f) => `agents/${f}`)).toEqual(declared);
  });

  it("frontmatter lisible par les autres harnais : nom égal au nom de l'agent, description non vide", async () => {
    for (const a of manifest.contributes.agents ?? []) {
      const doc = parseMarkdownDoc(await readFile(join(EXTENSION_DIR, a.prompt!), "utf8"));
      expect(doc.data.name, a.name).toBe(a.name);
      expect(doc.data.description?.length, a.name).toBeGreaterThan(20);
      expect(doc.body.length, a.name).toBeGreaterThan(100);
    }
  });

  it("contenu partagé neutre : aucun outil ni mécanisme propre à agent-studio (le contrat est ajouté par le cœur)", async () => {
    for (const f of await agentFiles()) {
      const body = parseMarkdownDoc(await readFile(join(EXTENSION_DIR, "agents", f), "utf8")).body;
      expect(body, f).not.toMatch(/run_tests|report_phase|report_blocker|submit_[a-z_]+|render_adr|load_skill|orchestrat/i);
    }
  });
});

describe("Skills reprises de skraft-plugin v1.6.1", () => {
  it("chaque skill déclarée a son SKILL.md, avec le nom et une description dans son frontmatter", async () => {
    expect((manifest.contributes.skills ?? []).map((s) => s.name)).toEqual([...SKILLS]);
    for (const s of manifest.contributes.skills ?? []) {
      const doc = parseMarkdownDoc(await readFile(join(EXTENSION_DIR, s.path, "SKILL.md"), "utf8"));
      expect(doc.data.name, s.name).toBe(s.name);
      expect(doc.data.description?.length, s.name).toBeGreaterThan(20);
    }
  });

  it("aucune skill devenue du code n'est reprise (portes, preuves, barre de qualité, commandes de stack)", () => {
    for (const gone of ["quality-gates-evidence-contract", "quality-gates-dotnet", "quality-gates-javascript", "skraft-quality-bar", "resolving-stack-commands"])
      expect(SKILLS as readonly string[], gone).not.toContain(gone);
  });
});

describe("Composition dans agent-studio (SPEC-skraft §6.4)", () => {
  it("chaque agent se compose depuis les vrais fichiers : sections injectées trouvées, contrat en dernier", async () => {
    const composed = await loadAgentPrompts(manifest, extensionFileReader(EXTENSION_DIR));
    for (const a of manifest.contributes.agents ?? []) {
      const p = composed.get(a.name)!.systemPrompt;
      expect(p.lastIndexOf("## Fonctionnement dans agent-studio"), a.name).toBeGreaterThan(0);
      expect(p, a.name).toContain(`appelant l'outil \`${a.output}\``);
    }
    const test = composed.get("skraft-test")!;
    // Section RED seule de outside-in-tdd : pas la synthèse du vert, réservée au dev.
    expect(test.systemPrompt).toContain("### Skill outside-in-tdd#RED");
    expect(test.systemPrompt).not.toContain("### Skill outside-in-tdd#SYNTHESIZE-GREEN");
    expect(composed.get("skraft-dev")!.systemPrompt).toContain("### Skill outside-in-tdd#SYNTHESIZE-GREEN");
    expect([...test.onDemand.keys()]).toEqual([...ROLE_SKILLS.test.onDemand]);
    // Le chercheur n'a aucune skill ; les lentilles n'ont que des critères à la demande.
    expect(composed.get("skraft-researcher")!.onDemand.size).toBe(0);
    expect(composed.get("skraft-researcher")!.systemPrompt).not.toContain("## Skills du rôle");
    expect([...composed.get("skraft-lens-cold-reader")!.onDemand.keys()]).toEqual([...ROLE_SKILLS.lens.onDemand]);
  });
});

describe("Le même dossier, plugin pour Claude Code et Copilot CLI", () => {
  it("les deux manifestes de plugin désignent les dossiers agents/ et skills/, sous GPL", async () => {
    for (const f of [".claude-plugin/plugin.json", "plugin.json"]) {
      const p = JSON.parse(await readFile(join(EXTENSION_DIR, f), "utf8")) as Record<string, unknown>;
      expect(p, f).toMatchObject({ name: "skraft-agent-studio", license: "GPL-3.0-or-later", agents: "./agents/", skills: "./skills/" });
    }
  });
});

describe("Arbitrage entre skills reprises et décisions du projet", () => {
  it("les rôles qui reçoivent craft-discipline ou outside-in-tdd sont avertis : le linter fait foi, le code commite et mesure", async () => {
    const composed = await loadAgentPrompts(manifest, extensionFileReader(EXTENSION_DIR));
    for (const name of ["skraft-acceptance", "skraft-test", "skraft-dev"]) {
      const p = composed.get(name)!.systemPrompt;
      expect(p, name).toContain("le linter du projet fait foi");
      expect(p, name).toContain("ne les fais pas");
      // L'arbitrage vient après les skills, et le contrat du cœur en dernier.
      expect(p.indexOf("le linter du projet fait foi"), name).toBeGreaterThan(p.lastIndexOf("### Skill "));
      expect(p.indexOf("## Fonctionnement dans agent-studio"), name).toBeGreaterThan(p.indexOf("le linter du projet fait foi"));
    }
  });
});
