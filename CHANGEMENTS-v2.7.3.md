# Diggers v2.7.3 — on n'achète plus de carte au jeu

**Trois fichiers** : `index.html` à la racine, `jeu.mjs` et `_biblio.mjs`
dans `netlify/functions`.

**627 vérifications automatiques**, toutes vertes (462 côté serveur, 165 dans
un vrai Chromium).

---

## 1. « Presser » est supprimé

C'était le raccourci qui vidait le jeu de son sujet : on pouvait **acheter
directement la carte de son choix**. Plus besoin d'ouvrir de cartons, plus
besoin de parler à personne — il suffisait d'accumuler des crédits et de
commander sa collection sur catalogue. Un jeu de collection dont on peut
acheter chaque pièce à l'unité n'est plus un jeu de collection, c'est une
liste de courses.

**Une carte s'obtient maintenant de trois façons, et de trois seulement :**

1. elle **sort d'un carton** ;
2. on **l'achète ou on l'échange à un autre joueur**, au marché ;
3. on la **fait entrer dans le jeu** en la proposant — et elle arrive alors en
   pressage d'origine, au nom de celui qui l'a trouvée.

Les crédits n'achètent plus que deux choses : des cartons, et ce que d'autres
joueurs mettent en vitrine.

**Conséquences en cascade, toutes traitées :**

- l'onglet **Presser** disparaît du marché — il ne reste que *Les annonces*,
  *Vendre* et *Fondre mes doublons* ;
- la restriction « une carte pressée ne se revend pas » n'a plus lieu d'être :
  les quelques cartes obtenues ainsi redeviennent des cartes comme les autres,
  vendables et échangeables ;
- l'ancienne action répond **410** avec un message qui dit par où passer,
  plutôt que « action inconnue » — un onglet resté ouvert ne tombe pas dans le
  vide ;
- la page des règles ne décrit plus le pressage mais **les trois chemins**, et
  dit explicitement qu'on ne peut pas se procurer une carte auprès du jeu.

## 2. Le menu, revu de fond en comble

Tu t'y perdais, et tu avais raison : **les noms ne disaient pas ce qu'on y
fait.** « Accueil » ne disait pas qu'on y ouvre des cartons — c'est pourtant
le geste central du jeu. « Communauté » ne disait pas qu'on y propose des
morceaux, et il était rangé à côté du marché, avec lequel il n'a rien à voir.

| avant | après |
|---|---|
| **Jouer** — Accueil · Le Set · Le Défi | **Ouvrir** — Ouvrir un carton |
| **Ma collection** — Étagère · Crew · Profil | **Ma collection** — Étagère · Crew · Profil |
| **Échanger** — Marché · Communauté | **Jouer** — Le Set · Le Défi · Classement |
| **Le jeu** — Bibliothèque · Classement · Règles | **Marché** |
| **Réglages** — Réglages · Boutique | **La bibliothèque** — Tous les sons · Proposer un son |
| | **Aide & réglages** — Règles du jeu · Réglages · Boutique |

Ce qui change vraiment :

- **ouvrir un carton a son propre onglet.** C'est ce qu'on vient faire.
- **« Communauté » devient « Proposer un son »**, rangé avec la bibliothèque
  puisqu'il s'agit de la faire grandir.
- **« Bibliothèque » devient « Tous les sons »** — on comprend sans cliquer.
- **le classement rejoint « Jouer »**, il mesure comment on joue.
- **« Règles » quitte « Le jeu »** (une catégorie fourre-tout) pour « Aide ».

**Et le menu ne défile plus, il passe à la ligne.** C'était la cause profonde
du problème précédent : une barre qui défile sans barre de défilement visible,
c'est un menu dont on ignore la moitié. Le dernier onglet était hors de
l'écran et rien ne le laissait deviner. Sur téléphone, où la place manque
vraiment, on garde le défilement — mais avec un dégradé au bord droit qui
montre qu'il reste quelque chose.

Un test vérifie maintenant qu'**aucun onglet ne sort de la barre**, et qu'**aucune
vue n'apparaît dans deux familles**.

## 3. Les Pépites tombaient dix fois trop souvent

Une Pépite pesait **2 sur 100** : une carte sur cinquante, donc **une chance
sur dix par carton de cinq**. Un joueur en voyait une tous les deux jours. Ce
n'est pas le fond du bac, c'est le présentoir de la caisse.

| Palier | avant | après |
|---|---|---|
| Tube | 1 sur 2 | 3 sur 5 |
| Classique | 1 sur 4 | 1 sur 4 |
| Titre d'album | 1 sur 8 | 1 sur 11 |
| Face B | 1 sur 14 | 1 sur 25 |
| Rareté | 1 sur 25 | 1 sur 59 |
| **Pépite** | **1 sur 50** | **1 sur 333** |

Soit **un carton sur soixante-sept**. Les six paliers, leurs seuils de
popularité et leurs valeurs ne bougent pas — seules les chances de tirage
changent.

## 4. L'équilibrage : ce n'était pas le prix du carton

Ton diagnostic était exact, et je n'avais pas traité la bonne cause. J'avais
monté le prix pour que le carton ne se rembourse plus — mais un joueur qui
reconnaît presque tout récupère quand même 130 crédits sur 170, soit **76 % du
prix rendus à chaque ouverture**. Le carton ne se rembourse pas tout seul,
mais il paie les trois quarts du suivant.

Monter encore le prix ne réglerait rien : ça punirait aussi celui qui
reconnaît peu, alors que le problème vient de **celui qui reconnaît beaucoup**.

**Ce qui borne une session, c'est le nombre de trouvailles.** Les **dix
premières trouvailles de la journée** paient plein tarif ; au-delà, 40 %.

Ce n'est pas un minuteur — on joue autant qu'on veut, simplement le rendement
décroche. Le compteur est **affiché sur l'accueil**, il repart chaque jour, et
il ne compte que les vraies trouvailles : passer son tour ou retomber sur un
doublon ne l'entame pas. Le carton passe de 140 à **170**.

Simulation sur trente jours, un joueur qui dépense tout :

| Profil | avant | après |
|---|---|---|
| occasionnel | 583 cartes · 117 cartons | 444 cartes · 89 cartons |
| régulier | 969 cartes · 194 cartons | 648 cartes · 130 cartons |
| **acharné** | **1 358 cartes · 272 cartons** | **705 cartes · 141 cartons** |

Le point important n'est pas la baisse : c'est que **l'écart entre « régulier »
et « acharné » se referme** — 130 contre 141 cartons. Enchaîner les ouvertures
ne rapporte presque plus rien.

## 5. La bibliothèque ne savait pas dater ses ajouts

Tout ce qui entrait par la recherche, l'ajout par liste ou le constructeur
était marqué comme venant du fichier de départ. L'écran annonçait donc « Import
de départ : 14 013 » même après une semaine d'ajouts, et il était **impossible
de répondre à la question la plus simple** : combien de sons ai-je ajoutés
cette semaine ?

Chaque son porte maintenant sa **date d'entrée**, et les compteurs deviennent :
**Sons dans le jeu** · **Ajoutés cette semaine** (et sur trente jours) ·
**Apports des joueurs** · **Fonds de départ**.

Les sons d'avant cette version n'ont pas de date, et on ne leur en invente pas
une : ils comptent comme fonds de départ, ce qui est vrai pour l'immense
majorité d'entre eux.

---

## Vérifications

| Suite | Vérifie | |
|---|---|---|
| test-navigateur.mjs | le jeu dans Chromium, **le menu, la barre qui ne déborde pas** | 165 |
| test-api.mjs | comptes, propositions, modération, crews | 154 |
| test-bibliotheque.mjs | le premier crédité, la relecture, **les dates d'ajout** | 116 |
| test-jeu.mjs | cartons, enquête, marché, fondre | 67 |
| **test-economie.mjs** | **le quota du jour, les paliers, la suppression du pressage** | **56** |
| test-outils.mjs | les outils d'administration | 52 |
| test-defi.mjs | le défi du jour | 39 |
| test-charge.mjs | ce que la page télécharge | 32 |
| test-recherche.mjs | comment un morceau est retrouvé chez Apple | 28 |
| test-boutique.mjs | la boutique | 25 |
| test-simultane.mjs | l'anti-duplication sous requêtes parallèles | 18 |
| test-mentions.mjs | les mentions légales | 15 |
| test-carton.mjs | jamais deux fois la même carte | 11 |
| test-blobs.mjs | le rangement | 8 |
