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
    lancer({ args, cwd, entree }) {
      const enfant = spawn(commande, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
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
