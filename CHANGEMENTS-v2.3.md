# Diggers — v2.3

Deux choses, toutes les deux venues de ton test.

**440 vérifications passent**, dont 65 dans un vrai navigateur.

---

## 1. Une carte, un artiste

### Ce que tu as vu

Tu es tombé sur une carte signée par deux artistes. Ce n'est pas un détail
d'affichage : le jeu propose quatre noms et demande « c'est qui ? ». Sur une
carte signée « GIMS & Dadju », **aucune des quatre réponses n'est juste** — la
bonne n'existe pas dans la liste. La carte est injouable, et le joueur perd
sans comprendre pourquoi.

J'ai compté sur la bibliothèque en ligne : une bonne centaine d'entrées sont
dans ce cas. Toutes datent de la v1.5 — c'est cette version-là qui a construit
les 14 383 sons, et elle recopiait telle quelle la ligne de crédits d'Apple.

### Trois corrections

**a. Le filtre du constructeur était trop large.** Il acceptait un artiste dès
que le nom cherché apparaissait quelque part dans la réponse d'Apple. Deux
choses passaient :

- « GIMS & Dadju » — la ligne *commence* par « gims » ;
- « Hamza Namira » — elle *contient* « hamza » et n'est pas beaucoup plus
  longue. Celui-là est pire : ce n'est pas un featuring, **c'est quelqu'un
  d'autre**, et sa musique n'a rien à voir.

La nouvelle règle découpe la ligne sur les séparateurs (`&`, `,`, `feat.`,
`ft.`, `x`, `avec`, `vs`…) et n'accepte que si **l'un des noms cités est
exactement celui qu'on cherchait**. « Hamza Namira » n'a pas de séparateur et
n'est pas « Hamza » : refusé. « GIMS & Dadju » cherché sous « GIMS » : accepté,
mais la carte est signée **GIMS**, et la ligne complète part dans les crédits,
affichée une fois la carte retournée.

**b. Un bouton pour réparer l'existant.** Modération → Bibliothèque →
**« Un seul artiste par carte »**. Il montre d'abord ce qu'il ferait — combien
de cartes, lesquelles, et ce qu'elles deviennent — avant que tu valides.

La règle de réparation : parmi les noms cités, il garde **celui qui a déjà le
plus de titres seul dans la bibliothèque**, donc celui que tes joueurs
reconnaissent. Deux cartes peuvent alors devenir identiques (« Ninho & Gazo »
et « Gazo & Ninho » sont le même morceau) : la seconde disparaît.

**c. Et surtout, il sait quand ne rien faire.** C'est le point délicat.
« Earth, Wind & Fire » contient des séparateurs, mais c'est un **groupe**, pas
un featuring — le renommer « Earth » serait bien pire que de le laisser. Deux
garde-fous :

- si aucun des noms cités n'est un artiste que le jeu connaît déjà, on ne
  touche à rien — on ne devine pas ;
- si la même ligne revient sur trois titres ou plus, c'est un nom de groupe,
  pas une collaboration : on n'y touche pas non plus.

Les cartes déjà tirées par les joueurs ne bougent pas : elles pointent vers le
son, pas vers son nom d'artiste.

**La règle vit à trois endroits** — le serveur qui répare, le constructeur en
ligne de commande, celui du navigateur. Un test compare les trois copies : si
l'une dérive un jour, il tombe.

---

## 2. Un onglet Bibliothèque, ouvert à tout le monde

Ta deuxième demande, et c'est celle qui manquait le plus à un jeu de
collection.

**Le catalogue entier, visible sans compte** : chaque son du jeu, son palier de
rareté, et surtout **combien d'exemplaires existent réellement** — pas une
estimation, le compte exact des cartes posées sur les étagères des joueurs,
détaillé par pressage (3 exemplaires, dont 1 Vinyle et 2 Standard, chez
2 joueurs).

Pourquoi ça change quelque chose :

- **le palier dit une probabilité, le compteur dit un fait.** Une Pépite peut
  exister en douze exemplaires et un Titre d'album en un seul ; jusqu'ici
  personne ne pouvait le savoir ;
- **ça rend le marché honnête.** Sans ce chiffre, impossible de dire si le
  Vinyle qu'on te propose est le seul du jeu ou le quarantième. C'est
  exactement l'information qui manque à un acheteur ;
- **ça donne un but.** On voit ce qui existe, donc ce qui manque.

En tête de page : combien de sons contient le jeu, combien de cartes circulent,
combien de collections existent, et la répartition par palier. Ensuite la
liste : recherche par titre, artiste ou album ; tri par confidentialité, par
notoriété, par nombre d'exemplaires (les plus répandus ou les plus rares) ou
par artiste ; filtre par palier ; pagination par 60.

Les sons entrés par la communauté portent le nom de leur trouveur.

**Ce qui n'y est pas, volontairement :** aucune adresse d'extrait, aucun
identifiant de joueur. La page dit *combien* et *chez combien de personnes*,
jamais *chez qui* — savoir qui possède quoi, ça se demande au marché.

Le recensement passe en revue toutes les fiches de joueurs : trop lourd pour le
refaire à chaque affichage, donc il est gardé au frais cinq minutes.

---

## Les tests

```
npm test                    375 → les huit suites serveur
node test-navigateur.mjs    65 → le jeu entier dans un vrai Chrome
```

| Suite | Ce qu'elle couvre | |
|---|---|---|
| `test-api.mjs` | comptes, modération, mentions | 154 |
| `test-jeu.mjs` | tirage, enquête, économie, Set, marché | 59 |
| `test-boutique.mjs` | décor, jetons, Stripe | 25 |
| `test-blobs.mjs` | le rangement des données | 8 |
| `test-defi.mjs` | le défi du jour | 38 |
| `test-simultane.mjs` | les actions simultanées | 18 |
| `test-mentions.mjs` | les deux régimes légaux | 15 |
| `test-bibliotheque.mjs` | **un artiste par carte, et le comptage** | 58 |
| `test-navigateur.mjs` | tout, dans un vrai navigateur | 65 |

Deux tests du lot précédent étaient fragiles : ils dépendaient du hasard des
tirages et pouvaient échouer une fois sur trois sans que rien ne soit cassé.
Ils forcent maintenant l'état dont ils ont besoin.
