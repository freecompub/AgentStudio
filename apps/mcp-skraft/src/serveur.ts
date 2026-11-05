/**
 * Serveur MCP skraft (ADR 0068) : des outils courts, aucun appel bloquant. Le serveur orchestre le
 * workflow ; l'hôte démarre, suit, répond. Les réponses sont du texte pour le LLM de l'hôte ;
 * `skraft_etat` rend du JSON.
 */
import { fileURLToPath } from "node:url";
import type { Role } from "@agent-studio/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Connexion } from "./connexion.js";
import type { Mode, ProjetOuvert, Projets } from "./projets.js";
import { resoudreProjet } from "./projet.js";

export interface OptionsServeur {
  projets: Projets;
  /** Nom du workflow lancé par `skraft_demarrer` (`skraft-workflow`). */
  workflow: string;
  /** Profil de l'utilisateur, pour les questions réservées à certains profils (`admin.json`). */
  role: Role;
  /** Dossiers autorisés par la configuration du serveur, en plus des roots du client. */
  autorises: readonly string[];
  cwd: string;
  /** Connexion à GitHub, exigée par les outils qui font travailler les agents (point 7). */
  connexion: Pick<Connexion, "verifier" | "connecter">;
  version?: string;
}

type Resultat = { content: { type: "text"; text: string }[]; isError?: boolean };
const texte = (t: string): Resultat => ({ content: [{ type: "text", text: t }] });
const erreur = (t: string): Resultat => ({ content: [{ type: "text", text: t }], isError: true });

/** Les entrées deviennent une ligne de commande, découpée aux espaces (`lireEntrees`). */
const sansEspace = (quoi: string) => z.string().min(1).regex(/^\S+$/, `${quoi} ne doit pas contenir d'espace : la commande du workflow sépare ses arguments par des espaces.`);

const projet = z.string().optional().describe("Dossier du projet ; par défaut le premier root du client, sinon le dossier courant du serveur.");

export function createServeurSkraft(o: OptionsServeur): McpServer {
  const mcp = new McpServer({ name: "skraft", version: o.version ?? "0.0.0" });

  async function roots(): Promise<string[]> {
    if (!mcp.server.getClientCapabilities()?.roots) return [];
    try {
      const { roots: r } = await mcp.server.listRoots();
      return r.filter((x) => x.uri.startsWith("file:")).map((x) => fileURLToPath(x.uri));
    } catch {
      return [];
    }
  }

  /**
   * Résout et ouvre le projet, puis exécute ; toute exception devient une erreur de l'outil.
   * `agents` : l'outil peut faire travailler les agents, il exige une connexion utilisable par Copilot.
   */
  function outil<A extends { projet?: string | undefined }>(fn: (p: ProjetOuvert, a: A) => Promise<Resultat>, o2: { agents?: boolean } = {}) {
    return async (a: A): Promise<Resultat> => {
      try {
        if (o2.agents) {
          const c = await o.connexion.verifier();
          if (!c.ok) return erreur(c.motif);
        }
        const r = await resoudreProjet({ ...(a.projet !== undefined ? { argument: a.projet } : {}), roots: await roots(), cwd: o.cwd, autorises: o.autorises });
        if (!r.ok) return erreur(r.motif);
        return await fn(await o.projets.ouvrir(r.root), a);
      } catch (e) {
        return erreur(e instanceof Error ? e.message : String(e));
      }
    };
  }

  const enConsultation = (m: Mode, action: string) =>
    m.pilote
      ? null
      : erreur(
          `Ce serveur est en consultation : le projet est piloté par un autre serveur skraft (PID ${m.detenteur}). ${action} depuis celui-ci, ou appelle skraft_reprendre une fois qu'il sera arrêté.`,
        );

  mcp.registerTool(
    "skraft_demarrer",
    {
      description:
        "Démarre skraft sur une user story : recherche, conception, scénarios, TDD, revues. Le run tourne en arrière-plan ; suis-le avec skraft_etat. Au premier lancement, rend l'accord à faire valider par l'utilisateur.",
      inputSchema: {
        story: sansEspace("Le chemin de la story").describe("Fichier de la user story, relatif au projet."),
        auto: z.boolean().optional().describe("Retenir la difficulté proposée sans la faire confirmer."),
        archi: sansEspace("Le nom du skill d'architecture").optional().describe("Skill d'architecture (par son nom ou son langage, ex. java) ; par défaut la clean architecture."),
        accord: z.enum(["une-fois", "toujours"]).optional().describe("Accord de l'utilisateur sur le workflow, après lui avoir montré le résumé rendu par un premier appel."),
        projet,
      },
    },
    outil(async (p, a) => {
      const refus = enConsultation(p.mode(), "Démarre le run");
      if (refus) return refus;
      const w = (await p.services.workflows()).find((x) => x.nom === o.workflow);
      if (!w) return erreur([`Le workflow « ${o.workflow} » n'est pas activé pour ce projet.`, ...p.messages()].join("\n\n"));
      if (!w.accordRetenu && !a.accord)
        return texte(
          [
            "Accord requis : rien n'a démarré.",
            `${w.accord.title}\n\n${w.accord.detail}`,
            'Montre ce résumé à l\'utilisateur. S\'il accepte, rappelle skraft_demarrer avec les mêmes arguments et accord: "une-fois" (ce lancement seulement) ou accord: "toujours" (retenu tant que le workflow ne change pas).',
          ].join("\n\n"),
        );
      const args = [a.story, ...(a.auto ? ["--auto"] : []), ...(a.archi ? ["--archi", a.archi] : [])].join(" ");
      const r = await p.services.lancerWorkflow(w.nom, args, a.accord ? { accord: a.accord } : {});
      if (!r.ok) return erreur(r.motif);
      return texte(`Workflow « ${w.nom} » lancé : tâche ${r.taskId}. Suis-le avec skraft_etat ; ses questions s'y affichent, réponds-y avec skraft_repondre.`);
    }, { agents: true }),
  );

  mcp.registerTool(
    "skraft_etat",
    {
      description: "État des runs du projet (phase, étape, dernier rejet), questions en attente d'une réponse humaine, derniers messages ; en JSON.",
      inputSchema: { projet },
    },
    outil(async (p) => {
      const m = p.mode();
      const taches = (await p.services.tasks()).map((t) => ({
        id: t.id,
        titre: t.title,
        status: t.status,
        phase: t.phase,
        phaseLabel: t.phaseLabel,
        ...(t.step ? { etape: t.step } : {}),
        ...(t.feedback ? { dernierRejet: t.feedback } : {}),
        ...(t.usage ? { usage: t.usage.total } : {}),
      }));
      const questions = (await p.services.pendingInteractions()).map((q) => ({
        id: q.id,
        tache: q.taskId,
        title: q.title,
        ...(q.detail ? { detail: q.detail } : {}),
        options: q.options,
        ...(q.requiredRoles ? { profils: q.requiredRoles } : {}),
        ...(q.freeText ? { texteLibre: true } : {}),
      }));
      return texte(
        JSON.stringify({ projet: p.root, mode: m.pilote ? "pilote" : "consultation", ...(m.pilote ? {} : { detenteur: m.detenteur }), taches, questions, messages: p.messages() }, null, 2),
      );
    }),
  );

  mcp.registerTool(
    "skraft_repondre",
    {
      description: "Répond à une question en attente (ratification d'ADR, escalade, arbitrage, question ouverte), par l'identifiant et l'option donnés par skraft_etat. Pose la question à l'utilisateur ; ne réponds jamais à sa place.",
      inputSchema: {
        question: z.string().min(1),
        option: z.string().min(1),
        texte: z.string().max(4000).optional().describe("Commentaire, ou réponse libre quand la question l'accepte."),
        projet,
      },
    },
    outil(async (p, a) => {
      // Répondre réveille le run, qui s'exécute dans le serveur qui répond : seul le pilote le peut.
      const refus = enConsultation(p.mode(), "Réponds");
      if (refus) return refus;
      await p.services.respond(a.question, a.option, a.texte, { role: o.role });
      return texte("Réponse enregistrée : le run reprend. Suis-le avec skraft_etat.");
    }, { agents: true }),
  );

  mcp.registerTool(
    "skraft_reprendre",
    {
      description: "Prend la main sur le projet si aucun autre serveur skraft ne le pilote, et reprend les runs interrompus (rejeu du journal).",
      inputSchema: { projet },
    },
    outil(async (p) => {
      const m = await p.prendreLaMain();
      return m.pilote ? texte("Ce serveur pilote le projet : les runs interrompus ont repris.") : erreur(`Le projet est piloté par un autre serveur skraft (PID ${m.detenteur}), toujours en vie.`);
    }, { agents: true }),
  );

  mcp.registerTool(
    "skraft_arreter",
    {
      description: "Abandonne un run. Ses questions en attente sont annulées.",
      inputSchema: { tache: z.string().min(1), projet },
    },
    outil(async (p, a) => {
      const refus = enConsultation(p.mode(), "Arrête le run");
      if (refus) return refus;
      await p.services.cancelTask(a.tache);
      return texte(`Run ${a.tache} abandonné.`);
    }),
  );

  mcp.registerTool(
    "skraft_connexion",
    {
      description:
        "Connecte skraft à GitHub (Copilot fait travailler ses agents). Rend un code et une adresse à montrer à l'utilisateur, qui valide dans son navigateur ; rappelle l'outil pour vérifier.",
      inputSchema: {},
    },
    async () => {
      try {
        const r = await o.connexion.connecter();
        return r.ok ? texte(r.texte) : erreur(r.texte);
      } catch (e) {
        return erreur(e instanceof Error ? e.message : String(e));
      }
    },
  );

  return mcp;
}
