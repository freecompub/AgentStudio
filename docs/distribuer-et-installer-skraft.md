# Distribuer et installer l'extension `skraft`

Toutes les commandes de ce document ont été exécutées le 2026-09-28 et leur sortie est reproduite
telle quelle. Les erreurs citées en fin de document sont celles réellement rencontrées, pas des
hypothèses.

## Pourquoi `skraft` n'est pas livrée avec l'application

`tdd` est **compilée dans l'application** : `pnpm dev` et `pnpm build` s'en chargent, via
`pnpm --filter @agent-studio/desktop build:extensions`. Rien à faire.

`skraft` se distribue **à part**, en paquet `.asx` (ADR 0021). Ce n'est pas un choix de confort :
l'extension contient du matériel dérivé de skraft-plugin, sous GPL-3.0-or-later, et c'est le fait
de ne pas la livrer avec l'application qui permet aux deux licences de coexister (ADR 0023). Un
test le défend — `extensions/skraft/test/licence.test.ts` échoue si `ext-skraft` devient une
dépendance de l'application.

**Conséquence pratique : distribuer ce `.asx` oblige à en fournir les sources.**

## 1. Créer ses clés d'éditeur — une seule fois

```bash
pnpm ext:keys ~/.agent-studio/cles-editeur
```

```
Clés créées dans /Users/…/.agent-studio/cles-editeur (identifiant 9a97c442837d84da).
Gardez publisher.key.pem secrète ; transmettez publisher.pub.pem à l'administrateur.
```

Deux fichiers : `publisher.key.pem` (privée, droits `600`) et `publisher.pub.pem` (publique).

**L'emplacement compte.** Ces clés doivent vivre **hors de tout dépôt Git**. Une clé privée
versionnée est une clé compromise, et elle le reste après suppression du fichier — l'historique la
garde.

## 2. Compiler et empaqueter

```bash
pnpm ext:build extensions/skraft /tmp/skraft-build
pnpm ext:pack  /tmp/skraft-build /tmp/skraft.asx ~/.agent-studio/cles-editeur/publisher.key.pem
```

```
Extension compilée : agent-studio.skraft 0.1.0 → /tmp/skraft-build
Paquet signé (clé 9a97c442837d84da) : /tmp/skraft.asx (2 fichiers)
```

Sans le troisième argument, le paquet est **NON signé** — l'outil le dit — et son installation
exigera le mode développeur.

## 3. Déclarer l'éditeur dans `admin.json`

Le fichier d'administration, selon la plateforme :

| Plateforme | Chemin |
| --- | --- |
| macOS | `/Library/Application Support/agent-studio/admin.json` |
| Windows | `%ProgramData%\agent-studio\admin.json` |
| Linux | `/etc/agent-studio/admin.json` |

```json
{
  "trustedPublishers": [
    {
      "publisher": "agent-studio",
      "keyId": "9a97c442837d84da",
      "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----\n",
      "trustedUpdates": false
    }
  ],
  "developerMode": false
}
```

`publisher` doit être le champ `publisher` du **manifeste de l'extension** — ici `agent-studio`.
Une clé valide déclarée sous un autre nom est refusée (voir le dépannage).

`trustedUpdates: false` : les mises à jour de cet éditeur ne s'installent pas toutes seules. Le
passer à `true` est une décision à prendre sciemment.

`developerMode: false` : puisque le paquet est signé, ce mode est inutile. Il autoriserait
l'installation de n'importe quel `.asx` non signé — on n'ouvre pas une porte dont on n'a pas besoin.

### Ce qu'il ne faut PAS mettre par réflexe

**`allowedPrograms`.** Ce champ **remplace** la liste par défaut, il ne s'y ajoute pas — un poste
administré doit pouvoir restreindre, pas seulement élargir. Le mentionner maladroitement interdit
donc tout ce qui n'y figure pas, et une liste vide interdit tout profil de stack.

Sans mention, la liste par défaut s'applique : lanceurs de tests (`dotnet`, `pytest`, `vitest`,
`swift`, `cargo`, `gradle`…), linters et outils de mutation. Ni interpréteur, ni client réseau.
**N'y toucher que pour restreindre.**

## 4. Installer

Rouvrir l'application, puis **Extensions → Installer depuis un fichier**, et choisir le `.asx`.
Un paquet signé par un éditeur déclaré s'installe sans avertissement.

## Dépannage — erreurs réellement rencontrées

### « La clé appartient à l'éditeur « undefined », pas à « agent-studio » »

L'entrée d'éditeur de confiance n'est pas qu'une clé publique : les quatre champs sont
obligatoires, `publisher` compris, et il doit correspondre au manifeste. Une clé parfaitement
valide déclarée sans nom, ou sous un autre nom, est rejetée.

### Le paquet est refusé comme non signé

L'outil l'annonce à l'empaquetage : `Paquet NON signé`. Soit signer (troisième argument de
`ext:pack`), soit activer `developerMode` — la première solution est préférable.

### L'identifiant de clé ne correspond pas

`keyId` se dérive de la clé publique. Recopier une clé sans recopier son identifiant, ou l'inverse,
produit une entrée incohérente. Les deux sortent ensemble de `pnpm ext:keys`.

## Perte ou fuite d'une clé privée

Regénérer une paire, remplacer la clé publique dans `admin.json`, resigner les paquets. **Les
paquets signés avec l'ancienne clé deviennent invalides** — c'est l'effet recherché. Pour une
révocation en bonne et due forme, le champ `revocation` d'`admin.json` accepte un fichier ou une
URL signés par une clé racine.
