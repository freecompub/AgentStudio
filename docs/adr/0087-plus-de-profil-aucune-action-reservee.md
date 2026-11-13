# ADR 0087 — Plus de profil : aucune action n'est réservée

## Statut

**Accepté** le 2026-11-13 par le responsable du projet : « on va enlever toutes les restrictions par
profil, dans tout le code », puis « supprimer le profil ». Remplace la décision D6 de `SPEC.md`
(« un utilisateur ne peut pas changer lui-même de profil ») et rend sans objet la question ouverte O5
(attribution des profils).

Concerne le cœur, l'API des extensions, les services de projet, le moteur de workflows, l'extension
skraft, le workflow skraft, le serveur MCP, l'application de bureau et les scripts d'essai.

## Contexte

Un profil (testeur, PO/BA, développeur, architecte, administrateur), attribué dans `admin.json`,
décidait de trois choses :

- qui peut répondre à quelle demande d'interaction (`requiredRoles`, `meta.humains` d'un workflow) :
  la ratification d'un ADR était réservée à l'architecte, l'escalade et les arbitrages au
  développeur, à l'architecte et à l'administrateur ;
- qui peut ratifier ou retirer une leçon dans le serveur MCP : l'architecte et l'administrateur ;
- la politique de permissions par défaut (prudente ou souple) et le mode d'affichage par défaut.

Une équipe sans architecte désigné ne pouvait ratifier aucun ADR, donc DISTILL ne démarrait jamais.
Le mécanisme d'attribution (O5) n'a jamais été tranché.

## Décision

1. **Plus de profil.** Le type `Role`, `Profile`, `profileFor` et `ROLE_LABELS` sont supprimés du cœur.
   L'interface n'affiche plus de rôle.
2. **Aucune demande n'est réservée.** `requiredRoles` disparaît des demandes d'interaction et de l'API
   des extensions ; `respond` ne prend plus d'identité. Une demande enregistrée avant ce changement,
   encore marquée `requiredRoles`, reçoit la réponse de quiconque : le champ est ignoré à la lecture.
3. **`meta.humains` est retiré** du format d'un workflow. Un `meta` qui le garde est refusé avec sa
   raison. Une question n'a plus à être déclarée.
4. **Ratifier ou retirer une leçon** dans le serveur MCP est ouvert à tous ; l'accord reste demandé à
   l'utilisateur par le client.
5. **Les deux réglages restent**, posés par l'administrateur dans `admin.json` : `permissionPolicy`
   (`prudente` ou `souple`) et `defaultMode` (`simple` ou `advanced`). Sans fichier : souple et
   avancé, comme le profil développeur par défaut d'avant. Fichier refusé : prudente et simple.
6. **L'ancienne forme est lue** : un `admin.json` qui pose encore `profile` garde la politique et le
   mode qu'il donnait (un rôle technique donnait souple et avancé, les autres prudente et simple). Un
   poste administré en « prudente » ne passe pas en « souple » parce que le format a changé.

## Conséquences

- N'importe qui peut ratifier un ADR, arbitrer une revue ou répondre à une escalade.
- Le canal IPC `profile:get` devient `admin:get` ; il ne rend plus de rôle.
- Un workflow en dossier écrit pour l'ancien format doit retirer `humains` de son `meta`.
- Le rôle de l'ancienne forme d'`admin.json` ne sert plus qu'à retrouver la politique et le mode.

## Alternatives

- **Garder le profil pour les seules valeurs par défaut.** Proposé, écarté par le responsable : le
  profil disparaît, la politique et le mode deviennent de simples réglages.
- **Passer tout le monde en « souple ».** Écarté : un poste administré en « prudente » changerait de
  politique sans que l'administrateur l'ait décidé.
