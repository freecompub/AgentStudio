/** Lancement de `/skraft-workflow` et lecture de sa valeur de fin, pour les jumeaux des tests de skraft. */
import type { EtatWorkflow } from "@agent-studio/workflow";
import type { assemble } from "./harness.js";
import { until } from "./harness.js";

type App = Awaited<ReturnType<typeof assemble>>;

export interface Bilan {
  niveau: string;
  phases: string[];
  adrs: { id: string; status: string }[];
  regressions: string[];
  livraison: { granularity: string; scenarios: [string, string, string][]; notes: string[] } | null;
}

/** Lance la commande et confirme la difficulté si elle est demandée ; rend l'identifiant de la tâche. */
export async function lancerWorkflow(app: App, story: string, niveau?: string): Promise<string> {
  await app.registry.command("skraft-workflow")!.handler(niveau ? story : `--auto ${story}`);
  await until(async () => (await app.engine.list()).length > 0);
  if (niveau) {
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const q = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith(`:${niveau}`))!.id);
  }
  return (await app.engine.list())[0]!.id;
}

/** Attend la fin de la tâche ; une escalade en attente fait échouer le test avec son motif. */
export async function fin(app: App, id: string, timeoutMs: number): Promise<Bilan> {
  await until(async () => (await app.engine.status(id))?.status === "finished" || (await app.interactions.pending()).some((p) => /bloqué|^Phase /.test(p.title)), timeoutMs);
  const escalade = (await app.interactions.pending()).find((p) => /bloqué|^Phase /.test(p.title));
  if (escalade) throw new Error(`Escalade : ${escalade.title} — ${escalade.detail ?? ""}`);
  const etat = (await app.engine.status(id))!.state as EtatWorkflow;
  const f = etat.fin;
  if (f?.statut !== "fini") throw new Error(`Tâche terminée sans succès : ${JSON.stringify(f)}`);
  // Au-delà de 512 caractères, la valeur est rangée dans le magasin de contenus.
  return ("clair" in f.valeur ? f.valeur.clair : JSON.parse(etat.contenus[f.valeur.ref]!)) as unknown as Bilan;
}
