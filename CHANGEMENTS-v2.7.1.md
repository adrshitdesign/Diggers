# Diggers v2.7.1 — trois retours, trois corrections

Correctif de la v2.7. **Seuls `index.html` et les fichiers de test changent** —
aucune fonction serveur n'est touchée.

726 vérifications automatiques, toutes vertes.

---

## 1. L'écran « Noms composés » était illisible

**Ma faute, et une faute bête.** J'ai réutilisé la ligne de classement
(`.lr`) pour une liste qui n'a pas la même forme. Cette ligne est une grille de
quatre colonnes : `34px | reste | 62px | 58px`. Le rang tient dans 34 pixels ;
un nom d'artiste, non. Résultat : « Let… », « Da… », « Pie… », et un écran qui
ne servait à rien.

Nouvelle variante `.lr.libre` : deux blocs, le texte prend la place qu'il lui
faut, l'action s'aligne à droite, tout passe à la ligne sur un écran étroit.
Appliquée aux six listes qui n'ont pas quatre colonnes — dont **les annonces du
marché et l'historique des propositions**, qui souffraient du même défaut sans
que personne l'ait signalé.

**Un test le vérifie maintenant pour de bon** : il mesure la largeur réelle du
nom à l'écran et échoue s'il est tronqué. Un test qui lit le HTML n'aurait rien
vu — celui-ci regarde le rendu.

## 2. « 12 sons trouvés sur 53 », et trois minutes d'attente

Deux causes, deux corrections.

**La cause principale : on épuisait Apple.** Cinquante-trois lignes, c'étaient
cinquante-trois requêtes espacées de 3,4 secondes. Apple limite à une vingtaine
par minute et **ne dit pas « tu vas trop vite »** — il renvoie simplement des
réponses vides. Les premières lignes passaient, les suivantes revenaient
bredouilles sans qu'on sache pourquoi.

**Les lignes sont maintenant regroupées par artiste.** Tes 53 morceaux ne
parlent que de **19 artistes** : une requête par artiste, deux cents titres
ramenés d'un coup, et on retrouve les morceaux dedans.

| | avant | après |
|---|---|---|
| requêtes pour ta liste de 53 | 53 | **19** |
| temps | ~3 min | **~1 min** |
| dépend du débit d'Apple | beaucoup | **peu** |

Trois ajouts par-dessus :

- **un second passage** rattrape un par un les titres absents du catalogue de
  l'artiste (sorti sous un autre nom, ou trop récent pour figurer dans les 200
  premiers) ;
- **une détection de bridage** : trois réponses vides d'affilée et le jeu
  s'arrête vingt secondes, l'annonce à l'écran, puis reprend. Plutôt que de
  brûler le reste de la liste pour rien ;
- **la progression dit ce qui se passe** : quel artiste, combien trouvés sur
  combien.

**La seconde cause : un filtre trop zélé.** Le jeu écarte les lives, remixes et
versions alternatives — utile pour le constructeur, qui ratisse au hasard.
Mais il s'appliquait aussi quand **tu avais écrit le titre toi-même** : un
morceau qui s'appelle « Live Ta Vie » ou « Version Originale » était rejeté
sans explication.

Désormais : si le titre rendu par Apple est **exactement** celui que tu as
demandé, on te fait confiance. La comparaison se fait sur le titre **brut** —
sinon « Tchikita (Remix) » serait devenu « Tchikita » et aurait été pris pour
le titre demandé. Un remix qu'on n'a pas demandé reste écarté.

**Aussi corrigé :** la recherche par genre du nouvel écran envoyait un
`attribute=genreIndex` qui attend un *numéro* de genre, pas un mot. Une
recherche sur « boom bap » ne pouvait rien rendre. Elle est maintenant libre.

## 3. Ce que montre ta capture d'écran

Les lignes que tu vois — 17 cartes, 9, 7, 5… sous une même signature — ont été
découpées par **une réparation précédente**, sous l'ancienne règle. Le nouvel
écran les révèle enfin.

**Dix-sept cartes sous la même signature, c'est très probablement un groupe.**
La nouvelle règle ne les aurait pas découpées : le garde-fou protège toute
signature portée par trois titres ou plus. Regarde-les une par une et clique
« Annuler le découpage » sur celles qui sont des noms de groupe — les cartes
retrouvent leur nom entier et la ligne est protégée pour de bon.

---

## Vérifications

| Suite | Vérifie | |
|---|---|---|
| test-api.mjs | comptes, propositions, modération, crews | 154 |
| test-navigateur.mjs | le jeu complet dans Chromium, **la largeur réelle des noms** | 150 |
| test-bibliotheque.mjs | la règle du premier crédité, la relecture | 107 |
| test-jeu.mjs | cartons, enquête, marché | 62 |
| test-outils.mjs | les outils d'administration | 52 |
| test-defi.mjs | le défi du jour | 39 |
| test-charge.mjs | ce que la page télécharge | 32 |
| **test-recherche.mjs** | **comment un morceau est retrouvé chez Apple** | **28** |
| test-economie.mjs | la prime, les paliers, la rentabilité des cartons | 25 |
| test-boutique.mjs | la boutique | 25 |
| test-simultane.mjs | l'anti-duplication sous requêtes parallèles | 18 |
| test-mentions.mjs | les mentions légales | 15 |
| test-carton.mjs | jamais deux fois la même carte | 11 |
| test-blobs.mjs | le rangement | 8 |

`test-recherche.mjs` extrait les fonctions de recherche depuis `index.html` et
les fait tourner sur de fausses réponses d'Apple : aucun réseau, et le
comportement de correspondance est vérifié cas par cas — le titre exact, le
remix non demandé, le featuring entre parenthèses, l'homonyme, le karaoké.
