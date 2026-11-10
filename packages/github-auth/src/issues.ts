import type { CommandRunner } from "./protocols.js";

/**
 * La user story donnée par une issue GitHub (ADR 0078). Le code vérifie `gh`, puis lit l'issue, ses
 * commentaires et ses dépendances, en lecture seule (`gh api`, jamais de méthode d'écriture). Aucun
 * agent : lire une API est un travail sûr, qui n'a pas besoin d'un LLM.
 */
export interface RefIssue {
  hostname: string;
  owner: string;
  repo: string;
  numero: number;
}

export interface IssueLue {
  numero: number;
  titre: string;
  etat: "open" | "closed";
  url: string;
  corps: string;
  labels: string[];
  /** Le dépôt, quand ce n'est pas celui de l'US (issue citée d'un autre dépôt). */
  depot?: string;
}

export interface Commentaire {
  auteur: string;
  corps: string;
  date: string;
}

export interface UsGithub {
  ref: RefIssue;
  issue: IssueLue;
  commentaires: Commentaire[];
  parent?: IssueLue;
  sousIssues: IssueLue[];
  bloqueePar: IssueLue[];
  bloque: IssueLue[];
  citees: IssueLue[];
  /** Ce qui n'a pas pu être lu, à dire dans le contexte : une API absente n'arrête pas la lecture. */
  lacunes: string[];
}

/** Au-delà, les issues citées ne sont pas lues : on ne descend que d'un niveau, et borné. */
const CITEES_MAX = 10;

const URL_ISSUE = /https?:\/\/([^/\s]+)\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/;

/** `https://<hôte>/<org>/<dépôt>/issues/<n>`, ou `<org>/<dépôt>#<n>` sur l'hôte par défaut. */
export function lireRefIssue(texte: string, hoteParDefaut = "github.com"): RefIssue | null {
  const t = texte.trim();
  const u = new RegExp(`^${URL_ISSUE.source}(?:[/?#].*)?$`).exec(t);
  if (u) return { hostname: u[1]!, owner: u[2]!, repo: u[3]!, numero: Number(u[4]) };
  const c = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(t);
  return c ? { hostname: hoteParDefaut, owner: c[1]!, repo: c[2]!, numero: Number(c[3]) } : null;
}

const cle = (r: RefIssue) => `${r.hostname}/${r.owner}/${r.repo}#${r.numero}`;

/** Les issues citées dans un texte : `#n` du même dépôt, et liens d'issues ; sans l'issue elle-même ni doublon. */
export function refsCitees(texte: string, ref: RefIssue): RefIssue[] {
  const vues = new Set([cle(ref)]);
  const out: { at: number; r: RefIssue }[] = [];
  const ajouter = (at: number, r: RefIssue) => {
    if (vues.has(cle(r))) return;
    vues.add(cle(r));
    out.push({ at, r });
  };
  for (const m of texte.matchAll(new RegExp(URL_ISSUE.source, "g")))
    ajouter(m.index ?? 0, { hostname: m[1]!, owner: m[2]!, repo: m[3]!, numero: Number(m[4]) });
  // `#n` qui n'est ni dans un lien ni collé à un mot (`#issuecomment-1`, `abc#2`).
  for (const m of texte.matchAll(/(?<![\w/&])#(\d+)\b/g)) ajouter(m.index ?? 0, { ...ref, numero: Number(m[1]) });
  return out.sort((a, b) => a.at - b.at).map((x) => x.r);
}

/** Les issues qui bloquent l'US et sont encore ouvertes : tant qu'il y en a, on ne démarre pas. */
export function bloqueursOuverts(us: Pick<UsGithub, "bloqueePar">): IssueLue[] {
  return us.bloqueePar.filter((i) => i.etat === "open");
}

interface IssueApi {
  number: number;
  title: string;
  state: string;
  html_url: string;
  body?: string | null;
  labels?: ({ name?: string } | string)[];
}

function versIssue(i: IssueApi, ref: RefIssue, r: RefIssue = ref): IssueLue {
  return {
    numero: i.number,
    titre: i.title,
    etat: i.state === "closed" ? "closed" : "open",
    url: i.html_url,
    corps: i.body ?? "",
    labels: (i.labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
    ...(r.owner !== ref.owner || r.repo !== ref.repo ? { depot: `${r.owner}/${r.repo}` } : {}),
  };
}

export function createGhIssues(deps: { runner: CommandRunner }) {
  /** Un appel `gh api` en lecture ; `null` sur un 404, une erreur sinon. */
  async function api<T>(hostname: string, route: string): Promise<{ ok: true; valeur: T } | { ok: false; introuvable: boolean; motif: string }> {
    const r = await deps.runner.run("gh", ["api", "--hostname", hostname, route]);
    if (r.code === 0) return { ok: true, valeur: JSON.parse(r.stdout) as T };
    const motif = (r.stderr || r.stdout).trim();
    return { ok: false, introuvable: /\b404\b|Not Found/.test(motif), motif };
  }

  return {
    /** `gh` installé, connecté à l'hôte de l'issue, dépôt lisible. */
    async verifier(ref: RefIssue): Promise<{ ok: true } | { ok: false; motif: string }> {
      try {
        await deps.runner.run("gh", ["--version"]);
      } catch {
        return { ok: false, motif: "`gh` (GitHub CLI) n'est pas installé : il sert à lire l'issue de la story. Installe-le : https://cli.github.com, puis relance." };
      }
      const auth = await deps.runner.run("gh", ["auth", "status", "--hostname", ref.hostname]);
      if (auth.code !== 0) return { ok: false, motif: `\`gh\` n'est pas connecté à ${ref.hostname}. Connecte-toi : \`gh auth login --hostname ${ref.hostname}\`, puis relance.` };
      const depot = await api(ref.hostname, `repos/${ref.owner}/${ref.repo}`);
      if (!depot.ok) return { ok: false, motif: `Le dépôt ${ref.owner}/${ref.repo} n'est pas lisible sur ${ref.hostname} avec ce compte : ${depot.motif}` };
      return { ok: true };
    },

    /** L'issue, ses commentaires, sa parente, ses sous-issues, ses bloqueurs, ce qu'elle bloque, les issues citées. */
    async lire(ref: RefIssue): Promise<UsGithub> {
      const base = `repos/${ref.owner}/${ref.repo}/issues/${ref.numero}`;
      const lue = await api<IssueApi>(ref.hostname, base);
      if (!lue.ok) throw new Error(`Issue ${ref.owner}/${ref.repo}#${ref.numero} illisible sur ${ref.hostname} : ${lue.motif}`);
      const lacunes: string[] = [];
      const liste = async (route: string, quoi: string): Promise<IssueApi[]> => {
        const r = await api<IssueApi[]>(ref.hostname, `${base}/${route}?per_page=100`);
        if (r.ok) return r.valeur;
        lacunes.push(`${quoi} : non lu (${r.motif})`);
        return [];
      };
      const commentairesApi = await api<{ user?: { login?: string }; body?: string; created_at?: string }[]>(ref.hostname, `${base}/comments?per_page=100`);
      if (!commentairesApi.ok) lacunes.push(`commentaires : non lus (${commentairesApi.motif})`);
      const commentaires = (commentairesApi.ok ? commentairesApi.valeur : []).map((c) => ({ auteur: c.user?.login ?? "?", corps: c.body ?? "", date: c.created_at ?? "" }));
      const parentApi = await api<IssueApi>(ref.hostname, `${base}/parent`);
      // Un 404 sur la parente veut dire « pas de parente » (vérifié sur github.com, 10/11).
      if (!parentApi.ok && !parentApi.introuvable) lacunes.push(`issue parente : non lue (${parentApi.motif})`);
      const sousIssues = (await liste("sub_issues", "sous-issues")).map((i) => versIssue(i, ref));
      const bloqueePar = (await liste("dependencies/blocked_by", "bloquée par")).map((i) => versIssue(i, ref));
      const bloque = (await liste("dependencies/blocking", "bloque")).map((i) => versIssue(i, ref));
      const issue = versIssue(lue.valeur, ref);
      const parent = parentApi.ok ? versIssue(parentApi.valeur, ref) : undefined;

      // Les issues citées, sauf celles déjà lues comme dépendances.
      const dejaLues = new Set([...(parent ? [parent] : []), ...sousIssues, ...bloqueePar, ...bloque].map((i) => cle({ ...ref, numero: i.numero })));
      const refs = refsCitees([issue.corps, ...commentaires.map((c) => c.corps)].join("\n"), ref).filter((r) => !dejaLues.has(cle(r)));
      const citees: IssueLue[] = [];
      for (const r of refs.slice(0, CITEES_MAX)) {
        const c = await api<IssueApi>(r.hostname, `repos/${r.owner}/${r.repo}/issues/${r.numero}`);
        if (c.ok) citees.push(versIssue(c.valeur, ref, r));
        else lacunes.push(`issue citée ${r.owner}/${r.repo}#${r.numero} : non lue (${c.motif})`);
      }
      if (refs.length > CITEES_MAX) lacunes.push(`${refs.length - CITEES_MAX} issues citées non lues (au-delà de ${CITEES_MAX})`);
      return { ref, issue, commentaires, ...(parent ? { parent } : {}), sousIssues, bloqueePar, bloque, citees, lacunes };
    },
  };
}

const etat = (i: IssueLue) => (i.etat === "closed" ? "fermée" : "ouverte");
const ligne = (i: IssueLue) => `- ${i.depot ? `${i.depot}` : ""}#${i.numero} — ${i.titre} (${etat(i)}) : ${i.url}`;
const bloc = (i: IssueLue) => [ligne(i), ...(i.corps.trim() ? ["", i.corps.trim().split("\n").map((l) => `  > ${l}`).join("\n")] : [])].join("\n");

/** Le contexte GitHub de l'US, pour les agents : l'issue, ses commentaires, chaque dépendance avec son état. */
export function rendreContexte(us: UsGithub): string {
  const { ref, issue } = us;
  const sections = [
    `# Contexte GitHub de ${ref.owner}/${ref.repo}#${ref.numero} — ${issue.titre}`,
    `Lu par le code le ${new Date().toISOString().slice(0, 10)}, en lecture seule. Les dépendances sont du contexte, jamais des critères à livrer.`,
    `## L'issue (${etat(issue)}) : ${issue.url}\n\n${issue.corps.trim() || "(vide)"}`,
    `## Commentaires\n\n${us.commentaires.length ? us.commentaires.map((c) => `### ${c.auteur}, ${c.date.slice(0, 10)}\n\n${c.corps.trim()}`).join("\n\n") : "(aucun)"}`,
    ...(us.parent ? [`## Issue parente\n\n${bloc(us.parent)}`] : []),
    ...(us.sousIssues.length ? [`## Sous-issues\n\n${us.sousIssues.map(bloc).join("\n\n")}`] : []),
    ...(us.bloqueePar.length ? [`## Bloquée par\n\n${us.bloqueePar.map(bloc).join("\n\n")}`] : []),
    ...(us.bloque.length ? [`## Bloque\n\n${us.bloque.map(bloc).join("\n\n")}`] : []),
    ...(us.citees.length ? [`## Issues citées\n\n${us.citees.map(bloc).join("\n\n")}`] : []),
    ...(us.lacunes.length ? [`## Non lu\n\n${us.lacunes.map((l) => `- ${l}`).join("\n")}`] : []),
  ];
  return `${sections.join("\n\n")}\n`;
}
