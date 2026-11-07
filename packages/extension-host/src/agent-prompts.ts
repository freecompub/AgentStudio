/**
 * Prompts des agents d'extension (D12, D26, ADR 0024) : le **contenu** vient de fichiers Markdown
 * de l'extension (rôle, skills), partageables avec d'autres harnais ; le **contrat** propre à
 * agent-studio (outil de fin, `run_tests`, pas de Git…) est ajouté ici par le cœur. Fonctions pures,
 * sauf `loadAgentPrompts`, qui lit par la fonction qu'on lui donne.
 */
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ToolSpec } from "@agent-studio/core";
import type { ExtensionManifest, ManifestAgent } from "@agent-studio/extension-api";

export interface MarkdownDoc {
  /** Clés de premier niveau du frontmatter, à valeur sur une ligne (le reste est ignoré). */
  data: Record<string, string>;
  body: string;
}

/** Sépare le frontmatter YAML (`---` … `---`) du corps. Un fichier sans frontmatter est tout corps. */
export function parseMarkdownDoc(md: string): MarkdownDoc {
  const text = md.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { data: {}, body: text.trim() };
  const data: Record<string, string> = {};
  const lines = m[1]!.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]!);
    if (!kv || !kv[2]) continue;
    const block = /^([>|])[-+]?$/.exec(kv[2].trim());
    if (block) {
      // Bloc YAML : lignes indentées qui suivent, repliées (`>`) ou conservées (`|`).
      const parts: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]!) || lines[i + 1]!.trim() === "")) parts.push(lines[++i]!.trim());
      data[kv[1]!] = parts.join(block[1] === ">" ? " " : "\n").trim();
      continue;
    }
    data[kv[1]!] = kv[2].replace(/^(["'])(.*)\1$/, "$2").trim();
  }
  return { data, body: text.slice(m[0].length).trim() };
}

/**
 * Section d'un document Markdown : du titre dont le texte commence par `title` (casse ignorée)
 * jusqu'au prochain titre de même niveau ou plus haut. `null` si aucun titre ne correspond.
 */
export function extractSection(body: string, title: string): string | null {
  const lines = body.split("\n");
  const wanted = title.trim().toLowerCase();
  let inFence = false;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!h) continue;
    const text = h[2]!.replace(/^\d+\.\s*/, "").trim().toLowerCase();
    if (start === -1) {
      if (text.startsWith(wanted) || h[2]!.trim().toLowerCase().startsWith(wanted)) {
        start = i;
        level = h[1]!.length;
      }
    } else if (h[1]!.length <= level) return lines.slice(start, i).join("\n").trim();
  }
  return start === -1 ? null : lines.slice(start).join("\n").trim();
}

export interface SkillSource {
  name: string;
  description: string;
  /** Corps du `SKILL.md`, sans frontmatter. */
  body: string;
}

/** Contenu d'une référence `nom` ou `nom#Titre`. Lève si la skill ou la section est absente. */
export function resolveSkillRef(ref: string, skills: ReadonlyMap<string, SkillSource>): { ref: string; name: string; content: string } {
  const [name, section] = ref.split(/#(.*)/s) as [string, string | undefined];
  const skill = skills.get(name);
  if (!skill) throw new Error(`Skill inconnue : ${name}`);
  if (!section) return { ref, name, content: skill.body };
  const content = extractSection(skill.body, section);
  if (content === null) throw new Error(`Section « ${section} » introuvable dans la skill ${name}`);
  return { ref, name, content };
}

const shorten = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/**
 * Contrat d'exécution dans agent-studio, ajouté en dernier au prompt : il prime sur les consignes du
 * contenu partagé, écrites pour des harnais où l'agent lance lui-même les tests et commite.
 */
export function contractBlock(a: {
  output: string;
  tools: readonly string[];
  /**
   * Périmètre d'écriture du rôle, **nommé** (ADR 0036). C'était un booléen : le contrat disait
   * « tu n'écris que dans ton périmètre » sans dire lequel, et l'agent devait le deviner ou se le
   * faire dire par un refus.
   */
  writes: readonly string[];
  onDemand: readonly { ref: string; description: string }[];
}): string {
  const lines = [
    "## Fonctionnement dans agent-studio",
    "Ces règles priment sur toute consigne contraire du rôle ou des skills ci-dessus.",
    `- Termine ta phase en appelant l'outil \`${a.output}\` : c'est la seule sortie prise en compte.`,
  ];
  if (a.tools.includes("run_tests")) {
    lines.push("- Lance les tests uniquement avec l'outil `run_tests` : son résultat fait foi et il est enregistré comme preuve.");
    // Les skills sont reprises telles quelles (ADR 0024 §6) d'un cadre .NET : elles font lancer
    // `dotnet test`, `dotnet build`, et citent `[Theory]`. Sur un projet TypeScript ces
    // commandes n'existent pas. Proposer `run_tests` ne suffit pas — ça couvre les tests et laisse
    // la compilation à l'agent, avec une commande fausse. Le contrat retire donc la commande.
    lines.push(
      "- N'exécute aucune commande de compilation ou de test toi-même. Celles que citent les skills (`dotnet test`, `dotnet build`…) illustrent d'autres projets et ne valent pas forcément ici : `run_tests` connaît celle de la pile.",
    );
  }
  if (a.tools.includes("run_lint"))
    lines.push(
      "- Pour l'analyse statique, appelle `run_lint` : il lance le linter du projet, avec les règles du projet. S'il répond qu'il n'a rien mesuré, ne te prévaux d'aucune conformité.",
    );
  if (a.tools.includes("report_blocker"))
    lines.push("- S'il te manque une information que tu ne peux pas trouver, appelle `report_blocker` avec ta question et les réponses possibles, au lieu de deviner.");
  if (a.onDemand.length) {
    lines.push("- Skills disponibles à la demande avec l'outil `load_skill` :");
    for (const s of a.onDemand) lines.push(`  - \`${s.ref}\` : ${shorten(s.description, 300)}`);
  }
  if (a.tools.includes("list_files"))
    lines.push("- Pour explorer le projet — voir l'arborescence, trouver des fichiers —, appelle `list_files`, avec un motif si tu veux filtrer.");
  // Dire ce qui MANQUE, et pas seulement ce qui est offert (ADR 0034). Sans cette phrase, l'agent
  // découvre l'absence de shell en s'y cognant : trois refus sur un run réel, dix-huit sur un autre.
  // Un refus est un filet, il ne remplace pas une consigne.
  lines.push(
    `- Tu n'as ni shell, ni accès réseau, ni outil externe : **aucune commande ne peut être lancée**, même en lecture. Tu lis les fichiers du projet avec tes outils de lecture${a.tools.includes("list_files") ? ", et tu l'explores avec `list_files`" : ""}.`,
  );
  lines.push("- N'utilise jamais Git (commit, reset, checkout, stash, rebase, push…) : l'application enregistre et restaure le travail elle-même.");
  // Nommer ce qui est permis ne suffit pas : un agent peut lire « voilà où tu écris » sans en
  // conclure « et nulle part ailleurs, ni modifier, ni supprimer ». Les deux moitiés sont dites.
  lines.push(
    a.writes.length
      ? `- Tu n'écris que dans : ${a.writes.join(", ")}. **Ne modifie et ne supprime aucun autre fichier du projet**, hors de ces chemins : toute autre écriture est refusée.`
      : "- Tu n'écris aucun fichier.",
  );
  return lines.join("\n");
}

export interface ComposedAgent {
  systemPrompt: string;
  /** Skills chargeables par `load_skill`, par référence. */
  onDemand: Map<string, { description: string; content: string }>;
}

/** Prompt système : contenu du rôle, skills injectées, consignes d'orchestration, contrat. */
export function composeAgentPrompt(agent: ManifestAgent, roleBody: string | null, skills: ReadonlyMap<string, SkillSource>): ComposedAgent {
  const mandatory = (agent.skills?.mandatory ?? []).map((r) => resolveSkillRef(r, skills));
  const onDemand = new Map(
    (agent.skills?.onDemand ?? []).map((r) => {
      const s = resolveSkillRef(r, skills);
      return [r, { description: skills.get(s.name)!.description, content: s.content }] as const;
    }),
  );
  const parts: string[] = [];
  if (roleBody) parts.push(roleBody);
  if (mandatory.length) parts.push(["## Skills du rôle", ...mandatory.map((s) => `### Skill ${s.ref}\n\n${s.content}`)].join("\n\n"));
  if (agent.role) parts.push(agent.role.trim());
  parts.push(
    contractBlock({
      output: agent.output,
      tools: agent.tools ?? [],
      writes: agent.write ?? [],
      onDemand: [...onDemand].map(([ref, s]) => ({ ref, description: s.description })),
    }),
  );
  return { systemPrompt: parts.join("\n\n"), onDemand };
}

/**
 * Lecture d'un fichier de l'extension, confinée à son dossier : liens symboliques résolus, rien
 * au-dessus du dossier. Le manifeste interdit déjà `..` ; ceci est le second rempart.
 */
export function extensionFileReader(directory: string): (rel: string) => Promise<string> {
  const root = realpath(directory);
  return async (rel) => {
    const base = await root;
    const real = await realpath(resolve(base, rel)).catch(() => {
      throw new Error(`Fichier de l'extension introuvable : ${rel}`);
    });
    const inside = relative(base, real);
    if (inside.startsWith("..") || isAbsolute(inside)) throw new Error(`Fichier hors du dossier de l'extension : ${rel}`);
    return readFile(real, "utf8");
  };
}

/** Outil `load_skill` (D26) : charge une skill facultative du rôle ; chaque chargement est signalé à `onLoad`. */
export function loadSkillTool(onDemand: ReadonlyMap<string, { description: string; content: string }>, onLoad: (ref: string) => void): ToolSpec {
  const refs = [...onDemand.keys()];
  return {
    name: "load_skill",
    description: "Charge une skill complémentaire de ton rôle (méthode, catalogue, critères) quand tu en as besoin.",
    parameters: { type: "object", properties: { name: { type: "string", enum: refs } }, required: ["name"], additionalProperties: false },
    async handler(args) {
      const ref = (args as { name?: unknown } | null)?.name;
      const skill = typeof ref === "string" ? onDemand.get(ref) : undefined;
      if (!skill) throw new Error(`Skill inconnue pour ce rôle : ${String(ref)}. Disponibles : ${refs.join(", ")}`);
      onLoad(ref as string);
      return skill.content;
    },
  };
}

/** Fichiers et dossiers que le manifeste déclare (rôles, skills) : à livrer avec l'extension. */
export function declaredPaths(manifest: ExtensionManifest): string[] {
  const agents = (manifest.contributes.agents ?? []).flatMap((a) => (a.prompt ? [a.prompt] : []));
  const skills = (manifest.contributes.skills ?? []).map((s) => s.path);
  return [...new Set([...agents, ...skills])];
}

/** Copie les fichiers déclarés du dossier source de l'extension vers son dossier compilé (`ext:build`, tests). */
export async function copyDeclaredFiles(manifest: ExtensionManifest, from: string, to: string): Promise<void> {
  const { cp } = await import("node:fs/promises");
  for (const p of declaredPaths(manifest)) await cp(resolve(from, p), resolve(to, p), { recursive: true, verbatimSymlinks: true, errorOnExist: false });
}

/** Chemin du fichier d'une skill : `SKILL.md` du dossier, ou le fichier `.md` donné. */
export const skillFile = (path: string) => (path.endsWith(".md") ? path : `${path.replace(/\/+$/, "")}/SKILL.md`);

/**
 * Lit les fichiers de rôle et de skills déclarés par le manifeste et compose chaque agent.
 * `read` lit un chemin relatif au dossier de l'extension (confinement à la charge de l'appelant).
 */
export async function loadAgentPrompts(manifest: ExtensionManifest, read: ((rel: string) => Promise<string>) | null): Promise<Map<string, ComposedAgent>> {
  const agents = manifest.contributes.agents ?? [];
  const needsFiles = agents.some((a) => a.prompt || a.skills);
  if (needsFiles && !read) throw new Error(`L'extension ${manifest.id} déclare des fichiers de rôle ou des skills, mais son dossier est inconnu`);
  const skills = new Map<string, SkillSource>();
  for (const s of manifest.contributes.skills ?? []) {
    const doc = parseMarkdownDoc(await read!(skillFile(s.path)));
    skills.set(s.name, { name: s.name, description: doc.data.description ?? s.name, body: doc.body });
  }
  const out = new Map<string, ComposedAgent>();
  for (const a of agents) {
    const body = a.prompt ? parseMarkdownDoc(await read!(a.prompt)).body : null;
    out.set(a.name, composeAgentPrompt(a, body, skills));
  }
  return out;
}
