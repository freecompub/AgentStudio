/**
 * Accord de l'utilisateur avant d'exécuter un workflow (ADR 0055, `docs/11` §7). Un workflow de
 * projet est du code du dépôt qui s'exécute ; un workflow de la machine aussi. L'accord se rattache
 * à l'**empreinte du dossier** : modifié, le workflow est redemandé.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { WorkflowTrouve } from "../chargeur/chargeur.js";

export interface AccordStore {
  accorde(nom: string, empreinte: string): Promise<boolean>;
  accorder(nom: string, empreinte: string): Promise<void>;
}

const schema = z.array(z.object({ nom: z.string(), empreinte: z.string() }));

/** Accords retenus (« toujours »), en un fichier JSON, écriture atomique. */
export function createJsonAccordStore(fichier: string): AccordStore {
  const lire = async () => {
    try {
      const r = schema.safeParse(JSON.parse(await readFile(fichier, "utf8")));
      return r.success ? r.data : [];
    } catch {
      return [];
    }
  };
  return {
    async accorde(nom, empreinte) {
      return (await lire()).some((a) => a.nom === nom && a.empreinte === empreinte);
    },
    async accorder(nom, empreinte) {
      const tous = await lire();
      if (tous.some((a) => a.nom === nom && a.empreinte === empreinte)) return;
      await mkdir(dirname(fichier), { recursive: true });
      const tmp = `${fichier}.${randomBytes(4).toString("hex")}.tmp`;
      await writeFile(tmp, JSON.stringify([...tous, { nom, empreinte }], null, 2));
      await rename(tmp, fichier);
    },
  };
}

/** Ce que l'utilisateur doit voir avant d'accepter : d'où vient le workflow, et ce qu'il peut faire. */
export function resumeAccord(w: WorkflowTrouve): { title: string; detail: string } {
  const m = w.meta;
  const lignes = [
    m.description,
    `Dossier : ${w.dossier}`,
    "",
    "Le script peut :",
    `  - Écrire : ${m.permissions.ecriture.length ? m.permissions.ecriture.join(", ") : "rien"}`,
    ...(m.permissions.tests ? ["  - Lancer les tests et le linter du projet"] : []),
    ...(m.permissions.git.length ? [`  - Git : ${m.permissions.git.join(", ")}`] : []),
    "",
    "Agents :",
    ...Object.entries(m.agents).map(
      ([nom, a]) => `  - ${nom} : ${a.ecriture?.length ? `écrit dans ${a.ecriture.join(", ")}` : "lecture seule"}${a.outils?.length ? ` ; outils ${a.outils.join(", ")}` : ""}`,
    ),
    ...(Object.keys(m.humains).length
      ? ["", "Questions et profils qui peuvent y répondre :", ...Object.entries(m.humains).map(([q, p]) => `  - ${q} : ${p.length ? p.join(", ") : "tout profil"}`)]
      : []),
  ];
  return { title: `Exécuter le workflow « ${w.nom} » (${w.origine}) ?`, detail: lignes.join("\n") };
}

/**
 * Accord déjà retenu pour cette empreinte, ou demandé maintenant. « Une fois » autorise cette
 * exécution seulement ; « toujours » retient l'accord pour cette empreinte ; « refuser » : rien ne
 * démarre.
 */
export async function verifierAccord(o: {
  workflow: WorkflowTrouve;
  accords: AccordStore;
  confirmer: { confirm(r: { title: string; detail: string }): Promise<"allow-once" | "allow-always" | "deny"> };
}): Promise<boolean> {
  if (await o.accords.accorde(o.workflow.nom, o.workflow.empreinte)) return true;
  const r = await o.confirmer.confirm(resumeAccord(o.workflow));
  if (r === "deny") return false;
  if (r === "allow-always") await o.accords.accorder(o.workflow.nom, o.workflow.empreinte);
  return true;
}
