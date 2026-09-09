# Diggers v2.7.6 — le mauvais SDM

**Deux fichiers** : `index.html` à la racine et `moderation.mjs` dans
`netlify/functions`.

**895 vérifications automatiques**, toutes vertes (663 côté serveur, 232 dans
un vrai Chromium).

---

## Le trou que tu viens de trouver

Il y a **deux façons** d'avoir une carte au mauvais artiste, et jusqu'ici je
n'en traitais qu'une.

**Cas 1 — le mauvais NOM.** Le morceau est rangé sous « Ninho » alors qu'Apple
l'attribue à quelqu'un d'autre. C'est ce que corrige *Vérifier les artistes
chez Apple* depuis la v2.7.4 : on redemande à Apple, on compare les noms, on
rectifie.

**Cas 2 — le mauvais ARTISTE, sous le bon nom.** C'est ton SDM. Il existe
plusieurs artistes qui s'appellent réellement SDM. La bibliothèque a été bâtie
en cherchant des **noms**, et une recherche par nom ne fait aucune différence
entre eux. La vérification par nom non plus : elle compare « SDM » à « SDM »,
trouve que tout va bien, et laisse les intrus en place. **Le nom ne pouvait pas
attraper ce cas — par construction.**

Ce qui les sépare, c'est l'**identifiant d'artiste** d'Apple : un nombre, un
seul par personne. Deux identifiants sous un même nom = deux artistes.

## Ce qui change

**1. La vérification chez Apple grave désormais l'identifiant de chaque
morceau**, même quand le nom est déjà juste. Elle ne renommait que les erreurs
et jetait le reste ; c'est cette information jetée qui manquait. Rien d'autre
ne bouge dans son fonctionnement.

**2. Un nouvel outil : « Un nom, deux artistes »** (*Modération → Bibliothèque*).
Il regroupe les morceaux par nom d'artiste et signale les noms qui recouvrent
**plusieurs identifiants**. Pour chacun tu vois :

- combien de morceaux appartiennent à chaque artiste ;
- des titres en exemple, pour reconnaître lequel est le tien ;
- un lien vers **la fiche Apple** de chaque artiste, pour lever le doute ;
- un bouton **« Garder celui-ci, retirer les autres »**.

Le jeu ne choisit pas à ta place, et il ne peut pas : les deux SDM sont aussi
légitimes l'un que l'autre, seul toi sais lequel tu veux dans le jeu. Il te
montre, tu tranches. Un aperçu liste ce qui partirait **avant** que rien ne
sorte.

Les exemplaires déjà tirés par des joueurs restent sur leurs étagères — une
carte pointe vers le morceau, pas vers la bibliothèque. Ils ne ressortiront
simplement plus d'un carton.

## L'ordre à suivre pour ton SDM

1. dépose les deux fichiers, attends le rebuild ;
2. *Modération → Bibliothèque → **Vérifier les artistes chez Apple*** — laisse
   tourner (≈ 4 min pour 14 000 morceaux). Cette fois elle grave les
   identifiants ;
3. *Modération → Bibliothèque → **Un nom, deux artistes*** — SDM devrait y
   apparaître avec ses deux groupes. Ouvre les deux fiches Apple, repère le
   bon, garde-le.

Tant qu'il reste des morceaux sans identifiant, l'écran te le dit en haut :
la liste est incomplète et il faut refaire un passage chez Apple.
