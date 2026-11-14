/**
 * Essai réel du serveur MCP skraft (ADR 0068) : ce script joue l'hôte MCP. Il lance le serveur
 * construit (`apps/mcp-skraft/dist/main.mjs`) en stdio, démarre le workflow sur une story, suit
 * `skraft_etat` et répond aux questions avec le répondeur commun du banc (`scripts/banc/repondeur.ts`,
 * mêmes décisions que les runs de comparaison). Hors CI : **consomme de vraies requêtes Copilot**.
 * Travaille sur un **clone** du projet, jamais sur le dépôt donné.
 *
 *   pnpm --filter @agent-studio/mcp-skraft build
 *   pnpm tsx scripts/essai-mcp-skraft.ts <projet ou adresse Git> <story> <reponses.json> [--auto] [--runtime=claude] [--base=<commit>] [--pile=<fichier yaml>] [--suivi=attendre] [--installer]
 *     [--arreter-en=DELIVER:120] [--reprise=continuer|nouvelle]
 *
 * `--arreter-en=<PHASE>:<secondes>` (avec `--suivi=attendre`) : arrête le run (`skraft_arreter`) ce temps
 * après son entrée dans la phase, puis relance la même story sur le même clone ; `--reprise` dit quoi
 * répondre à la question de reprise (ADR 0089), « continuer » par défaut.
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
// Runtime des agents (ADR 0070) : Copilot par défaut.
const runtime = args.find((a) => a.startsWith("--runtime="))?.slice("--runtime=".length) ?? "copilot";
// Commit de départ (par défaut, la branche par défaut du dépôt cloné).
const baseRun = args.find((a) => a.startsWith("--base="))?.slice("--base=".length);
// Suivi par `skraft_attendre` (09/11) : affiche ce que l'hôte montrerait à l'utilisateur, changement par changement.
const parAttente = args.includes("--suivi=attendre");
// Pile donnée par l'hôte (argument `pile` de skraft_demarrer), pour un projet qui n'en déclare pas.
const fichierPile = args.find((a) => a.startsWith("--pile="))?.slice("--pile=".length);
// Installer les dépendances du clone avant de démarrer (11/11) : un projet Node n'a pas son node_modules.
const installer = args.includes("--installer");
const pile = fichierPile ? await readFile(fichierPile, "utf8") : undefined;
// Reprise d'une story arrêtée (ADR 0089) : arrêter en cours de phase, puis relancer.
const [phaseArret, secondesArret] = (args.find((a) => a.startsWith("--arreter-en="))?.slice("--arreter-en=".length) ?? "").split(":");
const choixReprise = args.find((a) => a.startsWith("--reprise="))?.slice("--reprise=".length) ?? "continuer";
const [source, story, fichierReponses] = args.filter((a) => !a.startsWith("--"));
if (!source || !story || !fichierReponses) throw new Error("Utilisation : essai-mcp-skraft.ts <projet> <story> <reponses.json> [--auto]");

const base = await realpath(await mkdtemp(join(tmpdir(), "essai-mcp-skraft-")));
const projet = join(base, "projet");
execFileSync("git", ["clone", "-q", "--no-hardlinks", /^[a-z]+:\/\//.test(source) ? source : resolve(source), projet]);
if (baseRun) execFileSync("git", ["checkout", "-q", "-b", `base-${baseRun.slice(0, 7)}`, baseRun], { cwd: projet });
if (installer) execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: projet, stdio: "inherit" });
// Configuration propre à l'essai : seul le clone est autorisé ; programmes par défaut.
await writeFile(join(base, "mcp-skraft.json"), JSON.stringify({ autorises: [base], runtime }));
await writeFile(join(base, "admin.json"), JSON.stringify({}));

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
const demarrage = { story, ...(auto ? { auto } : {}), ...(pile ? { pile } : {}) };
const premier = await appel("skraft_demarrer", demarrage);
console.log(`${h()} skraft_demarrer →\n${premier.texte}\n`);
// L'accord est donné ici au nom de l'utilisateur, qui a demandé l'essai.
const lance = premier.texte.startsWith("Accord requis") ? await appel("skraft_demarrer", { ...demarrage, accord: "une-fois" }) : premier;
console.log(`${h()} ${lance.texte}\n`);
if (lance.erreur) process.exit(1);
let tache = /tâche (\S+)\./.exec(lance.texte)![1]!;
let arrete = false;
let entreeEnPhase: number | null = null;
/** Relance la story après l'arrêt : l'accord est redonné une fois, comme au premier lancement. */
async function relancerLaStory(): Promise<string> {
  const p = await appel("skraft_demarrer", demarrage);
  const l = p.texte.startsWith("Accord requis") ? await appel("skraft_demarrer", { ...demarrage, accord: "une-fois" }) : p;
  console.log(`${h()} relance → ${l.texte}\n`);
  if (l.erreur) process.exit(1);
  return /tâche (\S+)\./.exec(l.texte)![1]!;
}

type Etat = { taches: { id: string; status: string; phase: string; phaseLabel: string; etape?: { index: number; total: number }; dernierRejet?: string; usage?: { requests: number } }[]; questions: { id: string; title: string; detail?: string; options: { id: string; label: string }[] }[]; messages: string[] };
let derniere = "";
let messagesVus = 0;
const repondues = new Set<string>();
type Attente = { changements: string[]; progression: string[]; questions: Etat["questions"]; termine: boolean };
for (; parAttente; ) {
  const r = JSON.parse((await appel("skraft_attendre", { tache, delai: 50 })).texte) as Attente;
  for (const c of r.changements) console.log(`${h()} ${c.slice(0, 400)}`);
  for (const l of r.progression) console.log(`        ⏵ ${l}`);
  for (const q of r.questions) {
    if (repondues.has(q.id)) continue;
    const reprise = /a déjà une session/.test(q.title) ? q.options.find((o) => o.id.endsWith(choixReprise)) : undefined;
    const c = reprise ? { option: reprise.id } as { option: string; commentaire?: string } : repondre({ title: q.title, ...(q.detail ? { detail: q.detail } : {}), options: q.options }, reponses, memoire);
    if (reprise) console.log(`${h()} ❓ ${q.title}\n${(q.detail ?? "").replace(/^/gm, "        ")}`);
    const rep = await appel("skraft_repondre", { question: q.id, option: c.option, ...(c.commentaire ? { texte: c.commentaire } : {}) });
    console.log(`${h()} ↳ réponse : ${q.options.find((o) => o.id === c.option)?.label ?? c.option}${c.commentaire ? ` — « ${c.commentaire.slice(0, 80)} »` : ""}${rep.erreur ? `\n        ✖ ${rep.texte}` : ""}`);
    if (!rep.erreur) repondues.add(q.id);
  }
  if (phaseArret && !arrete && !r.termine) {
    const e = JSON.parse((await appel("skraft_etat")).texte) as Etat;
    if (e.taches.find((x) => x.id === tache)?.phase === phaseArret) entreeEnPhase ??= Date.now();
    if (entreeEnPhase !== null && Date.now() - entreeEnPhase >= Number(secondesArret ?? 0) * 1000) {
      const a = await appel("skraft_arreter", { tache });
      console.log(`${h()} ■ ${a.texte}`);
      await writeFile(join(base, "rapport-1.json"), (await appel("skraft_rapport", { tache })).texte);
      arrete = true;
      tache = await relancerLaStory();
      continue;
    }
  }
  if (r.termine) break;
}
for (; !parAttente; ) {
  const e = JSON.parse((await appel("skraft_etat")).texte) as Etat;
  const t = e.taches.find((x) => x.id === tache);
  const resume = t ? `${t.phase}${t.etape ? ` ${t.etape.index}/${t.etape.total}` : ""} (${t.status})${t.usage ? ` — ${t.usage.requests.toFixed(1)} req.` : ""}` : "?";
  if (resume !== derniere) console.log(`${h()} ${resume}${t?.dernierRejet ? `\n        rejet : ${t.dernierRejet.slice(0, 200)}` : ""}`);
  derniere = resume;
  for (const m of e.messages.slice(messagesVus)) console.log(`${h()} 💬 ${m.slice(0, 400)}`);
  messagesVus = e.messages.length;
  for (const q of e.questions) {
    if (repondues.has(q.id)) continue;
    const c = repondre({ title: q.title, ...(q.detail ? { detail: q.detail } : {}), options: q.options }, reponses, memoire);
    const r = await appel("skraft_repondre", { question: q.id, option: c.option, ...(c.commentaire ? { texte: c.commentaire } : {}) });
    console.log(`${h()} ❓ ${q.title}\n        → ${q.options.find((o) => o.id === c.option)?.label ?? c.option}${c.commentaire ? ` — « ${c.commentaire.slice(0, 80)} »` : ""}${r.erreur ? `\n        ✖ ${r.texte}` : ""}`);
    if (!r.erreur) repondues.add(q.id);
  }
  if (t?.status === "finished") break;
  await new Promise((r) => setTimeout(r, 15_000));
}
const rapport = await appel("skraft_rapport", { tache });
await writeFile(join(base, "rapport.json"), rapport.texte);
// Étapes du run : une par phase et par rejeu, avec début, fin, durée, rejets (porte et motifs), coût.
type Etape = { phase: string; essai: number; debut: string; fin: string; dureeMs: number; tours: number; rejets: { porte: string; motifs: string[] }[]; aiu: number; coutUsd: number; modeles: string[] };
const etapes = (JSON.parse(rapport.texte) as { etapes?: Etape[] }).etapes ?? [];
const mn = (ms: number) => `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}`;
console.log(`\nRuntime : ${runtime}\n\n| Étape | Essai | Début | Fin | Durée | Tours | Rejets | Coût | Modèles |\n|---|---|---|---|---|---|---|---|---|`);
for (const e of etapes)
  console.log(`| ${e.phase} | ${e.essai} | ${e.debut.slice(11, 19)} | ${e.fin.slice(11, 19)} | ${mn(e.dureeMs)} | ${e.tours} | ${e.rejets.map((r) => `${r.porte} : ${r.motifs.join(" ; ")}`).join(" / ").replace(/\|/g, "\\|") || "—"} | ${runtime === "claude" ? `${e.coutUsd.toFixed(4)} $` : `${e.aiu} AIU`} | ${e.modeles.join(", ")} |`);
const total = etapes.reduce((n, e) => ({ ms: n.ms + e.dureeMs, rejets: n.rejets + e.rejets.length, usd: n.usd + e.coutUsd, aiu: n.aiu + e.aiu }), { ms: 0, rejets: 0, usd: 0, aiu: 0 });
console.log(`\nTotal : ${mn(total.ms)}, ${total.rejets} rejet(s), ${runtime === "claude" ? `${total.usd.toFixed(4)} $` : `${total.aiu} AIU`}`);
console.log(`\n${h()} Rapport :\n${rapport.texte.slice(0, 4000)}\n\nRapport complet : ${join(base, "rapport.json")}\nClone : ${projet}`);
await client.close();
