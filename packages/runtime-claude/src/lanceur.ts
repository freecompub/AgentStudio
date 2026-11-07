/** Lanceur réel de `claude -p` (ADR 0070) : processus enfant, sortie lue ligne par ligne. */
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { LanceurClaude } from "./protocols.js";

export function createLanceurClaude(o: { commande?: string } = {}): LanceurClaude {
  const commande = o.commande ?? "claude";
  return {
    version: () =>
      new Promise((resolve, reject) =>
        execFile(commande, ["--version"], { timeout: 15_000 }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim()))),
      ),
    statut: () =>
      new Promise((resolve, reject) =>
        execFile(commande, ["auth", "status"], { timeout: 15_000 }, (err, stdout) => {
          // Non connecté : code de sortie non nul, mais le JSON est bien écrit.
          if (err && !stdout) return reject(err);
          try {
            resolve(JSON.parse(stdout));
          } catch (e) {
            reject(e);
          }
        }),
      ),
    lancer({ args, cwd, entree }) {
      // Mémoire automatique coupée aussi par l'environnement, en plus de `--settings` (essai du 07/11).
      const enfant = spawn(commande, args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } });
      let erreur = "";
      enfant.stderr.setEncoding("utf8").on("data", (c: string) => (erreur = (erreur + c).slice(-4_000)));
      const lignes = createInterface({ input: enfant.stdout });
      const surLigne: ((l: string) => void)[] = [];
      lignes.on("line", (l) => {
        for (const cb of surLigne) cb(l);
      });
      // Sans entrée fermée, `claude -p` attend 3 s avant de partir (essais du 06/11).
      enfant.stdin.end(entree);
      return {
        surLigne: (cb) => void surLigne.push(cb),
        surFin: (cb) => void enfant.on("close", (code) => cb(code, erreur)),
        tuer: () => void enfant.kill("SIGTERM"),
      };
    },
  };
}
