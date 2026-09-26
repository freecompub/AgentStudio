/**
 * Essai de bout en bout : la **vraie** application Electron, lancée depuis son build.
 *
 * Pourquoi cet essai existe. Le 24/09, la première exécution à l'écran a révélé quatre défauts
 * qu'aucun test n'avait pu attraper — un écran noir causé par un `useEffect` rendant la valeur de
 * `scrollIntoView`, deux courses d'IPC sous `<StrictMode>`, et des réglages jamais persistés parce
 * qu'un schéma zod écartait silencieusement les clés. Les tests de rendu voient le renderer et le
 * contrat IPC ; ils ne voient jamais le câblage entre processus. C'est là que ces quatre défauts
 * vivaient, et c'est ce que cet essai couvre.
 *
 * **Aucune requête à Copilot.** Le mode d'essai remplace le runtime par un double (`mode-essai.ts`),
 * et ce mode est impossible dans une application empaquetée. Seul l'adaptateur change : le
 * processus principal, le préchargement, l'IPC et le renderer sont ceux de production.
 */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";

const exec = promisify(execFile);
const RACINE = join(import.meta.dirname, "../../../..");
const PRINCIPAL = join(RACINE, "apps/desktop/out/main/index.js");

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "essai",
  GIT_AUTHOR_EMAIL: "essai@example.invalid",
  GIT_COMMITTER_NAME: "essai",
  GIT_COMMITTER_EMAIL: "essai@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1",
};

/** Un dépôt Git minimal : l'application refuse d'ouvrir ce qui n'en est pas un. */
async function depotJetable(): Promise<string> {
  const racine = await mkdtemp(join(tmpdir(), "agent-studio-e2e-projet-"));
  await writeFile(join(racine, "README.md"), "# projet d'essai\n");
  await exec("git", ["init", "-q", "-b", "main"], { cwd: racine, env: GIT_ENV });
  await exec("git", ["add", "-A"], { cwd: racine, env: GIT_ENV });
  await exec("git", ["commit", "-q", "-m", "initial"], { cwd: racine, env: GIT_ENV });
  return racine;
}

let app: ElectronApplication;
let projet: string;
let profil: string;
const erreurs: string[] = [];

test.beforeEach(async () => {
  erreurs.length = 0;
  projet = await depotJetable();
  // Profil utilisateur JETABLE. Sans cela, l'essai lirait les réglages réels du développeur —
  // dont `lastWorkspace`, qui ferait ouvrir un projet au hasard — et les écraserait.
  profil = await mkdtemp(join(tmpdir(), "agent-studio-e2e-profil-"));

  app = await electron.launch({
    args: [PRINCIPAL, `--user-data-dir=${profil}`],
    env: {
      ...process.env,
      AGENT_STUDIO_MODE_ESSAI: "1",
      AGENT_STUDIO_ESSAI_PROJET: projet,
      // Le journal du processus principal ne doit pas parasiter la sortie de l'essai.
      AGENT_STUDIO_LOG_LEVEL: "warn",
    },
  });
});

test.afterEach(async () => {
  await app?.close().catch(() => undefined);
  await Promise.all([rm(projet, { recursive: true, force: true }), rm(profil, { recursive: true, force: true })]);
});

test("l'application démarre, affiche son premier écran, et n'écrit aucune erreur en console", async () => {
  const fenetre = await app.firstWindow();
  fenetre.on("console", (m) => {
    if (m.type() === "error") erreurs.push(m.text());
  });
  fenetre.on("pageerror", (e) => erreurs.push(`exception non rattrapée : ${e.message}`));

  // Le mode d'essai feint une session : l'application doit donc aller droit au choix du projet.
  // Un écran noir, une exception au montage ou un IPC muet se voient tous ici.
  await expect(fenetre.getByRole("heading", { name: /Sur quel projet travaille-t-on/ })).toBeVisible({ timeout: 30_000 });

  expect(erreurs, `erreurs de console :\n${erreurs.join("\n")}`).toEqual([]);
});

test("ouvrir un projet mène à la conversation, sans erreur d'IPC", async () => {
  const fenetre = await app.firstWindow();
  fenetre.on("console", (m) => {
    if (m.type() === "error") erreurs.push(m.text());
  });
  fenetre.on("pageerror", (e) => erreurs.push(`exception non rattrapée : ${e.message}`));

  await expect(fenetre.getByRole("heading", { name: /Sur quel projet travaille-t-on/ })).toBeVisible({ timeout: 30_000 });

  // Le sélecteur de dossier du mode d'essai rend le dépôt jetable sans ouvrir de boîte native.
  await fenetre.getByRole("button", { name: "Choisir un dossier" }).click();

  // Des repères PROPRES à la conversation, et STABLES. `getByRole("textbox")` seul ne vaudrait
  // rien : l'écran projet porte déjà deux champs, et l'essai passerait sans l'avoir quitté — c'est
  // exactement ce qui est arrivé à la première version de cet essai. Le titre « Que voulez-vous
  // faire… » ne convient pas non plus : il ne s'affiche que sur une conversation vide.
  await expect(fenetre.getByLabel("Votre message")).toBeVisible({ timeout: 30_000 });
  await expect(fenetre.getByRole("button", { name: "Fermer le projet" })).toBeVisible();

  // Le nom du dépôt jetable dans l'en-tête : la preuve que l'IPC a rendu le VRAI projet ouvert, et
  // non un état par défaut. C'est là que vivaient les courses de `workspace:current` et
  // `chat:start` sous <StrictMode>, le 24/09.
  await expect(fenetre.getByText(basename(projet))).toBeVisible();

  // Le dépôt jetable ne porte ni `Package.swift` ni `package.json` : aucun adaptateur ne le
  // reconnaît, et l'application doit le DIRE dans la conversation. Ce message est posté avant
  // qu'une conversation existe, donc mis en attente puis versé au démarrage — un mécanisme ajouté
  // le 24/09 et jamais vu fonctionner dans la vraie application jusqu'ici.
  await expect(fenetre.getByText(/n'est reconnu par aucun adaptateur/)).toBeVisible();

  expect(erreurs, `erreurs de console :\n${erreurs.join("\n")}`).toEqual([]);
});
