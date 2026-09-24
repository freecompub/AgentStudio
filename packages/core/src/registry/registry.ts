import type { TerminalToolName } from "../agents/terminal-tools.js";

export interface CommandContribution {
  extensionId: string;
  name: string;
  /** Titre court et description en langage naturel : obligatoires (D5). */
  title: string;
  description: string;
  handler: (args: string) => Promise<void>;
}

export interface AgentContribution {
  extensionId: string;
  name: string;
  systemPrompt: string;
  writable: string[];
  output: TerminalToolName;
  model?: string;
}

export interface CommandListing {
  /** Ce que l'utilisateur tape après `/` : alias court s'il est unique, sinon nom complet. */
  invocation: string;
  title: string;
  description: string;
  extensionId: string;
}

export interface Registry {
  addCommand(c: CommandContribution): void;
  addAgent(a: AgentContribution): void;
  command(name: string): CommandContribution | undefined;
  agent(name: string): AgentContribution | undefined;
  commands(): CommandListing[];
  removeExtension(extensionId: string): void;
}

const NAME = /^[a-z][a-z0-9-]{0,39}$/;

/** Registre unique des capacités nommées : `<extension>/<nom>`, alias court sans collision (D12). */
export function createRegistry(): Registry {
  const commands = new Map<string, CommandContribution>();
  const agents = new Map<string, AgentContribution>();

  const fullName = (c: { extensionId: string; name: string }) => `${c.extensionId}/${c.name}`;

  function resolve<T extends { extensionId: string; name: string }>(map: Map<string, T>, name: string): T | undefined {
    if (name.includes("/")) return map.get(name);
    const matches = [...map.values()].filter((c) => c.name === name);
    return matches.length === 1 ? matches[0] : undefined;
  }

  function add<T extends { extensionId: string; name: string }>(map: Map<string, T>, c: T, kind: string): void {
    if (!NAME.test(c.name)) throw new Error(`Nom de ${kind} invalide : ${c.name}`);
    if (map.has(fullName(c))) throw new Error(`${kind} déjà enregistrée : ${fullName(c)}`);
    map.set(fullName(c), c);
  }

  return {
    addCommand(c) {
      if (!c.title.trim() || !c.description.trim()) throw new Error(`La commande ${c.name} doit avoir un titre et une description`);
      add(commands, c, "Commande");
    },
    addAgent: (a) => add(agents, a, "Agent"),
    command: (name) => resolve(commands, name),
    agent: (name) => resolve(agents, name),
    commands() {
      return [...commands.values()].map((c) => ({
        invocation: resolve(commands, c.name) ? c.name : fullName(c),
        title: c.title,
        description: c.description,
        extensionId: c.extensionId,
      }));
    },
    removeExtension(extensionId) {
      for (const [k, v] of commands) if (v.extensionId === extensionId) commands.delete(k);
      for (const [k, v] of agents) if (v.extensionId === extensionId) agents.delete(k);
    },
  };
}
