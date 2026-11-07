/**
 * Dossier temporaire propre à chaque lancement de la suite. Tout ce que les tests créent avec
 * `tmpdir()` (projets Git, paquets compilés, tâches, rapports de test) y atterrit, et il est
 * supprimé en entier à la fin. Avant lui, les dossiers laissés (paquets compilés une fois par
 * fichier, écritures tardives d'une tâche après son `rm`) remplissaient /tmp, un tmpfs, jusqu'à
 * faire échouer la suite (15/10).
 *
 * Les processus de test sont lancés après ce module : ils héritent de `TMPDIR`, comme les
 * processus enfants qu'ils démarrent eux-mêmes (Git, extensions isolées, workflows).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function dossierTemporaireDuLancement(): () => void {
  const avant = process.env.TMPDIR;
  const racine = mkdtempSync(join(tmpdir(), "agent-studio-tests-"));
  process.env.TMPDIR = racine;
  return () => {
    rmSync(racine, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    if (avant === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = avant;
  };
}
