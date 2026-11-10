/**
 * Le script de déploiement du serveur MCP (10/11) : construire, inscrire le serveur dans les clients
 * présents (Copilot CLI, Claude Code), poser les commandes. Les clients et le build sont doublés :
 * on vérifie les commandes lancées, jamais de vrai client touché. L'option `--npm` prépare le paquet ;
 * la publication n'a lieu qu'avec `--publier`.
 */
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deployer } from "../scripts/deployer.mjs";

const RACINE = join(import.meta.dirname, "..");
const MAIN = join(RACINE, "dist", "main.mjs");

/** Clients doublés : `inscrits` tient l'état de chacun, `lances` les commandes reçues. */
function doublure(o: { clients?: string[]; inscrits?: Record<string, string> } = {}) {
  const lances: string[] = [];
  const inscrits: Record<string, string> = { ...o.inscrits };
  const presents = new Set(o.clients ?? ["copilot", "claude"]);
  return {
    lances,
    inscrits,
    deps: {
      trouver: (cmd: string) => presents.has(cmd) || ["node", "npm"].includes(cmd),
      executer: async (cmd: string, args: string[]) => {
        lances.push([cmd, ...args].join(" "));
        const sous = args.slice(0, 2).join(" ");
        if (cmd === "copilot" && sous === "mcp get") return inscrits.copilot ? { code: 0, sortie: `skraft\n  Command: ${inscrits.copilot}\n` } : { code: 1, sortie: 'Error: Server "skraft" not found.' };
        if (cmd === "claude" && sous === "mcp get") return inscrits.claude ? { code: 0, sortie: `skraft:\n  Command: node\n  Args: ${inscrits.claude.replace(/^node /, "")}\n` } : { code: 1, sortie: "No MCP server found" };
        if ((cmd === "copilot" || cmd === "claude") && sous === "mcp remove") delete inscrits[cmd];
        if ((cmd === "copilot" || cmd === "claude") && sous === "mcp add") inscrits[cmd] = `node ${MAIN}`;
        return { code: 0, sortie: "" };
      },
      installerCommandes: async () => ({ poses: ["l1"], retires: [], refuses: [] }),
    },
  };
}

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "deployer-"));
});

/**
 * Une racine jetable pour `--npm` : le vrai `package.json`, les vrais skills et scripts, un `dist/`
 * factice. Le vrai `dist/` est reconstruit par le test stdio, en parallèle : on n'en dépend pas.
 */
async function racineJetable() {
  const r = join(tmp, "racine");
  for (const f of ["package.json", "README.md"]) {
    await mkdir(r, { recursive: true });
    await cp(join(RACINE, f), join(r, f));
  }
  await cp(join(RACINE, "skills"), join(r, "skills"), { recursive: true });
  await cp(join(RACINE, "scripts"), join(r, "scripts"), { recursive: true });
  await mkdir(join(r, "dist", "workflows", "skraft"), { recursive: true });
  await writeFile(join(r, "dist", "main.mjs"), "// serveur\n");
  await writeFile(join(r, "dist", "workflows", "skraft", "LICENSE"), "GNU GENERAL PUBLIC LICENSE\n");
  return r;
}
afterEach(() => rm(tmp, { recursive: true, force: true }));

describe("deployer", () => {
  it("construit, inscrit le serveur dans chaque client présent avec ses variables, pose les commandes", async () => {
    const d = doublure();
    const r = await deployer({ racine: RACINE, env: ["AGENT_STUDIO_ADMIN_CONFIG=/a/admin.json"] }, d.deps);
    expect(d.lances).toContain(`node ${join(RACINE, "scripts", "build.mjs")}`);
    expect(d.lances).toContain(`copilot mcp add skraft --env AGENT_STUDIO_ADMIN_CONFIG=/a/admin.json -- node ${MAIN}`);
    expect(d.lances).toContain(`claude mcp add -s user skraft -e AGENT_STUDIO_ADMIN_CONFIG=/a/admin.json -- node ${MAIN}`);
    expect(r.lignes).toEqual(expect.arrayContaining(["Copilot CLI : serveur skraft inscrit.", "Claude Code : serveur skraft inscrit.", "Commandes /skraft-… : 1 lien posé."]));
  });

  it("un client absent est sauté, et c'est dit", async () => {
    const d = doublure({ clients: ["copilot"] });
    const r = await deployer({ racine: RACINE }, d.deps);
    expect(d.lances.some((l) => l.startsWith("claude"))).toBe(false);
    expect(r.lignes).toContain("Claude Code : absent (commande `claude` introuvable), sauté.");
  });

  it("déjà inscrit avec la même commande : rien n'est touché ; avec une autre : remplacé seulement sur --remplacer", async () => {
    const meme = doublure({ inscrits: { copilot: `node ${MAIN}`, claude: `node ${MAIN}` } });
    const r = await deployer({ racine: RACINE, sansBuild: true }, meme.deps);
    expect(meme.lances.filter((l) => / mcp (add|remove) /.test(l))).toEqual([]);
    expect(r.lignes).toContain("Copilot CLI : serveur skraft déjà inscrit, inchangé.");
    const autre = doublure({ inscrits: { copilot: "node /ancien/main.mjs", claude: "node /ancien/main.mjs" } });
    const r2 = await deployer({ racine: RACINE, sansBuild: true }, autre.deps);
    expect(autre.lances.filter((l) => / mcp (add|remove) /.test(l))).toEqual([]);
    expect(r2.lignes).toContain("Copilot CLI : un serveur skraft est déjà inscrit (node /ancien/main.mjs). --remplacer le remplace ; ses variables d'environnement seraient perdues.");
    const remplace = doublure({ inscrits: { copilot: "node /ancien/main.mjs", claude: "node /ancien/main.mjs" } });
    await deployer({ racine: RACINE, sansBuild: true, remplacer: true }, remplace.deps);
    expect(remplace.lances.filter((l) => / mcp (add|remove) /.test(l))).toEqual([
      "copilot mcp remove skraft",
      `copilot mcp add skraft -- node ${MAIN}`,
      "claude mcp remove -s user skraft",
      `claude mcp add -s user skraft -- node ${MAIN}`,
    ]);
  });

  it("--client limite à un client ; --sans-commandes ne pose rien", async () => {
    const d = doublure();
    let poses = 0;
    await deployer({ racine: RACINE, sansBuild: true, client: "claude", sansCommandes: true }, { ...d.deps, installerCommandes: async () => (poses++, { poses: [], retires: [], refuses: [] }) });
    expect(d.lances.some((l) => l.startsWith("copilot"))).toBe(false);
    expect(poses).toBe(0);
  });

  it("--npm prépare le paquet (dist, skills, script des commandes, licence GPL) et le compresse, sans le publier", async () => {
    const d = doublure();
    const r = await deployer({ racine: await racineJetable(), sansBuild: true, npm: join(tmp, "paquet") }, d.deps);
    const pkg = JSON.parse(await readFile(join(tmp, "paquet", "package.json"), "utf8"));
    expect(pkg).toMatchObject({ license: "GPL-3.0-or-later", type: "module", bin: { "skraft-mcp": "dist/main.mjs", "skraft-mcp-commandes": "scripts/installer-commandes.mjs" } });
    expect(Object.keys(pkg.dependencies)).toEqual(["@github/copilot-sdk", "esbuild"]);
    expect(pkg.private).toBeUndefined();
    for (const f of ["dist/main.mjs", "skills/skraft-etat/SKILL.md", "scripts/installer-commandes.mjs", "LICENSE", "README.md"]) expect((await stat(join(tmp, "paquet", f))).isFile(), f).toBe(true);
    expect(d.lances).toContain("npm pack");
    expect(d.lances.some((l) => l.startsWith("npm publish"))).toBe(false);
    expect(d.lances.some((l) => / mcp add /.test(l))).toBe(false);
    expect(r.lignes.join("\n")).toMatch(/--publier/);
  });

  it("--npm --publier : la publication est lancée, et seulement alors", async () => {
    const d = doublure();
    await deployer({ racine: await racineJetable(), sansBuild: true, npm: join(tmp, "paquet"), publier: true }, d.deps);
    expect(d.lances).toContain("npm publish --access public");
  });
});
