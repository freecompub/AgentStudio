---
name: bdd-step-definitions
description: À charger quand les scénarios Gherkin d'un projet sont exécutés par un lanceur BDD et qu'il faut écrire leurs définitions d'étapes. Couvre la place des étapes entre le scénario et l'application, les pilotes en langage métier, les faux systèmes externes, les données de test par défaut, l'état partagé d'un scénario, un rouge qui prouve quelque chose, et l'attente d'un effet asynchrone. Valable pour tout lanceur et tout langage.
---

<!--
Provenance : écrit pour agent-studio le 2026-11-08 (ADR 0074 §3). Les idées viennent de
S. Freeman et N. Pryce, « Growing Object-Oriented Software, Guided by Tests » (Addison-Wesley,
2009), chapitres 5, 8, 10, 11, 21, 22, 23 et 27 ; elles sont reformulées, aucun passage n'est repris.
-->

# Définitions d'étapes BDD

Le scénario dit **ce que** le système doit faire, dans les mots du métier (`bdd-methodology`).
Les définitions d'étapes le rendent exécutable. Elles sont la couche la plus exposée à deux
dérives : un scénario qui ne vérifie rien, et un code de test si chargé de technique qu'on ne voit
plus ce qu'il vérifie.

**Règle centrale :** une étape traduit une phrase en un appel. Toute la technique est en dessous,
dans des pilotes ; tout le sens est au-dessus, dans le scénario.

## Les trois étages

| Étage | Contient | Ne contient jamais |
|---|---|---|
| **Scénario** | Phrases du métier, valeurs du critère | Termes techniques, détails sans rapport avec le critère |
| **Étapes** | Une phrase reliée à un appel de pilote, paramètres convertis | Logique, conditions, boucles, accès direct à l'infrastructure |
| **Pilotes et données de test** | Comment on entre dans le système, comment on observe son effet, valeurs par défaut | Décisions métier : elles appartiennent au code de production |

Sous les pilotes, c'est l'application, par son point d'entrée : le cas d'usage nommé par les
contrats, ou l'extérieur du système pour le scénario qui le traverse le premier (walking skeleton).

## 1. Écrire d'abord le scénario qu'on voudrait lire

Écris le scénario comme si tout existait déjà, puis les étapes comme si les pilotes existaient
déjà : choisis les appels qui se lisent le mieux. Ensuite seulement, crée le minimum pour que tout
s'exécute. Le texte d'un test ne doit pas se plier à une infrastructure de test existante : c'est
l'infrastructure qu'on construit pour qu'il s'écrive bien.

## 2. Une étape tient en une ligne

```gherkin
Soit une ligne "MUG-01" de 3 articles à 4.50 euros
Quand le client chiffre son panier
Alors la somme des articles est de 13.50 euros
```

```text
étape « une ligne {code} de {quantité} articles à {prix} euros »
    panier.ajoute(uneLigne().deCode(code).deQuantité(quantité).auPrix(prix))

étape « le client chiffre son panier »
    client.chiffre(panier)

étape « la somme des articles est de {montant} euros »
    client.voitUneSommeDe(montant)
```

- `Soit` prépare, `Quand` déclenche **une** action, `Alors` vérifie : pas d'assertion dans `Soit`
  ni dans `Quand`, pas d'action dans `Alors`.
- Une condition ou une boucle dans une étape est un signe : la phrase recouvre deux comportements
  (deux scénarios), ou une règle métier s'est glissée dans le test.
- La même phrase, partout, est la même étape. Un paramètre vaut mieux que deux copies presque
  identiques.

## 3. Les pilotes parlent métier

Un pilote représente un acteur ou un système avec lequel le scénario interagit (le client, le
catalogue, le service de paiement). Il cache tout ce qui est technique : appel du cas d'usage,
requête, interface, sérialisation, attente.

- **Nom des méthodes** : un impératif pour une action (`chiffre`, `annonceLaFermeture`), une
  description pour une vérification (`voitUneSommeDe`, `aReçuUneDemande`). On voit à la lecture
  ce qui agit et ce qui vérifie.
- **Une vérification échoue d'elle-même**, avec son message : l'étape `Alors` n'a pas à
  réinterpréter un booléen.
- Si un changement technique (protocole, format, stockage) oblige à réécrire des scénarios, c'est
  que la technique est remontée au-dessus des pilotes.

## 4. Des faux systèmes externes, minimaux

Un système qu'on ne contrôle pas (un tiers, un service distant) est remplacé par un faux que le
scénario pilote : il reçoit ce que le système lui envoie, que l'étape vérifie, et il renvoie ce
que l'étape lui demande. Il fait le strict nécessaire pour les scénarios, rien de plus.

**On ne double que ses propres types.** Le faux prend la place de l'adaptateur que le projet a
écrit pour ce système, derrière son port, jamais celle d'une bibliothèque tierce : une doublure
de bibliothèque reproduit ce qu'on croit qu'elle fait, pas ce qu'elle fait.

Un faux est une approximation : note ce qui reste à confronter au vrai système.

## 5. Les données : le scénario ne porte que ce qui compte

Construis les objets du métier avec des **builders à valeurs par défaut sûres** : chaque champ a
une valeur valide et sans intérêt, et le scénario ne précise que ce que le critère fixe.

```text
uneLigne()                                -- une ligne valide quelconque
uneLigne().deQuantité(9)                  -- seule la quantité compte ici
unPanier().avec(uneLigne().auPrix(2.00))  -- les builders se composent
```

- Les **valeurs du critère** sont dans le scénario, recopiées telles quelles, et passent sans
  transformation jusqu'au pilote. Une valeur réécrite dans l'étape (arrondie, convertie,
  « simplifiée ») n'est plus celle du critère.
- Les **autres valeurs** sont par défaut dans les builders. Une valeur qui figure dans le scénario
  sans être dans le critère fait croire qu'elle compte.
- Une valeur particulière qui revient (« aucun client trouvé ») porte un nom, défini une fois.

## 6. L'état d'un scénario

Ce que les étapes d'un scénario se transmettent (le panier en cours, le dernier résultat) vit dans
un **contexte de scénario** : un objet neuf pour chaque scénario, fourni aux étapes par le
mécanisme du lanceur. Jamais de variable globale ou statique : un scénario hériterait de l'état du
précédent, et passerait ou échouerait selon l'ordre d'exécution.

## 7. Un rouge qui prouve quelque chose

Avant le code de production, le scénario doit échouer **sur sa vérification métier** :

- les bouchons ne servent qu'à compiler ; un bouchon qui lève « non implémenté » fait échouer le
  test à sa place, et ne prouve rien ;
- une étape sans définition, ou marquée en attente, n'est pas un rouge : le scénario n'a rien
  vérifié. Toutes les étapes ont une définition dès que le scénario existe ;
- **regarde l'échec** : le message dit-il ce qui manque, en termes du critère ? « somme des
  articles attendue 13.50, obtenue 0.00 » se diagnostique ; « attendu vrai, obtenu faux » non.
  Améliore le message avant d'écrire le code : il servira à chaque régression.

Pour des diagnostics clairs : un message qui nomme ce qui est vérifié, des valeurs qui se décrivent
elles-mêmes, et des valeurs de remplissage visiblement factices, pour qu'une valeur par défaut qui
apparaît dans un résultat se remarque.

## 8. L'asynchrone : attendre un effet, jamais une durée

Quand l'effet d'une action arrive plus tard (message, traitement en tâche de fond, interface), la
vérification **attend que l'effet observable se produise**, avec un délai maximal au-delà duquel
elle échoue. Elle réussit dès que l'effet est là.

- Jamais de pause fixe : trop courte, le test échoue par intermittence ; assez longue, la suite
  devient lente, et elle reste fragile.
- Écouter un événement émis par le système est plus rapide et plus sûr qu'interroger son état à
  intervalles.
- Une action sans effet observable ne peut pas être attendue : c'est le système qu'il faut rendre
  observable, pas le test qu'il faut endormir.
- Un test qui échoue par intermittence n'est pas toléré : il cache les vrais défauts.

## 9. Quand une étape résiste

Une étape difficile à écrire (il faut atteindre un état interne, contourner une dépendance cachée,
préparer des dizaines d'objets) dit quelque chose de la conception. Ne force pas : pas d'accès aux
internes, pas de réflexion, pas de nouvelle porte d'entrée créée pour le seul test. Décris la
difficulté et pose la question.

## Liste de contrôle avant de rendre la main

- [ ] Chaque étape du scénario a sa définition ; aucune n'est en attente.
- [ ] Chaque définition tient en un appel de pilote ; aucune logique ni condition.
- [ ] Les pilotes parlent métier ; aucun terme technique au-dessus d'eux.
- [ ] Seuls les types du projet sont doublés.
- [ ] Les valeurs du critère arrivent intactes au pilote ; les autres sont par défaut.
- [ ] L'état passe par un contexte neuf par scénario.
- [ ] Le scénario échoue sur sa vérification métier, avec un message qui nomme la valeur attendue.
- [ ] Aucune pause fixe ; toute attente a un délai maximal et un effet observable.
