import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionManifest, ManifestAgent } from "@agent-studio/extension-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  composeAgentPrompt,
  contractBlock,
  extensionFileReader,
  extractSection,
  loadAgentPrompts,
  loadSkillTool,
  parseMarkdownDoc,
  resolveSkillRef,
  type SkillSource,
} from "../src/agent-prompts.js";

const TDD = `---
name: outside-in-tdd
description: "Use when an approved scenario has to become working software."
---

# Outside-In TDD

Intro.

## The 4-Phase Cycle

### 1. PREPARE
Préparer.

### 2. RED (behavior failure only)
Écrire un test rouge.

\`\`\`
## pas un titre, dans un bloc de code
\`\`\`

#### Placeholder assertions
Détail du rouge.

### 3. SYNTHESIZE-GREEN
Passer au vert.

## Anti-Patterns
Ne pas faire.
`;

const skills = new Map<string, SkillSource>([["outside-in-tdd", { name: "outside-in-tdd", description: "Use when an approved scenario has to become working software.", body: parseMarkdownDoc(TDD).body }]]);

describe("Documents Markdown (frontmatter, sections)", () => {
  it("frontmatter lu (guillemets retirés, listes ignorées), corps sans frontmatter ; sans frontmatter : tout est corps", () => {
    const doc = parseMarkdownDoc("---\nname: dev\ndescription: 'Livre le code'\ntools:\n  - edit\n---\n\nCorps\n");
    expect(doc).toEqual({ data: { name: "dev", description: "Livre le code" }, body: "Corps" });
    expect(parseMarkdownDoc("# Titre\n\nTexte\n")).toEqual({ data: {}, body: "# Titre\n\nTexte" });
  });

  it("blocs YAML : repliés (`>`) sur une ligne, littéraux (`|`) avec leurs retours", () => {
    const folded = parseMarkdownDoc("---\nname: gate\ndescription: >\n  Use when deciding\n  whether an ADR is needed.\nmetadata:\n  x: 1\n---\nCorps");
    expect(folded.data).toEqual({ name: "gate", description: "Use when deciding whether an ADR is needed." });
    expect(parseMarkdownDoc("---\nnote: |-\n  ligne 1\n  ligne 2\n---\nC").data.note).toBe("ligne 1\nligne 2");
  });

  it("section : du titre (numéro ignoré, préfixe, casse) au prochain titre de même niveau, sous-titres et blocs de code compris", () => {
    const red = extractSection(parseMarkdownDoc(TDD).body, "RED");
    expect(red).toBe("### 2. RED (behavior failure only)\nÉcrire un test rouge.\n\n```\n## pas un titre, dans un bloc de code\n```\n\n#### Placeholder assertions\nDétail du rouge.");
    expect(extractSection(parseMarkdownDoc(TDD).body, "anti-patterns")).toBe("## Anti-Patterns\nNe pas faire.");
    expect(extractSection(parseMarkdownDoc(TDD).body, "Absente")).toBeNull();
  });

  it("référence de skill : entière, ou une section ; skill ou section inconnue refusée", () => {
    expect(resolveSkillRef("outside-in-tdd#SYNTHESIZE-GREEN", skills).content).toBe("### 3. SYNTHESIZE-GREEN\nPasser au vert.");
    expect(resolveSkillRef("outside-in-tdd", skills).content).toContain("## Anti-Patterns");
    expect(() => resolveSkillRef("autre", skills)).toThrow("Skill inconnue : autre");
    expect(() => resolveSkillRef("outside-in-tdd#Nulle part", skills)).toThrow("Section « Nulle part » introuvable dans la skill outside-in-tdd");
  });
});

describe("Composition du prompt : contenu partagé + contrat agent-studio", () => {
  const agent: ManifestAgent = {
    name: "dev",
    title: "Dév",
    prompt: "agents/dev.agent.md",
    role: "Le scénario en cours est dans le dossier de passation.",
    output: "report_phase",
    write: ["src/**"],
    tools: ["run_tests", "report_blocker"],
    skills: { mandatory: ["outside-in-tdd#RED"], onDemand: ["outside-in-tdd"] },
  };

  it("ordre : contenu du rôle, skills injectées, consignes d'orchestration, contrat en dernier", () => {
    const { systemPrompt, onDemand } = composeAgentPrompt(agent, "Tu livres le code en TDD.", skills);
    const at = (s: string) => systemPrompt.indexOf(s);
    expect(at("Tu livres le code en TDD.")).toBe(0);
    expect(at("### Skill outside-in-tdd#RED")).toBeGreaterThan(0);
    expect(at("Écrire un test rouge.")).toBeGreaterThan(at("### Skill outside-in-tdd#RED"));
    expect(systemPrompt).not.toContain("Passer au vert.");
    expect(at("Le scénario en cours")).toBeGreaterThan(at("Détail du rouge."));
    expect(at("## Fonctionnement dans agent-studio")).toBeGreaterThan(at("Le scénario en cours"));
    expect(systemPrompt).toContain("`outside-in-tdd` : Use when an approved scenario has to become working software.");
    expect([...onDemand.keys()]).toEqual(["outside-in-tdd"]);
  });

  it("contrat : outil de fin, run_tests, report_blocker, load_skill et périmètre selon l'agent ; Git toujours interdit", () => {
    const full = contractBlock({ output: "report_phase", tools: ["run_tests", "report_blocker"], writes: true, onDemand: [{ ref: "x", description: "d".repeat(400) }] });
    expect(full).toContain("appelant l'outil `report_phase`");
    expect(full).toContain("`run_tests`");
    expect(full).toContain("`report_blocker`");
    expect(full).toContain("`load_skill`");
    expect(full).toMatch(/`x` : d{299}…/);
    expect(full).toContain("N'utilise jamais Git");
    const lens = contractBlock({ output: "submit_lens_verdict", tools: [], writes: false, onDemand: [] });
    expect(lens).not.toMatch(/run_tests|report_blocker|load_skill/);
    expect(lens).toContain("Tu n'écris aucun fichier.");
  });

  it("contrat : les commandes de pile citées par les skills sont neutralisées, pas seulement contredites", () => {
    // Les skills sont reprises telles quelles (ADR 0024 §6) et viennent d'un cadre .NET :
    // `craft-discipline` fait lancer `dotnet test` et `dotnet build`, `test-design-mandates`
    // cite `[Theory]`. Sur un projet Swift ou TypeScript ces commandes sont fausses. Dire
    // « passe par run_tests » ne suffit pas : ça couvre les tests et laisse la compilation
    // à l'agent, avec une commande qui n'existe pas chez lui. Le contrat, qui prime (§3),
    // doit donc retirer la commande, pas seulement en proposer une autre.
    const full = contractBlock({ output: "report_phase", tools: ["run_tests"], writes: true, onDemand: [] });
    expect(full).toContain("N'exécute aucune commande de compilation ou de test toi-même");
    expect(full).toContain("dotnet test");
    // Un agent qui ne lance pas de tests n'a pas à recevoir cette consigne.
    expect(contractBlock({ output: "submit_lens_verdict", tools: [], writes: false, onDemand: [] })).not.toContain("dotnet test");
  });

  it("contrat : `run_lint` annoncé avec la réserve qui va avec — rien mesuré ne vaut pas conforme", () => {
    const dev = contractBlock({ output: "report_phase", tools: ["run_tests", "run_lint"], writes: true, onDemand: [] });
    expect(dev).toContain("`run_lint`");
    expect(dev).toMatch(/n'a rien mesuré/);
    expect(contractBlock({ output: "report_phase", tools: ["run_tests"], writes: true, onDemand: [] })).not.toContain("run_lint");
  });

  it("contrat : dire ce que l'agent N'A PAS, pas seulement ce qu'il a (ADR 0034)", () => {
    // Le contrat énumérait les outils disponibles et taisait les absents. L'agent découvrait donc
    // l'absence de shell en s'y cognant : trois refus sur un run réel, dix-huit sur un autre.
    // Un refus est un filet ; il ne remplace pas une consigne.
    const p = contractBlock({ output: "report_phase", tools: ["list_files", "run_tests"], writes: true, onDemand: [] });
    expect(p).toMatch(/ni shell|aucune commande/i);
    expect(p).toContain("`list_files`");
  });

  it("contrat : l'alternative proposée est celle que ce rôle possède vraiment", () => {
    // Proposer `list_files` à un rôle qui ne l'a pas enverrait l'agent contre un second mur.
    expect(contractBlock({ output: "submit_lens_verdict", tools: [], writes: false, onDemand: [] })).not.toContain("`list_files`");
  });

  it("agent sans fichier (consignes seules) : consignes puis contrat", () => {
    const p = composeAgentPrompt({ name: "a", title: "A", role: "Tu testes.", output: "report_phase" }, null, new Map()).systemPrompt;
    expect(p.startsWith("Tu testes.\n\n## Fonctionnement dans agent-studio")).toBe(true);
  });
});

describe("Lecture des fichiers de l'extension", () => {
  let dir: string;
  let outside: string;
  const put = async (rel: string, content: string) => {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), content);
  };
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "agent-studio-ext-"));
    outside = await mkdtemp(join(tmpdir(), "agent-studio-dehors-"));
    await writeFile(join(outside, "secret.md"), "secret");
    await put("agents/dev.agent.md", "---\nname: dev\ndescription: Livre\n---\n\nTu livres le code.\n");
    await put("skills/outside-in-tdd/SKILL.md", TDD);
    await symlink(join(outside, "secret.md"), join(dir, "agents/lien.md"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  const manifest = (agents: ManifestAgent[]): ExtensionManifest => ({
    id: "demo.ext",
    version: "1.0.0",
    publisher: "demo",
    engines: { appApi: "^0.1" },
    permissions: [],
    contributes: { agents, skills: [{ name: "outside-in-tdd", path: "skills/outside-in-tdd" }] },
  });

  it("rôle et skills lus depuis le dossier, frontmatter retiré", async () => {
    const out = await loadAgentPrompts(
      manifest([{ name: "dev", title: "Dév", prompt: "agents/dev.agent.md", output: "report_phase", skills: { mandatory: ["outside-in-tdd#RED"] } }]),
      extensionFileReader(dir),
    );
    const p = out.get("dev")!.systemPrompt;
    expect(p.startsWith("Tu livres le code.")).toBe(true);
    expect(p).not.toContain("description: Livre");
    expect(p).toContain("Écrire un test rouge.");
  });

  it("confinement : lien symbolique vers l'extérieur et fichier absent refusés ; dossier inconnu refusé", async () => {
    const read = extensionFileReader(dir);
    await expect(read("agents/lien.md")).rejects.toThrow("Fichier hors du dossier de l'extension : agents/lien.md");
    await expect(read("agents/absent.md")).rejects.toThrow("Fichier de l'extension introuvable : agents/absent.md");
    await expect(loadAgentPrompts(manifest([{ name: "dev", title: "Dév", prompt: "agents/dev.agent.md", output: "report_phase" }]), null)).rejects.toThrow(
      "L'extension demo.ext déclare des fichiers de rôle ou des skills, mais son dossier est inconnu",
    );
  });
});

describe("Outil load_skill", () => {
  it("rend la skill demandée et signale le chargement ; refuse une skill hors du rôle", async () => {
    const loaded: string[] = [];
    const tool = loadSkillTool(new Map([["craft", { description: "d", content: "Contenu craft" }]]), (r) => void loaded.push(r));
    expect(tool.parameters).toMatchObject({ properties: { name: { enum: ["craft"] } } });
    expect(await tool.handler({ name: "craft" })).toBe("Contenu craft");
    expect(loaded).toEqual(["craft"]);
    await expect(tool.handler({ name: "autre" })).rejects.toThrow("Skill inconnue pour ce rôle : autre. Disponibles : craft");
  });
});
