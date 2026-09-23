# ADR 0002 — Renderer React, electron-vite et durcissement de la fenêtre

- Statut : accepté (tranche la question ouverte O7)
- Date : 2026-09-23
- Jalon : J1 (§4.1, §10.2, D34)

## Contexte

O7 laisse ouvert le choix du framework du renderer, à consigner dans un ADR au jalon J1. La fenêtre doit
être durcie : `contextIsolation`, `sandbox`, pas de `nodeIntegration`, preload minimal, CSP stricte,
navigation externe interdite.

## Décision

1. **React 19** pour le renderer, construit par **electron-vite 5** (Vite 7) pour le principal, le preload
   et le renderer. Les paquets internes sont intégrés au bundle du principal. Le Copilot SDK reste
   externe, car il doit retrouver son runtime propre à la plateforme dans `node_modules`.
2. **Contrat IPC unique** (`src/shared/ipc-contract.ts`) décrit en Zod : pour chaque canal de requête,
   un schéma d'entrée et un schéma de sortie, plus un schéma par événement. Le routeur du principal
   vérifie l'origine de l'expéditeur, valide l'entrée **et** la sortie (aucun champ imprévu, jeton
   compris, ne peut partir vers la fenêtre), puis réduit les erreurs à leur message.
3. **Preload sans dépendance**, compilé en CommonJS (exigé par le sandbox). Il n'expose que
   `invoke`/`on` sur les canaux listés (`channels.ts`), et un contrôle de types à la compilation
   garantit que ces listes correspondent au contrat.
4. **Durcissement** : `app.enableSandbox()`, instance unique, CSP posée par en-tête (plus stricte en
   production qu'en développement, où Vite a besoin d'un script en ligne et d'une WebSocket), toutes
   les permissions web refusées, `will-navigate` bloqué, `window.open` refusé et liens `https`
   ouverts dans le navigateur système.
5. **Le contrôleur** (`app-controller.ts`) ne dépend que de protocoles (auth, espaces de travail,
   fabrique de runtime, réglages, sélecteur de dossier, ouverture externe, émission d'événements) :
   il est testé sans Electron. `index.ts` ne fait que câbler les implémentations réelles.
6. Les **confirmations de permission** ont un dialogue dédié, visuellement distinct (ambre), réservé à
   l'arbitre du cœur (D34). Sans réponse sous 5 minutes, la demande vaut refus.

## Conséquences

- Les tests du renderer tournent sous jsdom avec une fausse API `window.agentStudio`. Sur cette
  machine, Electron ne se lance pas faute de bibliothèques GTK (`libatk`) : la vérification visuelle
  est à faire sur un poste de bureau.
- Pas de style ni de police externes : la CSP l'interdit. La typographie repose sur des polices système.
