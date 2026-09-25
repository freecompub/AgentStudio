# Profils de stack (J5)

Un profil décrit la chaîne d'un projet — commandes, emplacements, format de rapport — pour que
l'application n'ait pas besoin d'un adaptateur écrit en TypeScript pour ce langage.

## S'en servir

Copier le profil qui convient dans `.agent-studio/stack.yaml`, à la racine du projet, puis
l'ajuster. Il est lu à l'ouverture et **l'emporte sur la détection automatique**. S'il est refusé,
la raison est expliquée dans la conversation et la détection reprend la main.

Les programmes nommés doivent figurer dans la liste autorisée par l'administrateur (`admin.json`,
D47/O12). La liste par défaut couvre les lanceurs de tests, linters et outils de mutation
courants ; ni interpréteur, ni client réseau.

## Ce qu'un profil ne sait pas encore exprimer

Ces limites sont réelles : un profil est aujourd'hui **moins capable** qu'un adaptateur écrit à la
main. Elles sont inscrites dans `features.json`.

- **La détection ne regarde que l'existence de fichiers**, jamais leur contenu. L'adaptateur
  TypeScript, lui, vérifie que `vitest` figure dans les dépendances du `package.json` ; le profil
  se rabat sur la présence d'un `vitest.config.ts`, ce qui est plus fragile.
- **L'analyse des imports n'a pas de section.** Avec un profil, `ctx.stack.architecture()` renvoie
  `null` : la règle de dépendance n'est pas vérifiée, et la porte de fin de scénario le dit au
  lieu d'inventer un résultat. L'adaptateur Swift sait le faire, un profil non.
- **La classification des échecs est générique.** Le lecteur `junit-xml` déduit la raison d'un
  rouge — assertion, symbole manquant, autre — de motifs communs à plusieurs langages. Les
  adaptateurs écrits à la main connaissent leur outil et sont plus précis.

Autrement dit, les deux profils ci-contre **ne remplacent pas encore** les adaptateurs Swift et
TypeScript : ils montrent ce qu'un projet tiers peut déclarer aujourd'hui.
