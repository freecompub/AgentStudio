/**
 * Projets ouverts par un serveur, un seul jeu de services par projet. Le verrou décide du mode
 * (ADR 0068, point 5) : le serveur qui le tient **pilote** (il reprend les runs interrompus au
 * démarrage, il lance) ; les autres **consultent**.
 */
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
  ouvrir(root: string, o?: { pile?: string }): Promise<ProjetOuvert>;
  fermer(): Promise<void>;
}

export function createProjets(d: {
  ouvrir(root: string, journal: (markdown: string) => void, pileFournie?: string): Promise<WorkspaceServices>;
  verrou(root: string): Promise<Verrou>;
  piles: Piles;
}): Projets {
  type Ouvert = ProjetOuvert & { pileFournie: string | undefined; fermer(): Promise<void> };
  const ouverts = new Map<string, Promise<Ouvert>>();

  async function ouvrir(root: string, pile: string | undefined): Promise<Ouvert> {
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
      services = await d.ouvrir(root, journal, pileFournie);
    } catch (e) {
      if (verrou.ok) await verrou.liberer();
      throw e;
    }
    if (pile !== undefined && services.pile().source === "client") await d.piles.ecrire(root, pile);
    if (verrou.ok) await services.demarrer?.();
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

  const garder = (root: string, pile: string | undefined) => {
    const p = ouvrir(root, pile);
    ouverts.set(root, p);
    // Une ouverture qui échoue n'est pas gardée : l'appel suivant réessaie.
    p.catch(() => ouverts.delete(root));
    return p;
  };

  return {
    async ouvrir(root, o = {}) {
      const p = ouverts.get(root);
      if (!p) return garder(root, o.pile);
      const x = await p;
      if (o.pile === undefined || x.services.pile().source !== "client" || o.pile === x.pileFournie) return x;
      // Une autre pile fournie : les services sont rouverts avec elle, sauf si un run s'en sert.
      if ((await x.services.tasks()).some((t) => t.status !== "finished"))
        throw new Error(`Une autre pile fournie (« ${x.services.pile().id} ») sert à un run en cours : elle ne change pas avant la fin de ce run.`);
      ouverts.delete(root);
      await x.fermer();
      return garder(root, o.pile);
    },
    async fermer() {
      const tous = [...ouverts.values()];
      ouverts.clear();
      for (const p of tous) await (await p.catch(() => null))?.fermer();
    },
  };
}
