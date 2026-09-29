/**
 * Rôles et skills en fichiers Markdown (ADR 0024) : un seul contenu pour deux usages — orchestré par
 * agent-studio (manifeste + contrat du cœur), ou chargé tel quel par Copilot CLI / Claude Code.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionFileReader, loadAgentPrompts, parseMarkdownDoc } from "@agent-studio/extension-host";
import { describe, expect, it } from "vitest";
import { manifest } from "../src/manifest.js";
import { acOf } from "../src/distill.js";
import { ROLE_SKILLS, SKILLS } from "../src/roles.js";
import { EXTENSION_DIR } from "./support/harness.js";

const agentFiles = async () => (await readdir(join(EXTENSION_DIR, "agents"))).filter((f) => f.endsWith(".agent.md")).sort();

describe("Rôles de skraft en fichiers Markdown", () => {
  it("un fichier par agent déclaré, et aucun fichier orphelin", async () => {
    const declared = (manifest.contributes.agents ?? []).map((a) => a.prompt).sort();
    expect(declared.every(Boolean)).toBe(true);
    expect((await agentFiles()).map((f) => `agents/${f}`)).toEqual(declared);
  });

  it("aucun fichier livré que rien ne cite : le paquet est signé, le poids mort y est signé aussi", async () => {
    // Les fichiers annexes d'une skill (`references/`, `assets/`) ne sont lus que si un corps les
    // nomme. Ceux que personne ne nomme voyagent quand même dans le `.asx` et passent sous la
    // signature : ils ne peuvent plus être distingués du contenu qu'on a vraiment repris.
    const racine = join(EXTENSION_DIR, "skills");
    const tous = (await readdir(racine, { recursive: true, withFileTypes: true })).filter((e) => e.isFile());
    const corps = await Promise.all(
      tous.filter((e) => e.name.endsWith(".md")).map((e) => readFile(join(e.parentPath, e.name), "utf8")),
    );
    const orphelins = tous
      .filter((e) => e.name !== "SKILL.md")
      .filter((e) => !corps.some((c) => c.includes(e.name)))
      .map((e) => join(e.parentPath, e.name).slice(racine.length + 1));
    expect(orphelins).toEqual([]);
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

/**
 * La norme que `skraft-acceptance` doit porter (ADR 0043).
 *
 * Run du 29/09 : deux des trois essais de DISTILL ont été perdus sur la porte des valeurs, l'agent
 * écrivant des scénarios justes de sens mais reformulés — « une petite quantité » là où le critère
 * dit « 9 articles à 2,00 € ». L'instruction EXISTAIT : « Recopie les valeurs des critères mot pour
 * mot », en fin de paragraphe, sans exemple et sans dire ce que la porte compare réellement.
 *
 * Ces tests vérifient que la norme est là et qu'elle est ILLUSTRÉE — un exemple juste et un
 * contre-exemple —, pas qu'une phrase existe quelque part.
 */
describe("Norme de recopie et de nommage de skraft-acceptance (ADR 0043)", () => {
  const corps = async () => parseMarkdownDoc(await readFile(join(EXTENSION_DIR, "agents", "skraft-acceptance.agent.md"), "utf8")).body;
  // Le fichier est replié à 100 colonnes : une assertion sur une phrase doit survivre au repli.
  const prose = async () => (await corps()).replace(/\s+/g, " ");

  it("dit que la comparaison porte sur les caractères, pas sur le sens", async () => {
    const b = await prose();
    expect(b).toMatch(/caractère par caractère/i);
    expect(b).toMatch(/reformulation[^.]*ne passe pas/i);
  });

  it("montre un contre-exemple à côté de l'exemple : une règle sans contre-exemple n'a jamais suffi", async () => {
    const b = await corps();
    expect(b).toContain("✗");
    expect(b).toContain("✓");
    // Les valeurs de l'exemple sont celles d'un vrai critère, recopiées telles quelles.
    for (const v of ["10 articles ou plus : 5 %", "9 articles", "2,00 €", "0,00 €"]) expect(b, v).toContain(v);
  });

  it("place le marqueur dans le NOM du test, et le dit avec les formes qui marchent", async () => {
    const b = await corps();
    expect(await prose()).toMatch(/nom du test/i);
    // Toute forme donnée en exemple doit être reconnue par le code qui relie un résultat à son critère.
    for (const [ligne, attendu] of [
      ["Ac2_Une_ligne_qui_atteint_le_seuil_obtient_la_remise", 2],
      ["test_ac_2_ligne_au_seuil", 2],
      ["Une_ligne_qui_atteint_le_seuil", null],
    ] as const) {
      expect(b, ligne).toContain(ligne);
      expect(acOf(ligne), ligne).toBe(attendu);
    }
  });

  it("reste partageable : la norme ne nomme aucun outil ni mécanisme d'agent-studio", async () => {
    expect(await corps()).not.toMatch(/run_tests|report_phase|report_blocker|submit_[a-z_]+|render_adr|load_skill|orchestrat/i);
  });
});

/**
 * Ce qu'on demande à un agent doit être faisable avec ce qu'on lui accorde.
 *
 * Observé chez skraft-plugin v1.6.1 pendant le run comparé du 29/09
 * (`docs/05-run-compare-skraft-plugin-1.6.1.md`, A2) : deux de leurs quatre lentilles de revue ont
 * rendu leur verdict en déclarant « [SKILL MISSING] qa-reporting ». Leur contenu impose de charger
 * cette skill ; leur frontmatter n'accorde que Read, Grep et Glob. La skill EXISTE dans le paquet,
 * et six agents l'exigent. Elles ont jugé sans leur grille.
 *
 * C'est l'intersection qui bloque, pas l'un des deux côtés : le contenu est raisonnable, le jeu
 * d'outils est raisonnable, personne ne vérifie leur croisement. Nous avons eu exactement la même
 * chose — le chercheur réclamant `mkdir` sous une garde qui refuse le shell (ADR 0037), six tours
 * perdus.
 *
 * Ces tests vérifient le croisement. Ils ne lisent pas le contrat ajouté par le cœur (celui-là est
 * DÉRIVÉ du manifeste, donc cohérent par construction) : ils lisent ce que le contenu PARTAGÉ dit
 * à l'agent de faire, et le confrontent au manifeste.
 */
describe("Un agent peut faire ce que son contenu lui demande (ADR 0024, run comparé A2)", () => {
  const agents = manifest.contributes.agents;
  const corpsDe = async (nom: string) => parseMarkdownDoc(await readFile(join(EXTENSION_DIR, "agents", `${nom}.agent.md`), "utf8")).body;
  /** Un agent du manifeste, avec son contenu partagé. */
  const avecCorps = async () =>
    Promise.all(agents.filter((a) => a.prompt).map(async (a) => ({ a, corps: await corpsDe(a.name) })));

  it("qui dit « lance les tests » a `run_tests`", async () => {
    for (const { a, corps } of await avecCorps()) {
      if (!/lance[rz]?\s+(?:la suite de\s+)?(?:les\s+)?tests|exécute[rz]?\s+les tests/i.test(corps)) continue;
      expect(a.tools ?? [], `${a.name} demande de lancer les tests`).toContain("run_tests");
    }
  });

  it("qui dit « rédige un ADR » a `render_adr`", async () => {
    for (const { a, corps } of await avecCorps()) {
      if (!/r[ée]dige[^.\n]{0,40}ADR|ADR[^.\n]{0,40}r[ée]dige/i.test(corps)) continue;
      expect(a.tools ?? [], `${a.name} demande de rédiger un ADR`).toContain("render_adr");
    }
  });

  it("qui nomme un dossier de livrables a le droit d'y écrire", async () => {
    for (const { a, corps } of await avecCorps()) {
      // Chemins de livrables cités dans le contenu, sous la forme `.skraft/<slug>/…`.
      if (!/\.skraft\/<slug>\//.test(corps)) continue;
      expect(a.write ?? [], `${a.name} nomme un dossier de .skraft/`).toContain(".skraft/**");
    }
  });

  it("aucune skill exigée d'un rôle n'est absente du paquet", async () => {
    // Une skill obligatoire introuvable, c'est le cas `qa-reporting` : l'agent découvre le manque
    // au moment de juger, et juge quand même.
    const presentes = new Set(await readdir(join(EXTENSION_DIR, "skills")));
    for (const r of Object.values(ROLE_SKILLS)) {
      for (const s of [...((r as { mandatory?: readonly string[] }).mandatory ?? []), ...((r as { onDemand?: readonly string[] }).onDemand ?? [])]) {
        expect(presentes, s).toContain(s.split("#")[0]!);
      }
    }
  });

  it("toute skill exigée d'un rôle lui est bien accordée par le manifeste", async () => {
    // Appariement EXPLICITE : déduire la clé du nom échoue — `skraft-lens-test-integrity`
    // contient « test » et tomberait sur le rôle du testeur.
    const CLEF: Record<string, keyof typeof ROLE_SKILLS> = {
      "skraft-researcher": "researcher",
      "skraft-architect-model": "architectModel",
      "skraft-architect-decide": "architectDecide",
      "skraft-acceptance": "acceptance",
      "skraft-test": "test",
      "skraft-dev": "dev",
    };
    const exigees = (nom: string): string[] => {
      const k = nom.startsWith("skraft-lens-") ? "lens" : CLEF[nom];
      if (!k) return [];
      const r = ROLE_SKILLS[k] as { mandatory?: readonly string[]; onDemand?: readonly string[] };
      return [...(r.mandatory ?? []), ...(r.onDemand ?? [])];
    };
    for (const a of agents) {
      const attendues = exigees(a.name);
      if (!attendues.length) continue;
      const grant = (a.skills ?? {}) as { mandatory?: readonly string[]; onDemand?: readonly string[] };
      const accordees = [...(grant.mandatory ?? []), ...(grant.onDemand ?? [])];
      for (const s of attendues) expect(accordees, `${a.name} → ${s}`).toContain(s);
    }
  });
});
