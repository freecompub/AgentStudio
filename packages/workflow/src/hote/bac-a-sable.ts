/**
 * Contexte d'exécution d'un script de workflow (`docs/11` §8). Ce qui rendrait le rejeu faux en est
 * retiré : heure, hasard, minuteries, génération de code. Ce n'est PAS la frontière de sécurité —
 * un objet venu de l'extérieur du contexte mène à son `Function` — : celle-ci est le processus
 * enfant lancé sous le modèle de permissions de Node (`rejoueur.ts`). Ici, on rend le déterminisme
 * impossible à rompre par mégarde, et on le dit clairement quand on essaie.
 */
import vm from "node:vm";
import type { ScriptWorkflow } from "../protocols.js";
import { bibliotheque as bibliothequeParDefaut, type Bibliotheque } from "./bibliotheque.js";

const PREAMBULE = `"use strict";
Object.defineProperty(globalThis, "Date", {
  get() { throw new Error("Date n'est pas disponible dans un workflow : utilise await w.maintenant(), journalisé et identique au rejeu."); },
});
Math.random = function () { throw new Error("Le hasard n'est pas disponible dans un workflow : il rendrait le rejeu faux."); };
`;

export function evaluerScript(code: string, bib: Bibliotheque = bibliothequeParDefaut): { meta: unknown; script: ScriptWorkflow<never> } {
  // `URL` et `URLSearchParams` ne sont pas du langage mais des API de Node et du web : purs et
  // déterministes, ils sont fournis (la porte des citations de skraft vérifie les URL avec).
  const ctx = vm.createContext({ URL, URLSearchParams }, { name: "workflow", codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(PREAMBULE, ctx);
  const module = { exports: {} as Record<string, unknown> };
  const exiger = (nom: string) => {
    if (nom === "@agent-studio/workflow") return bib;
    throw new Error(`import interdit dans un workflow : ${nom}`);
  };
  const fabrique = vm.runInContext(`(function (module, exports, require) {\n${code}\n})`, ctx, { filename: "workflow.mjs", timeout: 5_000 }) as (
    m: typeof module,
    e: Record<string, unknown>,
    r: typeof exiger,
  ) => void;
  fabrique(module, module.exports, exiger);
  const script = module.exports["default"];
  if (typeof script !== "function") throw new Error("le script doit exporter par défaut une fonction `async (w, entree) => …`");
  return { meta: module.exports["meta"], script: script as ScriptWorkflow<never> };
}
