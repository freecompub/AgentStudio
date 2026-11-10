#!/usr/bin/env node
/**
 * Déploie le serveur MCP skraft sur ce poste (10/11) : le construit, l'inscrit dans les clients
 * présents (Copilot CLI, Claude Code), et pose les commandes `/skraft-…`.
 *
 *   node scripts/deployer.mjs                          tout, pour chaque client trouvé
 *   node scripts/deployer.mjs --client copilot         un seul client (copilot ou claude)
 *   node scripts/deployer.mjs --env CLE=valeur         variable donnée au serveur (répétable)
 *   node scripts/deployer.mjs --remplacer              remplace une inscription existante différente
 *   node scripts/deployer.mjs --sans-build --sans-commandes
 *   node scripts/deployer.mjs --npm <dossier>          prépare le paquet npm et le compresse
 *   node scripts/deployer.mjs --npm <dossier> --publier  … et le publie (npm publish)
 *
 * Une inscription existante n'est jamais remplacée sans `--remplacer` : la retirer efface les
 * variables d'environnement qu'on y avait mises. Rien n'est publié sans `--publier`.
 */
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installerCommandes } from "./installer-commandes.mjs";

const NOM = "skraft";
const LIBELLE = { copilot: "Copilot CLI", claude: "Claude Code" };

/** Dépendances réelles : lancer une commande, la trouver dans le PATH, poser les commandes. */
export const depsReelles = {
  executer: (cmd, args, o = {}) =>
    new Promise((r) =>
      execFile(cmd, args, { cwd: o.cwd, maxBuffer: 16 * 1024 * 1024, shell: process.platform === "win32" }, (err, stdout, stderr) =>
        r({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, sortie: `${stdout}${stderr}` }),
      ),
    ),
  trouver: (cmd) => {
    const suffixes = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
    for (const base of (process.env.PATH ?? "").split(delimiter).filter(Boolean))
      for (const s of suffixes) {
        try {
          accessSync(join(base, `${cmd}${s}`), constants.X_OK);
          return true;
        } catch {
          /* pas ici */
        }
      }
    return false;
  },
  installerCommandes,
};

/** Ce qu'un client dit de l'inscription existante : la commande inscrite, ou rien. */
function commandeInscrite(client, sortie) {
  if (client === "copilot") return /Command:\s*(.+)/.exec(sortie)?.[1]?.trim() ?? null;
  const args = /Args:\s*(.+)/.exec(sortie)?.[1]?.trim();
  const cmd = /Command:\s*(.+)/.exec(sortie)?.[1]?.trim();
  return cmd ? [cmd, args].filter(Boolean).join(" ") : null;
}

async function inscrire(client, o, deps, main, lignes) {
  const libelle = LIBELLE[client];
  if (!deps.trouver(client)) return lignes.push(`${libelle} : absent (commande \`${client}\` introuvable), sauté.`);
  const voulue = `node ${main}`;
  const portee = client === "claude" ? ["-s", "user"] : [];
  const existante = commandeInscrite(client, (await deps.executer(client, ["mcp", "get", NOM])).sortie);
  if (existante === voulue) return lignes.push(`${libelle} : serveur ${NOM} déjà inscrit, inchangé.`);
  if (existante && !o.remplacer)
    return lignes.push(`${libelle} : un serveur ${NOM} est déjà inscrit (${existante}). --remplacer le remplace ; ses variables d'environnement seraient perdues.`);
  if (existante) await deps.executer(client, ["mcp", "remove", ...portee, NOM]);
  const env = (o.env ?? []).flatMap((e) => (client === "claude" ? ["-e", e] : ["--env", e]));
  const r = await deps.executer(client, ["mcp", "add", ...portee, NOM, ...env, "--", "node", main]);
  lignes.push(r.code === 0 ? `${libelle} : serveur ${NOM} inscrit.` : `${libelle} : l'inscription a échoué — ${r.sortie.trim()}`);
}

/** Le paquet npm : le serveur construit, les commandes, leur script, la licence du workflow embarqué. */
async function preparerPaquet(o, deps, lignes) {
  const racine = o.racine;
  const pkg = JSON.parse(await readFile(join(racine, "package.json"), "utf8"));
  const dossier = resolve(o.npm);
  await rm(dossier, { recursive: true, force: true });
  await mkdir(dossier, { recursive: true });
  for (const d of ["dist", "skills"]) await cp(join(racine, d), join(dossier, d), { recursive: true });
  await mkdir(join(dossier, "scripts"), { recursive: true });
  await cp(join(racine, "scripts", "installer-commandes.mjs"), join(dossier, "scripts", "installer-commandes.mjs"));
  await cp(join(racine, "README.md"), join(dossier, "README.md"));
  // Le workflow skraft embarqué est sous GPL-3.0-or-later (CLAUDE.md) : le paquet l'est donc aussi.
  await cp(join(racine, "dist", "workflows", "skraft", "LICENSE"), join(dossier, "LICENSE"));
  const garder = ["@github/copilot-sdk", "esbuild"];
  const paquet = {
    name: o.nom ?? pkg.name,
    version: pkg.version,
    description: "Serveur MCP skraft : recherche, conception, scénarios, TDD et revues, depuis Copilot CLI ou Claude Code.",
    license: "GPL-3.0-or-later",
    type: "module",
    bin: { "skraft-mcp": "dist/main.mjs", "skraft-mcp-commandes": "scripts/installer-commandes.mjs" },
    files: ["dist", "skills", "scripts", "LICENSE", "README.md"],
    dependencies: Object.fromEntries(garder.map((d) => [d, pkg.dependencies[d]])),
    engines: pkg.engines,
    repository: { type: "git", url: "https://github.com/freecompub/AgentStudio.git", directory: "apps/mcp-skraft" },
  };
  await writeFile(join(dossier, "package.json"), `${JSON.stringify(paquet, null, 2)}\n`);
  const pack = await deps.executer("npm", ["pack"], { cwd: dossier });
  lignes.push(pack.code === 0 ? `Paquet npm prêt dans ${dossier} (${paquet.name}@${paquet.version}).` : `npm pack a échoué — ${pack.sortie.trim()}`);
  if (!o.publier) return lignes.push("Rien n'est publié : relancer avec --publier pour le publier sur npm.");
  const pub = await deps.executer("npm", ["publish", "--access", "public"], { cwd: dossier });
  lignes.push(pub.code === 0 ? `Publié sur npm : ${paquet.name}@${paquet.version}.` : `npm publish a échoué — ${pub.sortie.trim()}`);
}

/**
 * @param {{ racine: string; client?: "copilot" | "claude"; env?: string[]; remplacer?: boolean; sansBuild?: boolean;
 *   sansCommandes?: boolean; projet?: string; npm?: string; publier?: boolean; nom?: string }} o
 */
export async function deployer(o, deps = depsReelles) {
  const lignes = [];
  if (!o.sansBuild) {
    const b = await deps.executer("node", [join(o.racine, "scripts", "build.mjs")]);
    if (b.code !== 0) return { lignes: [`Le build a échoué — ${b.sortie.trim()}`], ok: false };
    lignes.push("Serveur construit.");
  }
  if (o.npm) {
    await preparerPaquet(o, deps, lignes);
    return { lignes, ok: true };
  }
  const main = join(o.racine, "dist", "main.mjs");
  for (const client of o.client ? [o.client] : ["copilot", "claude"]) await inscrire(client, o, deps, main, lignes);
  if (!o.sansCommandes) {
    const r = await deps.installerCommandes({ source: join(o.racine, "skills"), ...(o.projet ? { projet: o.projet } : {}) });
    lignes.push(`Commandes /skraft-… : ${r.poses.length} lien${r.poses.length > 1 ? "s" : ""} posé${r.poses.length > 1 ? "s" : ""}.`, ...r.refuses);
  }
  return { lignes, ok: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const valeur = (opt) => {
    const i = args.indexOf(opt);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const env = args.flatMap((a, i) => (a === "--env" && args[i + 1] ? [args[i + 1]] : []));
  const client = valeur("--client");
  if (client && !["copilot", "claude"].includes(client)) {
    process.stderr.write("--client attend copilot ou claude.\n");
    process.exit(2);
  }
  const r = await deployer({
    racine: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    ...(client ? { client } : {}),
    env,
    remplacer: args.includes("--remplacer"),
    sansBuild: args.includes("--sans-build"),
    sansCommandes: args.includes("--sans-commandes"),
    ...(valeur("--projet") ? { projet: resolve(valeur("--projet")) } : {}),
    ...(valeur("--npm") ? { npm: valeur("--npm") } : {}),
    ...(valeur("--nom") ? { nom: valeur("--nom") } : {}),
    publier: args.includes("--publier"),
  });
  for (const l of r.lignes) process.stdout.write(`${l}\n`);
  if (r.ok && !valeur("--npm")) process.stdout.write("Redémarre Copilot CLI ou Claude Code pour qu'il relance le serveur.\n");
  process.exit(r.ok ? 0 : 1);
}
