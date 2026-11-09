/**
 * Projets ouverts par un serveur, un seul jeu de services par projet. Le verrou décide du mode
 * (ADR 0068, point 5) : le serveur qui le tient **pilote** (il reprend les runs interrompus au
 * démarrage, il lance) ; les autres **consultent**.
 */
import type { UserConfirmer } from "@agent-studio/core";
import type { WorkspaceServices } from "@agent-studio/project-services";
import type { Piles } from "./piles.js";
import type { Verrou } from "./verrou.js";

/** Messages gardés pour `skraft_etat` : les derniers seulement. */
const MESSAGES_GARDES = 20;

export type Mode = { pilote: true } | { pilote: false; detenteur: number };

export interface ProjetOuvert {
  root: string;
  services: WorkspaceServices;
  mode(): Mode;
  /** Prend le verrou s'il est libre, puis reprend les runs interrompus. */
  prendreLaMain(): Promise<Mode>;
  messages(): string[];
}

export interface Projets {
  /**
   * `pile` : profil fourni par le client, retenu si le projet n'en a pas d'autre (point 8), puis
   * gardé pour les ouvertures suivantes. Une autre pile remplace la précédente, sauf pendant un run.
   */
  /** `confirmerProgrammes` : à qui demander d'accepter un programme hors de la liste (ADR 0075). */
  ouvrir(root: string, o?: { pile?: string; confirmerProgrammes?: UserConfirmer }): Promise<ProjetOuvert>;
  /**
   * Pour proposer ou diagnostiquer la pile (`skraft_pile`, ADR 0075) : le projet ouvert s'il l'est,
   * sinon ouvert pour ce seul appel, repli permis (sans pile, il n'ouvrirait pas). Ensuite, le projet
   * est refermé, sauf pendant un run : la prochaine ouverture lit le profil peut-être écrit.
   */
  pourLaPile<T>(root: string, o: { confirmerProgrammes?: UserConfirmer }, fn: (p: ProjetOuvert) => Promise<T>): Promise<T>;
  fermer(): Promise<void>;
}

/** Comment ouvrir les services d'un projet. */
export interface OuvertureServices {
  pileFournie?: string;
  confirmerProgrammes?: UserConfirmer;
  repliPermis?: boolean;
}

export function createProjets(d: {
  ouvrir(root: string, journal: (markdown: string) => void, o: OuvertureServices): Promise<WorkspaceServices>;
  verrou(root: string): Promise<Verrou>;
  piles: Piles;
}): Projets {
  type Ouvert = ProjetOuvert & { pileFournie: string | undefined; fermer(): Promise<void> };
  const ouverts = new Map<string, Promise<Ouvert>>();

  /** `pourLaPile` : repli permis, et aucun run repris — ces services ne vivent que le temps d'un appel. */
  async function ouvrir(root: string, pile: string | undefined, confirmerProgrammes: UserConfirmer | undefined, pourLaPile = false): Promise<Ouvert> {
    const messages: string[] = [];
    const journal = (m: string) => {
      messages.push(m);
      if (messages.length > MESSAGES_GARDES) messages.shift();
    };
    // Le verrou d'abord : un serveur en consultation ne doit pas reprendre les runs de l'autre.
    let verrou = await d.verrou(root);
    const pileFournie = pile ?? (await d.piles.lire(root)) ?? undefined;
    let services: WorkspaceServices;
    try {
      services = await d.ouvrir(root, journal, {
        ...(pileFournie !== undefined ? { pileFournie } : {}),
        ...(confirmerProgrammes ? { confirmerProgrammes } : {}),
        ...(pourLaPile ? { repliPermis: true } : {}),
      });
    } catch (e) {
      if (verrou.ok) await verrou.liberer();
      throw e;
    }
    if (pile !== undefined && services.pile().source === "client") await d.piles.ecrire(root, pile);
    if (verrou.ok && !pourLaPile) await services.demarrer?.();
    const mode = (): Mode => (verrou.ok ? { pilote: true } : { pilote: false, detenteur: verrou.pid });
    return {
      root,
      services,
      pileFournie,
      mode,
      messages: () => [...messages],
      async prendreLaMain() {
        if (verrou.ok) return mode();
        verrou = await d.verrou(root);
        if (verrou.ok) await services.demarrer?.();
        return mode();
      },
      async fermer() {
        await services.dispose();
        if (verrou.ok) await verrou.liberer();
      },
    };
  }

  const garder = (root: string, pile: string | undefined, confirmerProgrammes: UserConfirmer | undefined) => {
    const p = ouvrir(root, pile, confirmerProgrammes);
    ouverts.set(root, p);
    // Une ouverture qui échoue n'est pas gardée : l'appel suivant réessaie.
    p.catch(() => ouverts.delete(root));
    return p;
  };

  return {
    async ouvrir(root, o = {}) {
      const p = ouverts.get(root);
      if (!p) return garder(root, o.pile, o.confirmerProgrammes);
      const x = await p;
      if (o.pile === undefined || x.services.pile().source !== "client" || o.pile === x.pileFournie) return x;
      // Une autre pile fournie : les services sont rouverts avec elle, sauf si un run s'en sert.
      if ((await x.services.tasks()).some((t) => t.status !== "finished"))
        throw new Error(`Une autre pile fournie (« ${x.services.pile().id} ») sert à un run en cours : elle ne change pas avant la fin de ce run.`);
      ouverts.delete(root);
      await x.fermer();
      return garder(root, o.pile, o.confirmerProgrammes);
    },
    async pourLaPile(root, o, fn) {
      const deja = await ouverts.get(root)?.catch(() => null);
      if (deja) {
        const r = await fn(deja);
        if (!(await deja.services.tasks()).some((t) => t.status !== "finished") && ouverts.get(root)) {
          ouverts.delete(root);
          await deja.fermer();
        }
        return r;
      }
      const x = await ouvrir(root, undefined, o.confirmerProgrammes, true);
      try {
        return await fn(x);
      } finally {
        await x.fermer();
      }
    },
    async fermer() {
      const tous = [...ouverts.values()];
      ouverts.clear();
      for (const p of tous) await (await p.catch(() => null))?.fermer();
    },
  };
}
