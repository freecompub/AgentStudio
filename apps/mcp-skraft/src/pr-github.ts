/**
 * La PR d'une US GitHub, à la fin du run (ADR 0078) : pousser la branche du run, puis ouvrir une PR
 * liée à l'issue (« Closes #n »), sur la branche par défaut du dépôt. C'est une publication : l'appelant
 * l'a fait accepter par l'utilisateur avant. `git` et `gh` sont injectés ; sans shell.
 */
import type { RefIssue } from "@agent-studio/github-auth";

export type Executer = (cmd: string, args: string[]) => Promise<{ code: number; sortie: string }>;

/** `org/depot` d'un remote, en HTTPS ou en SSH ; `null` s'il n'est pas sur l'hôte attendu. */
function depotDuRemote(url: string, hote: string): { owner: string; repo: string } | null {
  const echappe = hote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^(?:https?://(?:[^@/]+@)?${echappe}/|git@${echappe}:|ssh://git@${echappe}/)([\\w.-]+)/([\\w.-]+?)(?:\\.git)?/?$`).exec(url.trim());
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

export async function publierPr(
  o: {
    root: string;
    branche: string;
    ref: RefIssue;
    titre: string;
    bilan: string;
    /** Le dépôt du projet, si l'issue vit ailleurs (un dépôt de backlog) ; par défaut celui de l'issue. */
    depotDuProjet?: { owner: string; repo: string };
  },
  executer: Executer,
): Promise<{ ok: true; url: string; nouvelle: boolean } | { ok: false; motif: string }> {
  const attendu = o.depotDuProjet ?? { owner: o.ref.owner, repo: o.ref.repo };
  const nomAttendu = `${attendu.owner}/${attendu.repo}`;
  const origin = (await executer("git", ["-C", o.root, "remote", "get-url", "origin"])).sortie.trim();
  const depot = depotDuRemote(origin, o.ref.hostname);
  // Le remote doit être le dépôt attendu : sinon le projet ouvert n'est pas celui de l'US.
  if (!depot || `${depot.owner}/${depot.repo}`.toLowerCase() !== nomAttendu.toLowerCase())
    return { ok: false, motif: `Le remote origin du projet (${origin || "absent"}) n'est pas ${nomAttendu} sur ${o.ref.hostname} : la PR n'est pas ouverte. Vérifie que le projet ouvert est bien celui de l'US.` };

  const push = await executer("git", ["-C", o.root, "push", "-u", "origin", o.branche]);
  if (push.code !== 0) return { ok: false, motif: `git push de ${o.branche} a échoué : ${push.sortie.trim()}` };

  const repo = ["--repo", nomAttendu];
  const existante = (await executer("gh", ["pr", "list", ...repo, "--head", o.branche, "--state", "open", "--json", "url", "--jq", ".[0].url"])).sortie.trim();
  if (existante) return { ok: true, url: existante, nouvelle: false };

  const base = (await executer("gh", ["repo", "view", nomAttendu, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"])).sortie.trim() || "main";
  const meme = o.ref.owner === attendu.owner && o.ref.repo === attendu.repo;
  const lien = meme ? `#${o.ref.numero}` : `${o.ref.owner}/${o.ref.repo}#${o.ref.numero}`;
  const corps = [`Closes ${lien}`, "", "Livré par skraft : recherche, conception avec ADR, scénarios d'acceptance, TDD et revues.", "", o.bilan].join("\n");
  const pr = await executer("gh", ["pr", "create", ...repo, "--base", base, "--head", o.branche, "--title", o.titre, "--body", corps]);
  if (pr.code !== 0) return { ok: false, motif: `gh pr create a échoué : ${pr.sortie.trim()}` };
  return { ok: true, url: pr.sortie.trim().split("\n").at(-1) ?? "", nouvelle: true };
}
