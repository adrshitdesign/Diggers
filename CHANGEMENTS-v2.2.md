# Diggers — ce qui change en v2.2

Quatre chantiers. Trois que tu avais choisis, plus les mentions légales.
**372 vérifications passent**, dont 55 dans un vrai navigateur.

---

## 1. Plus personne ne peut dupliquer une carte ni un crédit

### Le trou

Tout le serveur était écrit comme ça : je lis ta fiche, je la modifie, je la
réécris. C'est juste — tant que les requêtes arrivent une par une. Elles
n'arrivent pas une par une.

Deux clics partis à la même milliseconde lisent tous les deux « 400 crédits »,
retirent tous les deux 100, écrivent tous les deux « 300 ». Deux cartons pour le
prix d'un. Pas besoin d'être malintentionné : un double-clic suffisait.

Trois endroits où c'était vraiment grave :

- **le marché** — deux acheteurs sur la même annonce repartaient chacun avec la
  carte. Un exemplaire devenait deux, et le vendeur était payé deux fois. Sur un
  jeu de collection, c'est le bug qui tue la valeur de tout le reste ;
- **le vendeur** — pendant qu'il jouait de son côté, sa propre sauvegarde
  écrasait le versement de sa vente. Crédits envolés ;
- **Stripe** — la caisse réessaie quand elle n'obtient pas de réponse à temps.
  Le « je regarde si j'ai déjà traité, puis j'écris » laissait passer les deux
  messages : jetons crédités deux fois pour un seul paiement.

### Ce qui a été posé

**`majAtomique(rangement, clé, transformer)`** dans `_store.mjs` : on relit, on
transforme, et on n'écrit **que si personne n'a bougé entre-temps**. Sinon on
recommence, six fois, avec une pause qui grandit. En ligne c'est l'`etag` de
Netlify (`if-match`, refus en HTTP 412) ; en local, une file par clé.

**`majJoueur(uid, f)`** dans `_lib.mjs` : la même chose sur la fiche d'un joueur.
À utiliser dès qu'on touche à la fiche de **quelqu'un d'autre**.

**`avecJoueur(u, travail)`** : un bail court, posé par écriture conditionnelle,
qui sérialise les actions d'un même compte — et, le détail qui compte, **relit
la fiche une fois le bail obtenu**. Sans cette relecture le verrou ne servait à
rien : les requêtes attendaient bien leur tour, mais travaillaient toutes sur la
photo prise avant la file d'attente. Le test l'a montré tout de suite.

Appliqué dans `jeu.mjs`, `marche.mjs`, `boutique.mjs`, `stripe.mjs`, `defi.mjs`.

Au passage, un vrai bug attrapé par les tests : l'écriture des fichiers en local
pouvait être lue à moitié faite. Elle passe maintenant par un fichier temporaire
renommé — le renommage, lui, est indivisible.

### La preuve

`node test-simultane.mjs` — 18 vérifications qui lancent les requêtes **en
même temps** :

| Ce qu'on lance | Ce qui se passe maintenant |
|---|---|
| 6 cartons cliqués d'un coup avec 400 crédits | 4 ouverts, 4 payés, 0 crédit restant, 20 cartes |
| 4 acheteurs sur la même annonce | 1 gagne, 3 « déjà partie », **1 seul exemplaire existe** |
| 3 ventes simultanées vers la même vendeuse | elle touche les 3 prix, pas un seul |
| 2 décors à 250 jetons avec 300 jetons | 1 seul passe, solde à 50, inventaire cohérent |
| Stripe qui repasse 3 fois le même message | 650 jetons crédités, pas 1950 |

---

## 2. Le Défi du jour — un nouvel onglet

**Pourquoi revenir un mardi soir.** Un thème identique pour tout le monde, tiré
du même sac chaque jour — 28 thèmes écrits comme des questions de comptoir :
« le son qui réveille une salle à trois heures du matin », « celui que personne
d'autre ne connaîtra ici ».

Chacun pose **une** carte de son étagère : il faut donc l'avoir, et l'avoir
trouvée — une carte face cachée ne répond à rien. C'est ce qui donne à la
collection un rôle autre que décoratif.

Ensuite on vote, **en duel et à l'aveugle** : deux cartes côte à côte, sans
savoir qui les a posées. Ce n'est pas un détail — sans ça on vote pour ses
copains et pour les morceaux connus. Avec, ce sont les trouvailles qui gagnent.
C'est exactement le tri qu'un digger revendique.

Le lendemain le palmarès tombe, classé sur le **taux de victoire** (pas sur le
nombre de votes reçus), et le podium est payé : 120 / 60 / 30. Voter rapporte 2
crédits par duel, jusqu'à 24 duels par jour.

Fidèle à la v2 : **rien ne vient du navigateur sauf des intentions.** Le joueur
envoie le numéro d'une carte de son étagère ; le serveur va chercher le morceau
dans la bibliothèque. Aucune pochette ni aucun extrait fourni par un client
n'entre jamais.

`node test-defi.mjs` — 38 vérifications, dont six qui lancent des poses et des
votes simultanés et vérifient qu'aucun duel n'est perdu.

---

## 3. Le catalogue enfin profond

Tu avais raison sur les 22 titres par artiste, et le problème était pire.

**Ce qui n'allait pas :** le constructeur attendait 200 ms entre deux artistes,
soit ~300 appels par minute. Apple en tolère une vingtaine. La plupart des
artistes étaient donc **silencieusement recalés** — la bibliothèque tournait à
6,5 titres par artiste au lieu des 22 prévus. Le script en ligne de commande
avait le même défaut, avec un commentaire qui disait pourtant déjà la bonne
limite.

**Maintenant :** 3,4 s entre deux artistes, 200 titres demandés au lieu de 40,
jusqu'à 35 gardés, et **461 artistes** au lieu de 155.

**Et surtout, ça reprend là où ça s'est arrêté.** L'avancement est noté dans le
navigateur à chaque artiste. Un écran qui s'endort, un onglet fermé, un Wi-Fi
qui saute : on relance « Construire depuis Apple » et ça repart de l'artiste
suivant. La barre annonce le temps restant.

Compter ~26 minutes pour les 461 artistes, onglet au premier plan.

> **État en ligne aujourd'hui** : la bibliothèque est passée de 1 013 à
> **2 952 sons** pendant la session précédente, jusqu'à ce que la liaison tombe
> vers le 100ᵉ artiste. Les envois se font par paquets de 250, donc tout ce qui
> était fait est en base. Il reste ~360 artistes, que le constructeur reprendra
> sans rien refaire.

---

## 4. Les mentions légales — sans afficher ton adresse

Ce qui était enregistré (`statut: "kiffeur"`, une adresse sans ville ni code
postal) ne tiendrait pas trente secondes si quelqu'un les regardait.

Mais tu n'es pas obligé d'afficher ton adresse personnelle. **Un particulier qui
édite un site à titre non professionnel peut rester anonyme vis-à-vis du
public** : ce sont alors les coordonnées de l'hébergeur qui sont publiées, à
condition qu'il détienne ton identité — ce qu'un compte Netlify fait déjà.

Modération → Mentions légales a donc maintenant une case
**« J'édite ce site à titre personnel et non professionnel »**. Cochée, seuls le
contact et l'hébergeur sont demandés et publiés, et la page l'explique aux
visiteurs dans les termes de la loi.

**Le point de bascule est codé, pas seulement écrit :** le jour où tu ouvres la
boutique en euros, tu deviens un professionnel — nom, adresse et directeur de
publication redeviennent obligatoires, et `/api/boutique` refuse de vendre tant
qu'ils sont vides. C'est vérifié par un test.

`node test-mentions.mjs` — 15 vérifications.

---

## Ce qu'il faut faire, dans l'ordre

1. **Publier** — remplacer le contenu du dépôt GitHub par ce dossier, Netlify
   redéploie tout seul. Vérifier que `DIGGERS_ADMIN` est toujours dans les
   variables d'environnement.
2. **Cocher la case des mentions** — Modération → Mentions légales, case
   « à titre personnel », une adresse de contact, Enregistrer. Le bandeau rouge
   disparaît.
3. **Relancer le catalogue** — Modération → Bibliothèque → Construire depuis
   Apple. Ça reprendra vers le 100ᵉ artiste. Laisser l'onglet devant, ~20 min.
4. **Ouvrir le Défi** — il apparaît tout seul entre « Le Set » et « Règles ».
   Il faut trois joueurs pour que les duels commencent : c'est le bon moment
   pour tes vingt personnes du lancement.

---

## Les tests

```
npm test                    372 → les sept suites serveur
node test-navigateur.mjs    55 → le jeu entier dans un vrai Chrome (Playwright)
```

| Suite | Ce qu'elle couvre | |
|---|---|---|
| `test-api.mjs` | comptes, modération, mentions | 154 |
| `test-jeu.mjs` | tirage, enquête, économie, Set, marché | 59 |
| `test-boutique.mjs` | décor, jetons, Stripe | 25 |
| `test-blobs.mjs` | le rangement des données | 8 |
| `test-defi.mjs` | le défi du jour | 38 |
| `test-simultane.mjs` | **les actions simultanées** | 18 |
| `test-mentions.mjs` | les deux régimes légaux | 15 |
| `test-navigateur.mjs` | tout, dans un vrai navigateur | 55 |
