import { mkdtemp, mkdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extraireMeta } from "../src/chargeur/meta.js";
import { trouverWorkflows } from "../src/chargeur/chargeur.js";

/**
 * Chargeur de workflows (ADR 0055, `docs/11` §4 et §5) : les workflows sont des dossiers, sur la
 * machine ou dans le projet ; leur `meta` est lu SANS exécuter le script, puis validé.
 */

const META = `{
  name: "skraft",
  description: "Livre une user story.",
  commande: "skraft",
  entrees: { story: { type: "fichier", obligatoire: true, aide: "La story." } },
  phases: { RESEARCH: "Enquête", DESIGN: "Conception" },
  humains: { "ratifier-adr": ["architecte"], escalade: ["developpeur", "architecte"] },
  permissions: { ecriture: [".skraft/**", "docs/adr/**", "@stack:unitTests"], tests: true, git: ["branche", "commit"] },
  agents: {
    "skraft-test": {
      prompt: "agents/skraft-test.agent.md",
      classe: "standard",
      ecriture: ["@stack:unitTests"],
      outils: ["list_files", "run_tests"],
      skills: { obligatoires: ["outside-in-tdd#RED"] },
      sortie: "report_phase",
      memoire: "tache",
    },
  },
}`;

const script = (meta = META, corps = "export default async function (w) {}") => `export const meta = ${meta};\n\n${corps}\n`;

let racine: string;
beforeEach(async () => {
  racine = await mkdtemp(join(tmpdir(), "workflows-"));
});
afterEach(async () => {
  await rm(racine, { recursive: true, force: true });
});

async function poser(dossier: string, fichiers: Record<string, string>) {
  for (const [rel, contenu] of Object.entries(fichiers)) {
    await mkdir(dirname(join(dossier, rel)), { recursive: true });
    await writeFile(join(dossier, rel), contenu);
  }
}

const COMPLET = {
  "workflow.mjs": script(),
  "agents/skraft-test.agent.md": "Tu écris un test.",
  "skills/outside-in-tdd/SKILL.md": "# TDD\n## RED\nÉcris un test rouge.",
};

describe("extraireMeta : lire la description sans exécuter le script", () => {
  it("objet littéral : clés sans guillemets, virgules finales, tableaux, nombres négatifs, booléens", () => {
    const r = extraireMeta(script(`{ name: "x", n: -2, ok: true, rien: null, liste: ["a", 'b',], o: { "k-1": 1.5, }, }`));
    expect(r).toEqual({ ok: true, meta: { name: "x", n: -2, ok: true, rien: null, liste: ["a", "b"], o: { "k-1": 1.5 } } });
  });

  it("le script n'est jamais exécuté : un effet de bord dans le corps ne se produit pas", () => {
    (globalThis as { __execute?: boolean }).__execute = false;
    extraireMeta(script(`{ name: "x" }`, "globalThis.__execute = true; export default async function () {}"));
    expect((globalThis as { __execute?: boolean }).__execute).toBe(false);
  });

  it.each([
    ["une variable", `{ name: NOM }`, /ligne 1.*Identifier/],
    ["un appel", `{ name: String("x") }`, /CallExpression/],
    ["un gabarit avec expression", "{ name: `x${1}` }", /TemplateLiteral/],
    ["un étalement", `{ ...autre }`, /SpreadElement/],
    ["une clé calculée", `{ ["a" + "b"]: 1 }`, /clé calculée/],
    ["une méthode", `{ f() { return 1; } }`, /méthode/],
  ])("refus : %s", (_cas, meta, motif) => {
    const r = extraireMeta(script(meta));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.motif).toMatch(motif);
  });

  it("gabarit sans expression : accepté comme une chaîne", () => {
    expect(extraireMeta(script("{ name: `x` }"))).toEqual({ ok: true, meta: { name: "x" } });
  });

  it("meta absent, ou exporté autrement qu'en `export const meta = …` : refus", () => {
    expect(extraireMeta("export default async function () {}")).toMatchObject({ ok: false, motif: expect.stringMatching(/meta absent/) });
    expect(extraireMeta("let meta = {}; export { meta };")).toMatchObject({ ok: false, motif: expect.stringMatching(/meta absent/) });
  });

  it("script illisible : refus avec la position de l'erreur", () => {
    expect(extraireMeta("export const meta = { name: ;")).toMatchObject({ ok: false, motif: expect.stringMatching(/syntaxe.*ligne 1/i) });
  });
});

describe("trouverWorkflows : deux emplacements, priorité au projet", () => {
  it("un dossier copié à la main est trouvé, avec son meta validé et l'empreinte de tout le dossier", async () => {
    await poser(join(racine, "projet/skraft"), COMPLET);
    const r = await trouverWorkflows({ projet: join(racine, "projet") });
    expect(r.erreurs).toEqual([]);
    expect(r.workflows).toHaveLength(1);
    expect(r.workflows[0]).toMatchObject({ nom: "skraft", origine: "projet", dossier: join(racine, "projet/skraft"), meta: { commande: "skraft" } });
    expect(r.workflows[0]!.empreinte).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("l'empreinte change dès qu'un fichier du dossier change, même hors du script", async () => {
    await poser(join(racine, "projet/skraft"), COMPLET);
    const avant = (await trouverWorkflows({ projet: join(racine, "projet") })).workflows[0]!.empreinte;
    await poser(join(racine, "projet/skraft"), { "agents/skraft-test.agent.md": "Tu écris DEUX tests." });
    const apres = (await trouverWorkflows({ projet: join(racine, "projet") })).workflows[0]!.empreinte;
    expect(apres).not.toBe(avant);
  });

  // Revue de la PR #12 : un lien symbolique était ignoré par l'empreinte, alors que la compilation le suit.
  it("l'empreinte change quand la cible d'un lien symbolique du dossier change", async () => {
    await poser(join(racine, "projet/skraft"), { ...COMPLET, "lib/a.mjs": "export const a = 1;\n", "lib/b.mjs": "export const a = 2;\n" });
    await symlink("a.mjs", join(racine, "projet/skraft/lib/actuel.mjs"));
    const avant = (await trouverWorkflows({ projet: join(racine, "projet") })).workflows[0]!.empreinte;
    await unlink(join(racine, "projet/skraft/lib/actuel.mjs"));
    await symlink("b.mjs", join(racine, "projet/skraft/lib/actuel.mjs"));
    const apres = (await trouverWorkflows({ projet: join(racine, "projet") })).workflows[0]!.empreinte;
    expect(apres).not.toBe(avant);
  });

  it("même nom sur la machine et dans le projet : le projet l'emporte, et c'est dit", async () => {
    await poser(join(racine, "machine/skraft"), COMPLET);
    await poser(join(racine, "projet/skraft"), COMPLET);
    await poser(join(racine, "machine/autre"), { ...COMPLET, "workflow.mjs": script(META.replace('name: "skraft"', 'name: "autre"').replace('commande: "skraft"', 'commande: "autre"')) });
    const r = await trouverWorkflows({ machine: join(racine, "machine"), projet: join(racine, "projet") });
    expect(r.workflows.map((x) => [x.nom, x.origine])).toEqual([
      ["autre", "machine"],
      ["skraft", "projet"],
    ]);
    expect(r.remplacements).toEqual([{ nom: "skraft", dossierMachine: join(racine, "machine/skraft"), dossierProjet: join(racine, "projet/skraft") }]);
  });

  it("un workflow invalide est écarté avec ses motifs, sans empêcher les autres", async () => {
    await poser(join(racine, "projet/skraft"), COMPLET);
    await poser(join(racine, "projet/casse"), { "workflow.mjs": script(`{ name: NOM }`) });
    const r = await trouverWorkflows({ projet: join(racine, "projet") });
    expect(r.workflows.map((x) => x.nom)).toEqual(["skraft"]);
    expect(r.erreurs).toEqual([{ dossier: join(racine, "projet/casse"), motifs: [expect.stringMatching(/meta non littéral/)] }]);
  });

  it("emplacements absents et dossiers sans workflow.mjs : ignorés", async () => {
    await poser(join(racine, "projet/notes"), { "README.md": "pas un workflow" });
    expect(await trouverWorkflows({ machine: join(racine, "absent"), projet: join(racine, "projet") })).toEqual({ workflows: [], erreurs: [], remplacements: [] });
  });
});

describe("validation du meta", () => {
  const motifsDe = async (meta: string, fichiers: Record<string, string> = {}) => {
    await poser(join(racine, "projet/w"), { ...COMPLET, ...fichiers, "workflow.mjs": script(meta) });
    const r = await trouverWorkflows({ projet: join(racine, "projet") });
    return r.erreurs[0]?.motifs ?? [];
  };

  it("un meta complet et cohérent passe", async () => {
    expect(await motifsDe(META)).toEqual([]);
  });

  it("nom et commande : minuscules, chiffres et tirets ; le nom du dossier n'est pas imposé", async () => {
    expect(await motifsDe(META.replace('commande: "skraft"', 'commande: "Skraft!"'))).toEqual([expect.stringMatching(/commande/)]);
  });

  it("champ inconnu : refusé (la description est fermée)", async () => {
    expect(await motifsDe(META.replace('description: "Livre une user story.",', 'description: "x", couleur: "rouge",'))).toEqual([expect.stringMatching(/couleur/)]);
  });

  it("fichier de l'agent ou skill introuvables dans le dossier : refusé", async () => {
    expect(await motifsDe(META.replace("agents/skraft-test.agent.md", "agents/absent.agent.md"))).toEqual([expect.stringMatching(/skraft-test.*agents\/absent\.agent\.md.*introuvable/)]);
    expect(await motifsDe(META.replace("outside-in-tdd#RED", "inconnue"))).toEqual([expect.stringMatching(/skraft-test.*skill.*inconnue.*introuvable/)]);
  });

  it("chemin qui sort du dossier : refusé", async () => {
    expect(await motifsDe(META.replace("agents/skraft-test.agent.md", "../ailleurs.agent.md"))).toEqual([expect.stringMatching(/chemin/)]);
  });

  it("outil qui n'est pas un outil de la plateforme : refusé (un workflow n'apporte pas d'outil)", async () => {
    expect(await motifsDe(META.replace('outils: ["list_files", "run_tests"]', 'outils: ["list_files", "render_adr"]'))).toEqual([expect.stringMatching(/skraft-test.*outil inconnu.*render_adr/)]);
  });

  it("run_tests sans la permission des tests : refusé", async () => {
    expect(await motifsDe(META.replace("tests: true", "tests: false"))).toEqual([expect.stringMatching(/skraft-test.*run_tests.*permissions\.tests/)]);
  });

  it("un agent ne peut pas écrire plus que ce que le workflow déclare", async () => {
    expect(await motifsDe(META.replace('ecriture: ["@stack:unitTests"]', 'ecriture: ["src/**"]'))).toEqual([expect.stringMatching(/skraft-test.*src\/\*\*.*permissions\.ecriture/)]);
  });

  it("profil, sortie, classe ou mémoire inconnus : refusés", async () => {
    expect(await motifsDe(META.replace('["architecte"]', '["chef"]'))).toEqual([expect.stringMatching(/humains/)]);
    expect(await motifsDe(META.replace('sortie: "report_phase"', 'sortie: "rapport"'))).toEqual([expect.stringMatching(/sortie/)]);
  });
});
