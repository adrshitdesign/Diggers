# Diggers v2.5 — le menu, les listes, les comptes

Trois choses demandées après le premier test en ligne.

## 1. Le menu tient maintenant en cinq mots

Il y avait treize onglets sur une seule ligne. Il y a maintenant cinq familles
(six pour l'administration), et la famille ouverte déplie ses vues en dessous.

| Famille        | Ce qu'elle contient                     |
|----------------|-----------------------------------------|
| Jouer          | Accueil · Le Set · Le Défi              |
| Ma collection  | Étagère · Crew · Profil                 |
| Échanger       | Marché · Communauté                     |
| Le jeu         | Bibliothèque · Classement · Règles      |
| Réglages       | Réglages · Boutique                     |
| Modération     | (visible seulement pour la modération)  |

Une famille qui n'a qu'une vue n'affiche pas de second étage — c'est le cas de
Modération, qui reste un onglet unique comme avant.

Ouvrir une vue depuis n'importe où (un bouton, un lien) allume automatiquement
sa famille : rien n'est jamais inaccessible parce qu'on est « dans la mauvaise
famille ».

## 2. Ajouter et retirer des sons en collant une liste

Deux boutons dans **Modération → Bibliothèque**.

**Ajouter des sons par liste.** On colle un morceau par ligne :

```
Jul - Tchikita
Damso — Œuvre d'art
Aya Nakamura | Djadja
Orelsan	Basique
```

Le séparateur peut être un tiret simple entouré d'espaces, un tiret long, un
tiret demi-cadratin, une barre verticale ou une tabulation — donc un
copier-coller depuis un tableur ou un document marche tel quel. Seul le
**premier** séparateur coupe : `Jul - Tchikita - remix` donne bien le titre
entier.

Le navigateur cherche chaque ligne chez Apple, une toutes les 3,4 secondes
(c'est leur limite de débit, pas la nôtre) — compte une minute pour vingt
morceaux. Il applique les mêmes contrôles que le constructeur : un seul
artiste par carte, la ligne de crédits complète gardée à part, pas de
karaoké ni de reprise. Puis il montre ce qu'il a trouvé et ce qu'il n'a pas
trouvé, et **n'ajoute rien avant validation**. 300 lignes maximum d'un coup.

**Retirer des sons par liste.** Même format, et l'ordre inverse marche aussi
(`Titre - Artiste`) : personne ne se souvient de l'ordre au moment de coller.
Le serveur cherche, annonce ce qu'il a trouvé, et attend la validation. Les
exemplaires déjà tirés par des joueurs restent sur leurs étagères — un son
retiré disparaît des futurs tirages, il ne s'efface pas des collections.

Le compte-rendu ne clignote plus : il survit au redessin du panneau.

Un son collé à la main n'a ni popularité ni année : il entre quand même,
avec une popularité au milieu de l'échelle.

## 3. L'écran des comptes

**Modération → Joueurs.** Trois compteurs en haut (comptes, actifs cette
semaine, modération), puis la liste : pseudo, rôle, date d'inscription,
cartes, crédits, sets, propositions validées, crew, adresse posée.

**Il n'y a pas de « qui est connecté », et l'afficher serait mentir.** Le jeu
ne tient pas de sessions ouvertes : il signe des jetons valables six mois, et
un navigateur qui a le sien n'a rien à demander au serveur pour rester
connecté. Ce qu'on peut dire honnêtement, c'est quand chaque compte a écrit
quelque chose pour la dernière fois — c'est la colonne **Vu**.

Ce que l'administrateur peut faire :

- **Nommer / retirer un modérateur** — pas soi-même, sinon plus personne
  n'administre le jeu.
- **Supprimer un compte** — il faut retaper le pseudo exactement. Supprimer un
  compte efface une collection entière ; un clic de trop ne doit pas suffire.
  Le compte fondateur ne se supprime pas d'ici, ni le sien propre (celui-là
  passe par le profil, avec la procédure RGPD).

La suppression passe par exactement la même routine que la suppression
volontaire d'un joueur : sortie du crew, propositions anonymisées, crédits de
bibliothèque anonymisés, pseudo libéré. Le jeton du compte supprimé ne vaut
plus rien à la requête suivante.

Aucun mot de passe, aucune empreinte, aucune adresse e-mail en clair ne sort
de cet écran : on dit seulement si une adresse a été posée.

## Vérifications

539 vérifications automatiques, toutes vertes :

| Suite                   | Vérifie                                   |     |
|-------------------------|-------------------------------------------|-----|
| test-api.mjs            | comptes, propositions, modération, crews  | 154 |
| test-bibliotheque.mjs   | la vue publique et le découpage d'artistes|  77 |
| test-jeu.mjs            | cartons, enquête, marché                  |  59 |
| test-outils.mjs         | **les trois outils de la v2.5**           |  52 |
| test-defi.mjs           | le défi du jour                           |  38 |
| test-boutique.mjs       | la boutique                               |  25 |
| test-simultane.mjs      | l'anti-duplication sous requêtes parallèles|  18 |
| test-mentions.mjs       | les mentions légales                      |  15 |
| test-blobs.mjs          | le rangement                              |   8 |
| test-navigateur.mjs     | le jeu complet dans Chromium              |  93 |

Les tests du navigateur savent maintenant naviguer à deux étages, comme un
joueur : ils cliquent la famille avant la vue.
