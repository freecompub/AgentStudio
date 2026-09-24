# ADR 0011 — Distribution signée des extensions, profils et modes d'affichage

- Statut : accepté (attribution des profils : **provisoire**, O5 ouvert)
- Date : 2026-09-23
- Jalon : J6 (D5, D6, D13, §5.2, §5.3, §10.3, §11, §12)

## Contexte

J6 exige l'installation d'une extension tierce depuis un fichier, et qu'un profil non développeur
mène une tâche sans aide. La spec impose des paquets signés, une liste de révocation signée, des
permissions présentées en langage clair et des profils que l'utilisateur ne peut pas modifier.

## Décision

1. **Format de paquet** (`.asx`) : archive ZIP contenant `manifest.json`, l'entrée compilée
   (`manifest.main`), les ressources et `META-INF/signature.json`. La signature **Ed25519** porte
   sur l'empreinte canonique de toutes les autres entrées (chemin et SHA-256 triés) : rien ne peut
   être ajouté, retiré ni modifié. La clé est liée à l'éditeur déclaré dans le manifeste.
2. **Lecture défensive** : chemins absolus, `..`, `\` et octets nuls refusés ; nombre d'entrées et
   taille décompressée bornés (bombes ZIP) ; extraction confinée, puis bascule atomique du dossier.
3. **Confiance** : les éditeurs approuvés (identifiant de clé et clé publique) sont fournis par
   l'administrateur. Un paquet non signé n'est accepté qu'en **mode développeur**, avec un
   avertissement permanent.
4. **Installation** (§5.3) : signature vérifiée, manifeste validé (ADR 0009), révocation consultée,
   puis **accord de l'utilisateur** sur ce que l'extension apporte (titres et descriptions de ses
   commandes) et sur ce qu'elle pourra faire (permissions en langage clair). Une mise à jour qui
   élargit les permissions redemande l'accord, avec les ajouts mis en évidence. Un retour à une
   version antérieure est refusé.
5. **Révocation** : liste signée par une clé racine distincte des éditeurs, désignée par
   l'administrateur (fichier ou URL). Elle est appliquée au lancement (extension désactivée avec sa
   raison) puis interrogée toutes les 6 heures, avec effet au lancement suivant. Une liste falsifiée
   est rejetée.
6. **Profils** (D6) : testeur, PO/BA, développeur, architecte, administrateur. Un profil fixe le
   mode d'affichage par défaut, la politique de permissions (prudente : tout demander ; souple :
   commandes de test autorisées) et **qui peut répondre à quelle demande** (`requiredRoles`).
   **Attribution provisoire (O5)** : fichier `admin.json` dans un emplacement système
   (`/etc/agent-studio`, `/Library/Application Support/agent-studio`, `%ProgramData%\agent-studio`,
   ou `$AGENT_STUDIO_ADMIN_CONFIG`), que l'application ne sait pas écrire. Sans fichier (poste
   personnel) : profil développeur. Fichier invalide : profil le plus restreint (testeur).
7. **Modes** (§11) : le mode par défaut vient du profil, et l'utilisateur peut basculer entre simple
   et avancé (ce n'est pas un changement de profil). En mode simple : activité en une phrase,
   décisions résumées, ni diff ligne à ligne ni tableau d'usage.
8. **Actions guidées** : les commandes sont présentées par leur titre et leur description (D5).
   L'utilisateur décrit son besoin en une phrase et le code compose la commande.
9. **Outils éditeurs** : `pnpm ext:keys` (paire de clés) et `pnpm ext:pack` (empaquetage et signature).

## Conséquences

- Les capacités dépréciées (fonctionnelles pendant deux versions mineures, §12) ne sont pas encore
  gérées : aucune n'existe à ce jour.
- Le registre en ligne et les mises à jour automatiques pour les éditeurs fiables (`trustedUpdates`)
  sont préparés dans le modèle mais pas encore exposés.
- « Sans aide » est vérifié par un parcours scripté de l'interface ; un test d'usage avec une vraie
  personne non développeuse reste à mener.
