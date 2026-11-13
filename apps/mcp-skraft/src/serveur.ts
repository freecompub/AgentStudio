/**
 * Serveur MCP skraft (ADR 0068) : des outils courts, aucun appel bloquant. Le serveur orchestre le
 * workflow ; l'hôte démarre, suit, répond. Les réponses sont du texte pour le LLM de l'hôte ;
 * `skraft_etat` rend du JSON.
 */
import { fileURLToPath } from "node:url";
import { AucunePile } from "@agent-studio/project-services";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { confirmerParLeClient } from "./confirmation.js";
import { consignesPourLeClient } from "./consignes.js";
import type { Connexion } from "./connexion.js";
import type { Depots } from "./depots.js";
import type { Mode, ProjetOuvert, Projets } from "./projets.js";
import { resoudreProjet, type ProjetResolu } from "./projet.js";
import { lireRefIssue, type RefIssue } from "@agent-studio/github-auth";
import { changements, ligneDeProgression, vueDeTache, type Instantane, type VueTache } from "./progression.js";
import { decrireLecon, ecrireLecons, FICHIER_DES_LECONS, lireLecons, listeDesLecons, type StatutDeLecon } from "./lecons.js";

export interface OptionsServeur {
  projets: Projets;
  /** Nom du workflow lancé par `skraft_demarrer` (`skraft-workflow`). */
  workflow: string;
  /** Dossiers autorisés par la configuration du serveur, en plus des roots du client. */
  autorises: readonly string[];
  cwd: string;
  /** PID de ce serveur, donné dans l'état et les refus : il désigne la fenêtre du client. */
  pid?: number;
  /** Connexion à GitHub, exigée par les outils qui font travailler les agents (point 7). */
  connexion: Pick<Connexion, "verifier" | "connecter">;
  /**
   * Prépare une story donnée par une issue GitHub (ADR 0078) : la lit avec ses dépendances, refuse si
   * elle est bloquée, écrit la story et son contexte dans le projet. Absente, une issue est refusée.
   */
  preparerUs?: (texte: string, root: string) => Promise<{ ok: true; chemin: string; notes: string[] } | { ok: false; motif: string }>;
  /** Pousse la branche d'un run fini et ouvre sa PR liée à l'issue (ADR 0078), l'accord de l'utilisateur obtenu. */
  publierPr?: (o: { root: string; ref: RefIssue; branche: string; bilan: string }) => Promise<{ ok: true; url: string; nouvelle: boolean } | { ok: false; motif: string }>;
  /** Dépôts acceptés « toujours » par l'utilisateur (ADR 0075) ; sans, « toujours » vaut pour ce serveur. */
  depots?: Depots;
  version?: string;
}

type Resultat = { content: { type: "text"; text: string }[]; isError?: boolean };
const texte = (t: string): Resultat => ({ content: [{ type: "text", text: t }] });
const erreur = (t: string): Resultat => ({ content: [{ type: "text", text: t }], isError: true });

/** Les entrées deviennent une ligne de commande, découpée aux espaces (`lireEntrees`). */
const sansEspace = (quoi: string) => z.string().min(1).regex(/^\S+$/, `${quoi} ne doit pas contenir d'espace : la commande du workflow sépare ses arguments par des espaces.`);

const projet = z.string().optional().describe("Dossier du projet ; par défaut le premier root du client, sinon le dossier courant du serveur.");

export function createServeurSkraft(o: OptionsServeur): McpServer {
  const pid = o.pid ?? process.pid;
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

  const confirmer = confirmerParLeClient(mcp.server);
  /** Dépôts acceptés pour ce serveur ; une question en cours par dépôt, pour ne pas la poser deux fois. */
  const acceptes = new Set<string>();
  const enQuestion = new Map<string, Promise<boolean>>();

  /**
   * Dépôt hors des dossiers permis (ADR 0075) : si le client sait poser une question, on la pose à
   * l'utilisateur ; c'est lui qui répond, pas le LLM de l'hôte. Sinon, le refus explique quoi faire.
   */
  async function resoudre(argument: string | undefined): Promise<ProjetResolu> {
    const autorises = [...o.autorises, ...acceptes, ...((await o.depots?.liste()) ?? [])];
    const r = await resoudreProjet({ ...(argument !== undefined ? { argument } : {}), roots: await roots(), cwd: o.cwd, autorises });
    if (r.ok || !r.horsBornes || !r.root || !confirmer.peutDemander()) return r;
    const root = r.root;
    let question = enQuestion.get(root);
    if (!question) {
      question = (async () => {
        const reponse = await confirmer.confirm({
          title: "Ouvrir ce dépôt avec skraft ?",
          detail:
            `${root} n'est ni dans un dossier ouvert par le client, ni dans les dossiers autorisés par la configuration du serveur (« autorises »). ` +
            "skraft y travaillera sur une branche, avec des checkpoints Git : ses agents y écriront, et les tests du projet y seront lancés. " +
            "« Oui, toujours » le retient pour les prochaines sessions.",
        });
        if (reponse === "deny") return false;
        if (reponse === "allow-always") await o.depots?.ajouter(root);
        acceptes.add(root);
        return true;
      })().finally(() => enQuestion.delete(root));
      enQuestion.set(root, question);
    }
    return (await question) ? { ok: true, root } : { ok: false, motif: `Projet refusé : l'accord demandé pour ${root} n'a pas été donné (refusé, ou personne pour répondre : un client non interactif refuse de lui-même). Rien n'a été ouvert.` };
  }

  /**
   * Résout et ouvre le projet, puis exécute ; toute exception devient une erreur de l'outil.
   * `agents` : l'outil peut faire travailler les agents, il exige une connexion utilisable par Copilot.
   */
  function outil<A extends { projet?: string | undefined; pile?: string | undefined }>(fn: (p: ProjetOuvert, a: A) => Promise<Resultat>, o2: { agents?: boolean } = {}) {
    return async (a: A): Promise<Resultat> => {
      try {
        if (o2.agents) {
          const c = await o.connexion.verifier();
          if (!c.ok) return erreur(c.motif);
        }
        const r = await resoudre(a.projet);
        if (!r.ok) return erreur(r.motif);
        // Un client qui ne sait pas demander n'a personne à qui poser la question : la liste seule.
        return await fn(await o.projets.ouvrir(r.root, { ...(a.pile !== undefined ? { pile: a.pile } : {}), ...(confirmer.peutDemander() ? { confirmerProgrammes: confirmer } : {}) }), a);
      } catch (e) {
        if (e instanceof AucunePile) return erreur(`${e.message} Donne-la dans l'argument « pile » de skraft_demarrer (YAML, même format).`);
        return erreur(e instanceof Error ? e.message : String(e));
      }
    };
  }

  const enConsultation = (m: Mode, action: string) =>
    m.pilote
      ? null
      : erreur(
          `Ce serveur (PID ${pid}) est en consultation : le projet est piloté par le serveur skraft PID ${m.detenteur}. ${action} depuis la fenêtre de celui-ci, ou appelle skraft_reprendre une fois qu'il sera arrêté.`,
        );

  mcp.registerTool(
    "skraft_demarrer",
    {
      description:
        "Démarre skraft sur une user story : recherche, conception, scénarios, TDD, revues. Le run tourne en arrière-plan ; suis-le avec skraft_etat. Au premier lancement, rend l'accord à faire valider par l'utilisateur.",
      inputSchema: {
        story: sansEspace("Le chemin de la story").describe("Fichier de la user story, relatif au projet ; ou une issue GitHub (URL d'issue, ou org/dépôt#n), lue avec ses commentaires et ses dépendances (ADR 0078)."),
        auto: z.boolean().optional().describe("Retenir la difficulté proposée sans la faire confirmer."),
        archi: sansEspace("Le nom du skill d'architecture").optional().describe("Skill d'architecture (par son nom ou son langage, ex. java) ; par défaut la clean architecture."),
        pile: z
          .string()
          .max(20_000)
          .optional()
          .describe("Profil de pile en YAML, au format de la section pile de .agent-studio/projet.yaml (ADR 0071), ou une section `composants:` pour un dépôt qui mélange les technologies (ADR 0074), si le projet n'en a pas et qu'aucun adaptateur ne le reconnaît. Ses programmes doivent être autorisés par l'administrateur."),
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
      // Une issue GitHub (ADR 0078) : préparée seulement maintenant, l'accord donné, pour ne pas la lire deux fois.
      let story = a.story;
      const notes: string[] = [];
      if (lireRefIssue(a.story)) {
        if (!o.preparerUs) return erreur("Une issue GitHub ne peut pas servir de story ici : donne le chemin d'un fichier de story.");
        const prep = await o.preparerUs(a.story, p.root);
        if (!prep.ok) return erreur(prep.motif);
        story = prep.chemin;
        notes.push(...prep.notes);
      }
      const args = [story, ...(a.auto ? ["--auto"] : []), ...(a.archi ? ["--archi", a.archi] : [])].join(" ");
      const r = await p.services.lancerWorkflow(w.nom, args, a.accord ? { accord: a.accord } : {});
      if (!r.ok) return erreur(r.motif);
      storyDe.set(r.taskId, a.story);
      const pile = p.services.pile();
      const ignoree = a.pile !== undefined && pile.source !== "client" ? ` La pile fournie est ignorée : le projet a la sienne (${pile.id}, ${pile.source === "projet" ? "profil du projet" : "détection"}).` : "";
      return texte(`${notes.map((n) => `${n}\n`).join("")}Workflow « ${w.nom} » lancé : tâche ${r.taskId}. Suis-le avec skraft_etat ; ses questions s'y affichent, réponds-y avec skraft_repondre.${ignoree}`);
    }, { agents: true }),
  );

  /** Story de chaque run lancé par ce serveur : la carte d'une tâche de workflow ne porte que son nom. */
  const storyDe = new Map<string, string>();

  /** Dernier état rendu à l'hôte par `skraft_attendre`, par projet et par run suivi. */
  const vusParLHote = new Map<string, Instantane>();

  /** Une question en attente, telle que l'hôte doit la montrer et y répondre (`skraft_repondre`). */
  const questionPourHote = (q: Awaited<ReturnType<ProjetOuvert["services"]["pendingInteractions"]>>[number]) => ({
    id: q.id,
    tache: q.taskId,
    title: q.title,
    ...(q.detail ? { detail: q.detail } : {}),
    options: q.options,
    ...(q.freeText ? { texteLibre: true } : {}),
  });

  /** L'état du projet en instantané, et la ligne de progression de chaque run (09/11). */
  async function lireInstantane(p: ProjetOuvert): Promise<{ inst: Instantane; progression: Map<string, string>; questions: ReturnType<typeof questionPourHote>[] }> {
    const cartes = await p.services.tasks();
    const attente = await p.services.pendingInteractions();
    const taches: VueTache[] = [];
    const progression = new Map<string, string>();
    for (const carte of cartes) {
      // Rejets, essai, durée et coût lus dans la trace du run (`etapesDuRun`, comme skraft_rapport).
      const etapes = await p.services.etapesDuRun(carte.id).catch(() => []);
      const { vue, dureeMs, coutUsd } = vueDeTache(carte, etapes, storyDe.get(carte.id));
      taches.push(vue);
      progression.set(vue.id, ligneDeProgression(vue, { questions: attente.filter((q) => q.taskId === vue.id).length, ...(dureeMs !== undefined ? { dureeMs } : {}), coutUsd }));
    }
    const inst: Instantane = {
      taches,
      questions: attente.map((q) => ({ id: q.id, tache: q.taskId, title: q.title, ...(q.detail ? { detail: q.detail } : {}) })),
      messages: p.messages(),
    };
    return { inst, progression, questions: attente.map(questionPourHote) };
  }

  mcp.registerTool(
    "skraft_attendre",
    {
      description:
        "Attend qu'il se passe quelque chose dans un run (phase, étape, rejet, question à poser, réponse, message, fin), au plus `delai` secondes (30 par défaut, 50 au plus), puis rend ce qui a changé depuis le dernier appel et la ligne de progression, en JSON. " +
        "Rapporte chaque changement à l'utilisateur, en reprenant la ligne de progression ; montre-lui toute question et réponds avec skraft_repondre selon son choix ; rappelle cet outil tant que `termine` est faux.",
      inputSchema: {
        tache: z.string().min(1).optional().describe("Le run à suivre ; par défaut, tous les runs du projet."),
        // Le SDK MCP abandonne un appel au bout de 60 s par défaut (run du 09/11) : l'attente reste en deçà.
        delai: z.number().int().min(1).max(50).optional().describe("Attente maximale, en secondes (30 par défaut, 50 au plus : un client abandonne souvent un appel au-delà de 60 s)."),
        projet,
      },
    },
    outil(async (p, a) => {
      const termine = (i: Instantane) => {
        const suivis = i.taches.filter((t) => a.tache === undefined || t.id === a.tache);
        return suivis.length > 0 && suivis.every((t) => t.status === "finished");
      };
      const rendre = (l: Awaited<ReturnType<typeof lireInstantane>>, ch: string[]) =>
        texte(
          JSON.stringify(
            {
              changements: ch,
              progression: l.inst.taches.filter((t) => a.tache === undefined || t.id === a.tache).map((t) => l.progression.get(t.id)!),
              questions: l.questions.filter((q) => a.tache === undefined || q.tache === a.tache),
              termine: termine(l.inst),
            },
            null,
            2,
          ),
        );
      // Comparé au dernier état rendu à l'hôte, pas à celui de l'appel : ce qui s'est passé entre deux
      // appels (une réponse, la fin du run) n'est pas perdu.
      const cle = `${p.root}|${a.tache ?? "*"}`;
      const rendu = (l: Awaited<ReturnType<typeof lireInstantane>>, ch: string[]) => (vusParLHote.set(cle, l.inst), rendre(l, ch));
      const actuel = await lireInstantane(p);
      const reference = vusParLHote.get(cle) ?? actuel.inst;
      const deja = changements(reference, actuel.inst, a.tache);
      if (deja.length) return rendu(actuel, deja);
      // Rien ne bougera plus : réponse immédiate, l'hôte n'a pas à attendre le délai.
      if (termine(actuel.inst)) return rendu(actuel, ["Le run est terminé : skraft_rapport donne son bilan."]);
      const echeance = Date.now() + (a.delai ?? 30) * 1000;
      for (;;) {
        await new Promise((r) => setTimeout(r, Math.min(500, Math.max(0, echeance - Date.now()))));
        const maintenant = await lireInstantane(p);
        const ch = changements(reference, maintenant.inst, a.tache);
        if (ch.length || Date.now() >= echeance) return rendu(maintenant, ch.length ? ch : ["Rien de nouveau."]);
      }
    }),
  );

  mcp.registerTool(
    "skraft_etat",
    {
      description: "État du projet : mode du serveur (pilote ou consultation), workflow et son accord, pile retenue, runs (phase, étape, dernier rejet), questions en attente d'une réponse humaine, derniers messages ; en JSON.",
      inputSchema: { projet },
    },
    outil(async (p) => {
      const m = p.mode();
      const w = (await p.services.workflows()).find((x) => x.nom === o.workflow);
      const { progression } = await lireInstantane(p);
      const taches = (await p.services.tasks()).map((t) => ({
        // La ligne à montrer telle quelle à l'utilisateur (09/11).
        progression: progression.get(t.id) ?? "",
        id: t.id,
        titre: t.title,
        status: t.status,
        phase: t.phase,
        phaseLabel: t.phaseLabel,
        ...(t.step ? { etape: t.step } : {}),
        ...(t.feedback ? { dernierRejet: t.feedback } : {}),
        ...(t.usage ? { usage: t.usage.total } : {}),
      }));
      const questions = (await p.services.pendingInteractions()).map(questionPourHote);
      return texte(
        JSON.stringify({ projet: p.root, mode: m.pilote ? "pilote" : "consultation", pid, ...(m.pilote ? {} : { detenteur: m.detenteur }), workflow: w ? { nom: w.nom, accordRetenu: w.accordRetenu } : null, pile: p.services.pile(), taches, questions, messages: p.messages() }, null, 2),
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
      await p.services.respond(a.question, a.option, a.texte);
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
    "skraft_rapport",
    {
      description: "Rapport d'un run, en JSON : statut (en-cours, fini, echec, annule), valeur rendue ou motif, messages du run (dont le bilan final), dernier rejet d'une porte, arbitrages, et étapes (une par phase et par rejeu : début, fin, durée, tours, rejets, unités facturées).",
      inputSchema: { tache: z.string().min(1), projet },
    },
    outil(async (p, a) => {
      const r = await p.services.rapportWorkflow(a.tache);
      if (!r) return erreur(`Run inconnu dans ce projet : ${a.tache}.`);
      // Une étape par phase et par rejeu (ADR 0032) ; `aiu` : unités facturées, lues dans la trace.
      const etapes = (await p.services.etapesDuRun(a.tache)).map((e) => ({
        phase: e.phase,
        essai: e.essai,
        debut: e.début,
        fin: e.fin,
        dureeMs: e.duréeMs,
        tours: e.tours,
        rejets: e.rejets,
        aiu: Math.round(e.nanoAiu / 1e8) / 10,
        // Runtime Claude (ADR 0070) : coût en dollars ; 0 avec Copilot.
        coutUsd: Math.round(e.coûtUsd * 10_000) / 10_000,
        modeles: e.modèles,
      }));
      return texte(JSON.stringify({ ...r, etapes }, null, 2));
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

  /**
   * La PR d'un run fini dont la story vient d'une issue (ADR 0078) : la branche du run est poussée et
   * une PR liée à l'issue est ouverte. C'est une publication : l'utilisateur l'accepte par le client,
   * à chaque fois ; sans question possible, rien n'est publié.
   */
  mcp.registerTool(
    "skraft_pr",
    {
      description:
        "Publie le travail d'un run fini : pousse sa branche skraft/<slug> et ouvre une PR liée à l'issue de la story (« Closes #n »), après l'accord de l'utilisateur, que le client lui demande. Pour un run dont la story n'était pas une issue, donne l'issue dans `issue`.",
      inputSchema: {
        tache: z.string().min(1),
        issue: sansEspace("L'issue").optional().describe("L'issue à lier (URL ou org/dépôt#n), si la story du run n'en était pas une."),
        projet,
      },
    },
    outil(async (p, a) => {
      const rapport = await p.services.rapportWorkflow(a.tache);
      if (!rapport) return erreur(`Run inconnu dans ce projet : ${a.tache}.`);
      if (rapport.statut !== "fini") return erreur(`Le run ${a.tache} n'est pas fini (${rapport.statut}) : rien à publier.`);
      const ref = lireRefIssue(a.issue ?? storyDe.get(a.tache) ?? "");
      if (!ref) return erreur("La story de ce run n'était pas une issue GitHub : donne l'issue à lier dans `issue` (URL ou org/dépôt#n).");
      if (!o.publierPr) return erreur("La publication de PR n'est pas disponible sur ce serveur.");
      const slug = (rapport.valeur as { slug?: unknown } | undefined)?.slug;
      if (typeof slug !== "string") return erreur("Le run ne dit pas sa branche (pas de slug dans son rapport) : rien n'est publié.");
      const branche = `skraft/${slug}`;
      const nom = `${ref.owner}/${ref.repo}#${ref.numero}`;
      if (!confirmer.peutDemander())
        return erreur(
          `Publier la PR demande ton accord, et ce client ne sait pas le demander : rien n'a été publié. Pour la publier toi-même : \`git push -u origin ${branche}\`, puis \`gh pr create --head ${branche}\` avec « Closes #${ref.numero} » dans la description.`,
        );
      const reponse = await confirmer.confirm({
        title: `Publier la PR de ${nom} ?`,
        detail: `skraft va pousser la branche ${branche} et ouvrir une PR sur ${ref.owner}/${ref.repo}, liée à l'issue (Closes #${ref.numero}). C'est une publication sur GitHub.`,
      });
      if (reponse === "deny") return erreur("Rien n'a été publié : l'accord n'a pas été donné.");
      const bilan = rapport.messages.filter((m) => /bilan/i.test(m)).at(-1) ?? rapport.messages.at(-1) ?? "";
      const r = await o.publierPr({ root: p.root, ref, branche, bilan });
      if (!r.ok) return erreur(r.motif);
      return texte(r.nouvelle ? `PR ouverte : ${r.url}. La branche ${branche} est poussée.` : `Une PR était déjà ouverte pour ${branche} : ${r.url}. La branche est poussée à jour.`);
    }, { agents: false }),
  );

  /**
   * Les leçons du projet (LEC-2, critères 11 à 14). Ratifier ou retirer est demandé à l'utilisateur par
   * le client, jamais décidé par un argument : l'action dit seulement quoi lui proposer. Ouvert à
   * tous : aucune action n'est réservée à un profil (ADR 0087).
   */
  mcp.registerTool(
    "skraft_lecons",
    {
      description:
        "Liste les leçons tirées des erreurs répétées du projet, par statut (candidate, validee, retiree), avec leurs sources et leur entrée de catalogue. Avec `action` et `lecon`, propose à l'utilisateur de ratifier une leçon qui ajoute une entrée de catalogue, ou de retirer une leçon : c'est lui qui décide, par la question que le client lui pose.",
      inputSchema: {
        statut: z.enum(["candidate", "validee", "retiree"]).optional().describe("Ne lister que les leçons de ce statut."),
        action: z.enum(["ratifier", "retirer"]).optional().describe("Ce qu'il faut proposer à l'utilisateur, pour la leçon `lecon`."),
        lecon: z.string().min(1).optional().describe("Identifiant de la leçon (ex. L-03), avec `action`."),
        projet,
      },
    },
    async (a) => {
      try {
        const r = await resoudre(a.projet);
        if (!r.ok) return erreur(r.motif);
        const lecons = await lireLecons(r.root);
        const liste = listeDesLecons(lecons, a.statut as StatutDeLecon | undefined);
        if (!a.action) return texte(liste);
        if (!a.lecon) return erreur(`Dis quelle leçon ${a.action} dans \`lecon\` (ex. L-03).\n\n${liste}`);
        const l = lecons.find((x) => x.id === a.lecon);
        if (!l) return erreur(`Leçon inconnue dans ce projet : ${a.lecon}.\n\n${liste}`);
        if (a.action === "ratifier" && !("nouvelle" in l.catalogue)) return erreur(`${l.id} se rattache à une section existante de catalogue : elle n'a rien à ratifier. Rien n'a changé.`);
        if (a.action === "ratifier" && l.ratifiee) return texte(`${l.id} est déjà ratifiée.`);
        if (a.action === "retirer" && l.statut === "retiree") return texte(`${l.id} est déjà retirée.`);
        if (!confirmer.peutDemander())
          return erreur(`Ce client ne sait pas poser de question à l'utilisateur : rien n'est ratifié ni retiré. Voici les leçons :\n\n${liste}`);
        const reponse = await confirmer.confirm({
          title: `${a.action === "ratifier" ? "Ratifier" : "Retirer"} la leçon ${l.id} ?`,
          detail: `${decrireLecon(l)}\n\n${a.action === "ratifier" ? "Ratifiée, la nouvelle entrée de catalogue est acceptée : la leçon sera validée dès que ses erreurs couvriront deux stories." : "Retirée, la leçon n'est plus donnée aux agents, même si l'erreur revient."}`,
        });
        if (reponse === "deny") return erreur(`Rien n'a changé : l'accord n'a pas été donné pour ${l.id}.`);
        await ecrireLecons(r.root, lecons.map((x) => (x.id !== l.id ? x : a.action === "ratifier" ? { ...x, ratifiee: true } : { ...x, statut: "retiree" as const })));
        return texte(`${l.id} ${a.action === "ratifier" ? "ratifiée" : "retirée"}, dans ${FICHIER_DES_LECONS}. Le fichier est à commiter avec le reste du projet ; le prochain run en tiendra compte.`);
      } catch (e) {
        return erreur(e instanceof Error ? e.message : String(e));
      }
    },
  );

  /**
   * La pile du projet (ADR 0075) : `/stack init` et `/stack doctor`, tels quels. L'écriture du profil
   * se fait après la question posée par le client à l'utilisateur ; sans elle, la proposition est
   * rendue et rien n'est écrit. Le projet est ensuite relu.
   */
  mcp.registerTool(
    "skraft_pile",
    {
      description:
        "Fait découvrir la pile du projet par un agent (comment lancer ses tests, où vivent ses fichiers, son BDD), la vérifie en l'exécutant, et l'écrit dans .agent-studio/projet.yaml après l'accord de l'utilisateur, que le client lui demande ; ou, avec action « diagnostiquer », vérifie la pile déclarée (programmes trouvés, emplacements, canaris qui lancent vraiment les tests). À appeler quand skraft n'a pas de pile. Montre la réponse à l'utilisateur telle quelle.",
      inputSchema: {
        action: z.enum(["proposer", "diagnostiquer"]).optional().describe("proposer (par défaut) ou diagnostiquer."),
        lanceur: sansEspace("Le lanceur BDD").optional().describe("Lanceur BDD, s'il n'a pas été trouvé (reqnroll, cucumber-js, pytest-bdd…)."),
        features: sansEspace("Le dossier des .feature").optional().describe("Dossier des .feature, s'il n'a pas été trouvé."),
        etapes: sansEspace("Le dossier des étapes").optional().describe("Dossier des définitions d'étapes, s'il n'a pas été trouvé."),
        sansBdd: z.boolean().optional().describe("Le projet ne fait pas de BDD."),
        reponse: z
          .string()
          .min(1)
          .max(2_000)
          .optional()
          .describe("La réponse de l'utilisateur à la question de l'agent de découverte, en une phrase complète : l'agent ne revoit pas sa question."),
        projet,
      },
    },
    async (a) => {
      try {
        const r = await resoudre(a.projet);
        if (!r.ok) return erreur(r.motif);
        const diagnostic = a.action === "diagnostiquer";
        // Proposer fait travailler l'agent de découverte (ADR 0076) : il faut une connexion utilisable.
        if (!diagnostic) {
          const c = await o.connexion.verifier();
          if (!c.ok) return erreur(c.motif);
        }
        return await o.projets.pourLaPile(r.root, confirmer.peutDemander() ? { confirmerProgrammes: confirmer } : {}, async (p) => {
          if (!diagnostic) {
            const refus = enConsultation(p.mode(), "Écris la pile");
            if (refus) return refus;
          }
          const options = [
            ...(a.lanceur ? ["--lanceur", a.lanceur] : []),
            ...(a.features ? ["--features", a.features] : []),
            ...(a.etapes ? ["--etapes", a.etapes] : []),
            ...(a.sansBdd ? ["--sans-bdd"] : []),
            // En dernier : `--reponse` prend toute la fin de la ligne.
            ...(a.reponse ? ["--reponse", a.reponse] : []),
          ];
          const avant = p.messages();
          await p.services.route(diagnostic ? "/stack doctor" : ["/stack init", ...options].join(" "));
          const dits = p.messages().filter((m) => !avant.includes(m));
          // Le projet est relu au prochain appel ; les consignes de `/stack` sont dites dans les termes de l'outil.
          return texte(dits.map(consignesPourLeClient).join("\n\n"));
        });
      } catch (e) {
        return erreur(e instanceof Error ? e.message : String(e));
      }
    },
  );

  return mcp;
}
