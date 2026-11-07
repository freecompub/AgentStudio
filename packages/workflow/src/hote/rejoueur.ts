/**
 * Qui rejoue le script (`docs/09` §6.2) : dans le processus courant (tests, extensions), ou dans un
 * processus enfant isolé (`docs/11` §8). Le moteur, le journal et les effets ne changent pas.
 */
import { dirname } from "node:path";
import { createRpcEndpoint, type ChildHandle, type ProcessLauncher, type RpcEndpoint } from "@agent-studio/extension-host";
import type { DeclarationWorkflow, EntreeJournal, EtatWorkflow, Profil } from "../protocols.js";
import { rejouer } from "../rejeu.js";

export interface Rejoueur {
  /** Relance le script contre le journal de `etat` ; rend l'état complété et les entrées nouvelles. */
  rejouer(etat: EtatWorkflow): Promise<{ etat: EtatWorkflow; nouveaux: EntreeJournal[] }>;
  arreter(): void;
}

export function createRejoueurLocal(decl: DeclarationWorkflow<never>): Rejoueur {
  return {
    async rejouer(etat) {
      const nouveaux = await rejouer(decl, etat);
      return { etat, nouveaux };
    },
    arreter() {},
  };
}

export interface OptionsRejoueurIsole {
  /** Code compilé du dossier (`compilerWorkflow`). */
  code: string;
  launcher: ProcessLauncher;
  /** Bundle de `enfant-entree.ts`. */
  runtimeEntry: string;
  humains?: Record<string, readonly Profil[]>;
  agents?: readonly string[];
  /** Délai d'un rejeu : au-delà, le script est tenu pour bloqué (boucle). Défaut : 30 s. */
  delaiMs?: number;
}

/**
 * Rejoueur isolé : un processus enfant lancé sous `--permission` (lecture de son seul runtime, aucune
 * écriture, aucun sous-processus), relancé à la demande. Un script qui boucle ou fait planter
 * l'enfant termine la tâche en échec, avec le motif ; le processus suivant repart du journal.
 */
export function createRejoueurIsole(o: OptionsRejoueurIsole): Rejoueur {
  const delai = o.delaiMs ?? 30_000;
  let enfant: { handle: ChildHandle; rpc: RpcEndpoint } | null = null;

  const arreter = () => {
    enfant?.rpc.close("workflow arrêté");
    enfant?.handle.kill();
    enfant = null;
  };

  async function demarrer(): Promise<{ handle: ChildHandle; rpc: RpcEndpoint }> {
    const handle = o.launcher.launch({ entry: o.runtimeEntry, readPaths: [dirname(o.runtimeEntry)] });
    const rpc = createRpcEndpoint(handle.channel, {});
    handle.onExit(() => {
      rpc.close("processus du workflow arrêté");
      if (enfant?.handle === handle) enfant = null;
    });
    try {
      await rpc.call("charger", [o.code], { timeoutMs: 15_000 });
    } catch (e) {
      handle.kill();
      throw new ScriptInvalide(e instanceof Error ? e.message : String(e));
    }
    enfant = { handle, rpc };
    return enfant;
  }

  return {
    async rejouer(etat) {
      try {
        const e = enfant ?? (await demarrer());
        const opts = { ...(o.humains ? { humains: o.humains } : {}), ...(o.agents ? { agents: [...o.agents] } : {}) };
        return (await e.rpc.call("rejouer", [etat, opts], { timeoutMs: delai })) as { etat: EtatWorkflow; nouveaux: EntreeJournal[] };
      } catch (err) {
        arreter();
        const message = err instanceof Error ? err.message : String(err);
        const motif =
          err instanceof ScriptInvalide
            ? `Script du workflow invalide : ${message}`
            : /délai de \d+ ms dépassé/.test(message)
              ? `Le script ne rend pas la main (boucle ?) : délai de ${Math.round(delai / 1000)} s dépassé pendant le rejeu.`
              : `Le processus du workflow a échoué : ${message}`;
        return { etat: { ...etat, fin: { statut: "echec", motif } }, nouveaux: [] };
      }
    },
    arreter,
  };
}

class ScriptInvalide extends Error {}
