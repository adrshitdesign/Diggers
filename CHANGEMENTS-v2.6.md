# Diggers v2.6 — la page se charge, et la bibliothèque peut grandir

## Le problème

Ouvrir le jeu téléchargeait **la bibliothèque entière**. Les 14 000 cartes,
avec leurs pochettes, leurs extraits et leurs liens : **7,8 Mo à chaque
chargement de page**, sur chaque appareil, à chaque visite.

C'était tenable à 2 000 sons. À 14 000, c'était plusieurs secondes d'écran
vide sur un téléphone. Et c'était ça, la vraie limite de 20 000 sons : le
point où la réponse dépassait ce qu'une fonction Netlify sait renvoyer d'un
coup. Le chiffre n'était pas une règle du jeu, c'était l'endroit où le site
cassait.

## Ce que le navigateur recevait — et ce qu'il en faisait vraiment

En regardant à quoi servaient ces 14 000 cartes une fois arrivées, il n'y
avait que quatre usages :

| À quoi ça servait | Ce que ça demandait vraiment |
|---|---|
| remplir l'écran des goûts | une liste d'**artistes**, pas de titres |
| afficher le poids du jeu en bas de page | deux **compteurs** |
| le bouton « tester le son » | **un** extrait |
| chercher un titre à presser, ouvrir un set partagé, savoir si un son est déjà dans le jeu | **une question au serveur**, quand on la pose |

Les cartes du jeu, elles, n'ont jamais transité par là : c'est le serveur qui
les tire, et il ne dit d'une carte face cachée que ce que le joueur a payé
pour voir.

## Ce qui change

`/api/catalogue` ne renvoie plus les cartes. Il renvoie les compteurs, les
300 artistes les plus connus (nom, pochette, nombre de titres) et un extrait
pour le test audio.

| | avant | après |
|---|---|---|
| chargement de la page | 7,8 Mo | **~50 Ko** |
| et à 50 000 sons | 28 Mo | **~50 Ko** |

Le poids du chargement **ne dépend plus du nombre de sons dans le jeu**.

Trois écrans passent par le serveur au lieu de fouiller une copie en mémoire :

- **Presser à la demande** — la recherche interroge `/api/bibliotheque`, qui
  répond par page. Une frappe plus récente annule l'affichage de la précédente.
- **Un set partagé** — les cinq cartes se demandent par leur identifiant, avec
  leur extrait puisque la page invite à les écouter. Dix identifiants maximum
  par requête : on ne vide pas la bibliothèque dix par dix.
- **« Ce son est-il déjà dans le jeu ? »** dans l'écran de proposition — c'est
  le serveur qui sait. S'il ne répond pas, le jeu n'invente pas : la
  proposition part, et le pare-doublons du serveur la refuse proprement.

## Le serveur aussi arrête de tout relire

Ouvrir un carton, jouer un set, afficher le marché : chacune de ces actions
relisait la bibliothèque entière depuis le rangement. Elle est désormais
gardée **dix secondes en mémoire**.

Le compromis est explicite : un son ajouté peut mettre jusqu'à dix secondes à
apparaître dans les tirages. Personne ne peut y perdre quoi que ce soit — les
cartes déjà tirées ne dépendent pas de cette copie. **La modération, elle, ne
lit jamais la copie** : quand tu retires un son, tu le vois disparaître tout
de suite.

## Le plafond passe de 20 000 à 50 000

Ce n'est toujours pas un chiffre rond posé au hasard. La bibliothèque reste
**un seul enregistrement**, lu en entier côté serveur :

| Bibliothèque | Poids | Temps de lecture |
|---|---|---|
| 14 000 sons (aujourd'hui) | 7,8 Mo | 30 ms |
| 50 000 sons | 28 Mo | 130 ms |
| 100 000 sons | 55 Mo | 172 ms |

À 50 000 c'est encore raisonnable. Au-delà, il faudra **découper
l'enregistrement**, et ce jour-là c'est le code qu'il faudra changer, pas le
chiffre qu'il faudra augmenter. Le commentaire est écrit à côté de la
constante pour que ce soit dit.

Autrement dit : tu as de la place pour **3,5 fois** la bibliothèque actuelle
sans que rien ne bouge, et le temps de chargement des joueurs ne bougera pas
du tout.

## Un détail au passage

La bibliothèque porte maintenant un **numéro de version qui ne recule
jamais**. La date de dernière modification ne suffisait pas : deux écritures
dans la même milliseconde portent la même date, et tout ce qui se met en cache
sur cette clé sert alors une réponse périmée.

## Vérifications

581 vérifications automatiques, toutes vertes.

| Suite | Vérifie | |
|---|---|---|
| test-api.mjs | comptes, propositions, modération, crews | 154 |
| test-navigateur.mjs | le jeu complet dans Chromium | 103 |
| test-bibliotheque.mjs | la vue publique et le découpage d'artistes | 77 |
| test-jeu.mjs | cartons, enquête, marché | 59 |
| test-outils.mjs | les outils d'administration | 52 |
| test-defi.mjs | le défi du jour | 38 |
| **test-charge.mjs** | **ce que la page télécharge (nouveau)** | **32** |
| test-boutique.mjs | la boutique | 25 |
| test-simultane.mjs | l'anti-duplication sous requêtes parallèles | 18 |
| test-mentions.mjs | les mentions légales | 15 |
| test-blobs.mjs | le rangement | 8 |

`test-charge.mjs` mesure les deux formes du catalogue sur la même
bibliothèque et échoue si le chargement se remet à grossir avec le nombre de
sons. Le test du navigateur fait la même mesure dans un vrai Chrome.
