/**
 * Essai réel du serveur MCP skraft (ADR 0068) : ce script joue l'hôte MCP. Il lance le serveur
 * construit (`apps/mcp-skraft/dist/main.mjs`) en stdio, démarre le workflow sur une story, suit
 * `skraft_etat` et répond aux questions avec le répondeur commun du banc (`scripts/banc/repondeur.ts`,
 * mêmes décisions que les runs de comparaison). Hors CI : **consomme de vraies requêtes Copilot**.
 * Travaille sur un **clone** du projet, jamais sur le dépôt donné.
 *
 *   pnpm --filter @agent-studio/mcp-skraft build
 *   pnpm tsx scripts/essai-mcp-skraft.ts <projet> <story> <reponses.json> [--auto]
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { repondre, type Reponses } from "./banc/repondeur.js";

const args = process.argv.slice(2);
const auto = args.includes("--auto");
const [source, story, fichierReponses] = args.filter((a) => !a.startsWith("--"));
if (!source || !story || !fichierReponses) throw new Error("Utilisation : essai-mcp-skraft.ts <projet> <story> <reponses.json> [--auto]");

const base = await realpath(await mkdtemp(join(tmpdir(), "essai-mcp-skraft-")));
const projet = join(base, "projet");
execFileSync("git", ["clone", "-q", "--no-hardlinks", resolve(source), projet]);
// Configuration propre à l'essai : seul le clone est autorisé ; profil architecte (ratification
// d'ADR), programmes par défaut.
await writeFile(join(base, "mcp-skraft.json"), JSON.stringify({ autorises: [base] }));
await writeFile(join(base, "admin.json"), JSON.stringify({ profile: { role: "architecte" } }));

const reponses = JSON.parse(await readFile(fichierReponses, "utf8")) as Reponses;
const memoire = new Map<string, number>();
const t0 = Date.now();
const h = () => `[${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s]`;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve("apps/mcp-skraft/dist/main.mjs")],
  cwd: projet,
  env: {
    ...(process.env as Record<string, string>),
    PATH: [join(homedir(), ".dotnet"), process.env["PATH"] ?? ""].join(delimiter),
    SKRAFT_MCP_CONFIG: join(base, "mcp-skraft.json"),
    AGENT_STUDIO_ADMIN_CONFIG: join(base, "admin.json"),
  },
  stderr: "inherit",
});
const client = new Client({ name: "essai-mcp-skraft", version: "0.0.0" });
await client.connect(transport);
const appel = async (name: string, a: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: a })) as { content: { text: string }[]; isError?: boolean };
  return { texte: r.content.map((c) => c.text).join("\n"), erreur: r.isError === true };
};

console.log(`Clone : ${projet}\n`);
const etat0 = await appel("skraft_etat");
console.log(etat0.texte, "\n");
const premier = await appel("skraft_demarrer", { story, ...(auto ? { auto } : {}) });
console.log(`${h()} skraft_demarrer →\n${premier.texte}\n`);
// L'accord est donné ici au nom de l'utilisateur, qui a demandé l'essai.
const lance = premier.texte.startsWith("Accord requis") ? await appel("skraft_demarrer", { story, ...(auto ? { auto } : {}), accord: "une-fois" }) : premier;
console.log(`${h()} ${lance.texte}\n`);
if (lance.erreur) process.exit(1);
const tache = /tâche (\S+)\./.exec(lance.texte)![1]!;

type Etat = { taches: { id: string; status: string; phase: string; phaseLabel: string; etape?: { index: number; total: number }; dernierRejet?: string; usage?: { requests: number } }[]; questions: { id: string; title: string; detail?: string; options: { id: string; label: string }[]; profils?: string[] }[]; messages: string[] };
let derniere = "";
let messagesVus = 0;
const repondues = new Set<string>();
for (;;) {
  const e = JSON.parse((await appel("skraft_etat")).texte) as Etat;
  const t = e.taches.find((x) => x.id === tache);
  const resume = t ? `${t.phase}${t.etape ? ` ${t.etape.index}/${t.etape.total}` : ""} (${t.status})${t.usage ? ` — ${t.usage.requests.toFixed(1)} req.` : ""}` : "?";
  if (resume !== derniere) console.log(`${h()} ${resume}${t?.dernierRejet ? `\n        rejet : ${t.dernierRejet.slice(0, 200)}` : ""}`);
  derniere = resume;
  for (const m of e.messages.slice(messagesVus)) console.log(`${h()} 💬 ${m.slice(0, 400)}`);
  messagesVus = e.messages.length;
  for (const q of e.questions) {
    if (repondues.has(q.id)) continue;
    const c = repondre({ title: q.title, ...(q.detail ? { detail: q.detail } : {}), options: q.options, ...(q.profils ? { requiredRoles: q.profils } : {}) }, reponses, memoire);
    const r = await appel("skraft_repondre", { question: q.id, option: c.option, ...(c.commentaire ? { texte: c.commentaire } : {}) });
    console.log(`${h()} ❓ ${q.title}\n        → ${q.options.find((o) => o.id === c.option)?.label ?? c.option}${c.commentaire ? ` — « ${c.commentaire.slice(0, 80)} »` : ""}${r.erreur ? `\n        ✖ ${r.texte}` : ""}`);
    if (!r.erreur) repondues.add(q.id);
  }
  if (t?.status === "finished") break;
  await new Promise((r) => setTimeout(r, 15_000));
}
const rapport = await appel("skraft_rapport", { tache });
await writeFile(join(base, "rapport.json"), rapport.texte);
console.log(`\n${h()} Rapport :\n${rapport.texte.slice(0, 4000)}\n\nRapport complet : ${join(base, "rapport.json")}\nClone : ${projet}`);
await client.close();
