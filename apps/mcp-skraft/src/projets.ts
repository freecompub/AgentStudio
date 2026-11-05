/**
 * Projets ouverts par un serveur, un seul jeu de services par projet. Le verrou décide du mode
 * (ADR 0068, point 5) : le serveur qui le tient **pilote** (il reprend les runs interrompus au
 * démarrage, il lance) ; les autres **consultent**.
 */
import type { WorkspaceServices } from "@agent-studio/project-services";
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
  ouvrir(root: string): Promise<ProjetOuvert>;
  fermer(): Promise<void>;
}

export function createProjets(d: {
  ouvrir(root: string, journal: (markdown: string) => void): Promise<WorkspaceServices>;
  verrou(root: string): Promise<Verrou>;
}): Projets {
  const ouverts = new Map<string, Promise<ProjetOuvert & { fermer(): Promise<void> }>>();

  async function ouvrir(root: string) {
    const messages: string[] = [];
    const journal = (m: string) => {
      messages.push(m);
      if (messages.length > MESSAGES_GARDES) messages.shift();
    };
    // Le verrou d'abord : un serveur en consultation ne doit pas reprendre les runs de l'autre.
    let verrou = await d.verrou(root);
    const services = await d.ouvrir(root, journal);
    if (verrou.ok) await services.demarrer?.();
    const mode = (): Mode => (verrou.ok ? { pilote: true } : { pilote: false, detenteur: verrou.pid });
    return {
      root,
      services,
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

  return {
    ouvrir(root) {
      let p = ouverts.get(root);
      if (!p) {
        p = ouvrir(root);
        ouverts.set(root, p);
        // Une ouverture qui échoue n'est pas gardée : l'appel suivant réessaie.
        p.catch(() => ouverts.delete(root));
      }
      return p;
    },
    async fermer() {
      const tous = [...ouverts.values()];
      ouverts.clear();
      for (const p of tous) await (await p.catch(() => null))?.fermer();
    },
  };
}
