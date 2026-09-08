# Diggers v2.7 — la passe sur les retours de joueurs

662 vérifications automatiques, toutes vertes (526 côté serveur, 136 dans un
vrai Chromium).

---

## PRIORITÉ 1 — ce qui était cassé

### Les feats : le premier artiste crédité possède le morceau

**La règle, désormais partout la même :** « A & B », « A feat. B », « A, B » →
c'est **A**. Toujours. La ligne complète reste affichée en crédits sous la
carte retournée : personne n'est effacé, mais une seule bonne réponse existe.

Avant, la réparation gardait **le plus connu** des noms cités — celui qui avait
le plus de titres seul en bibliothèque. C'était plus malin et c'était faux :
« Mairo & H JeuneCrack » partait chez H JeuneCrack, et le même morceau pouvait
**changer de propriétaire** à mesure que la bibliothèque grossissait.

**Le garde-fou a changé de place.** Il vivait dans le constructeur, côté
navigateur : tout ce qui entrait par un autre chemin — import de fichier,
proposition validée, script — pouvait déposer « GIMS & Dadju » en base, et il
fallait repasser derrière avec le bouton de réparation. Il est maintenant sur
`normaliserImport`, **le seul passage que tout le monde emprunte**. Une carte à
deux noms ne peut plus entrer, quel que soit le chemin.

Vérifié sur les six chemins : le constructeur Apple, l'ajout par liste, le
nouvel écran de recherche, l'import de fichier, la proposition validée par la
modération, et la réparation elle-même. Une carte validée part chez son
trouveur **telle qu'elle est rangée**, plus telle qu'elle a été envoyée.

**Deux garde-fous restent, parce qu'un groupe n'est pas un featuring :**

- une signature qui revient sur **trois titres ou plus** est un nom de groupe —
  « Earth, Wind & Fire » ne devient pas « Earth » ;
- sauf si elle porte un « feat. », « ft. », « featuring », « avec », « with »,
  « vs » : là il n'y a aucun doute.

**Et une porte de sortie manuelle**, parce que ces deux règles ratent un duo
qui n'a qu'un ou deux titres dans le jeu : **Modération → Bibliothèque → Noms à
garder entiers**. Un nom par ligne, et ils ne sont plus jamais découpés, ni à
l'import ni à la réparation. L'aperçu de la réparation **nomme** maintenant les
groupes qu'il garde entiers, au lieu d'en donner le nombre.

### Les propositions des joueurs : elles étaient là, invisibles

L'écran existait, complet, depuis la v2.0. Il s'appelait **« File d'attente »**
— un nom qui ne dit rien de ce qu'il contient. C'est pour ça qu'il était
introuvable.

- l'onglet s'appelle maintenant **« Propositions des joueurs »**, avec le
  **nombre en attente** affiché dessus ;
- un second onglet, **« Déjà traitées »**, branche enfin l'API `historique` qui
  existait sans écran : validées et refusées, avec le motif, la date de
  proposition, la date de décision et le nom du modérateur ; recherche et
  filtre ;
- l'écran vide n'est plus « la file est vide » mais explique d'où viennent les
  propositions et où trouver les décisions passées ;
- côté joueur, l'écran de ses propositions montre les dates et le motif de
  refus, et l'écran vide dit où proposer.

Ce qui marchait déjà et n'a pas bougé : pochette, extrait écoutable, correction
du titre/artiste/genre avant publication, curseur de popularité, refus motivé,
et le refus serveur d'une seconde décision sur la même proposition.

### iPhone : « site non sécurisé »

**Trouvé, et ce n'est pas un bug du site.** J'ai interrogé le projet Netlify :
l'URL principale enregistrée est `http://diggers-io.netlify.app`, en clair. Le
certificat existe et fonctionne — la page répond en `https://`. Mais **« Force
HTTPS » est désactivé**, donc qui ouvre le lien sans `https://` reste en clair,
et Safari le signale.

Le code est propre de ce côté : aucune ressource en `http://`, tous les appels
API sont relatifs à l'origine.

**Ce que j'ai fait** — des en-têtes de sécurité dans `netlify.toml` :
`Strict-Transport-Security` (deux ans, sous-domaines compris : après une
première visite en HTTPS, le navigateur refuse de repasser en clair),
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`.

**Ce que tu dois faire, toi** — HSTS ne protège qu'à partir de la deuxième
visite. La première passe encore en clair tant que l'interrupteur est éteint :

> Netlify → ton site → **Site configuration** → **Domain management** →
> **HTTPS** → activer **Force HTTPS**

Je n'y touche pas moi-même : c'est un réglage de ton compte.

---

## PRIORITÉ 2 — ce qui manquait

### Un carton ne contient plus jamais deux fois la même carte

`tirerUne()` était appelée cinq fois de suite, sans mémoire. Sur un thème à
deux titres, on recevait cinq cartes tirées parmi deux — c'est le « thème
bollywood, 5 fois le même son ».

- le tirage garde maintenant en mémoire ce qu'il a déjà sorti ;
- **un thème n'est proposé que s'il a au moins cinq titres.** Un genre à deux
  morceaux n'est pas une scène, c'est un accident de catalogue ;
- si aucun genre n'est assez fourni, le carton à thème est **refusé avec une
  explication, et rien n'est débité** — plutôt que rempli de doublons ;
- le carton annonce son thème à l'ouverture, sinon le joueur ne comprend pas
  pourquoi ses cinq cartes se ressemblent.

### Le prix libre au marché existait déjà — il était invisible

Le serveur acceptait, validait et facturait un prix libre depuis longtemps, et
l'interface avait un champ. Un champ **nombre nu, sans étiquette**. Personne ne
voyait qu'on pouvait le changer.

- le champ porte son nom : **« Ton prix, en crédits »** ;
- il affiche en direct **l'écart à la cote** en pourcentage à mesure qu'on
  tape ;
- le bouton dit « Mettre en vente » et non « Poser » ;
- un prix à zéro ou négatif est refusé côté interface **et** côté serveur ;
- l'écran explique en une phrase que le prix est libre, que la cote n'est qu'un
  repère, et qu'on peut retirer une annonce à tout moment.

### Ajouter des sons : chercher, cocher, ajouter

**Modération → Chercher des sons.** Ce qui manquait entre « je sais exactement
quoi ajouter » (l'ajout par liste, v2.5) et « je reconstruis tout » (une
demi-heure, onglet ouvert).

Recherche **par artiste, par titre, ou par genre**. Les résultats arrivent avec
pochette, titre, artiste, album, année, genre, durée, et un bouton pour écouter
l'extrait. **Cases à cocher**, « tout cocher », un bouton qui ajoute la
sélection d'un coup. Ce qui est déjà dans le jeu est **grisé et non cochable**
— c'est le serveur qui répond à cette question. Mêmes contrôles que partout :
un seul artiste par carte, pas de karaoké, pas de reprise, pas de live.

---

## PRIORITÉ 3 — l'équilibrage et les mots

### L'économie : la boucle était ouverte

**Les chiffres d'avant.** Carton standard **100 crédits** pour cinq cartes ;
une carte reconnue du premier coup en rendait **26**. Cinq cartes reconnues =
**130**. **Le carton se remboursait tout seul.** J'ai simulé trente jours pour
trois profils : un joueur acharné ouvrait **1 230 cartons**, ramassait 6 150
cartes, **et finissait avec 14 300 crédits d'avance**. La boucle n'avait pas de
fin. Ton ressenti était juste, et ce n'était pas un réglage à la marge.

**Trois leviers, et aucun n'est un minuteur.**

**1. Un carton ne se rembourse plus.** 140 crédits pour cinq cartes qui, dans
le meilleur cas possible — les cinq reconnues du premier coup, toutes
d'artistes jamais vus — en rendent 130. Les crédits viennent désormais du jeu,
et les cartons les dépensent. `test-economie.mjs` échoue si un jour un carton
redevient rentable.

**2. La découverte paie plein tarif, la répétition moins.** Reconnaître un
artiste **déjà sur ton étagère** rapporte 55 %. Ce n'est pas une punition,
c'est le jeu qui dit ce qu'il attend — et ça se resserre tout seul à mesure que
la collection grandit, sans qu'on ait rien à régler.

**3. Revenir paie.** La série de jours consécutifs **existait dans le code et
ne servait à rien**. Elle donne maintenant une prime à la première action de la
journée : 12 crédits le premier jour, +8 par jour, plafonnée à 60 au septième.
Et six **paliers de collection** — 10, 25, 50, 100, 200, 400 **artistes
différents** reconnus — de 50 à 2 000 crédits, une seule fois chacun. Des
artistes, pas des cartes : sinon ouvrir des cartons suffirait.

**Ce qui n'a pas bougé :** les 26 crédits d'une carte reconnue du premier coup.
C'est la récompense du geste central du jeu ; la toucher aurait été punir le
joueur pour ce qu'on lui demande de faire.

Les sets passent de 40/20/12 à 22/10/6, toujours plafonnés à cinq par jour.

| 30 jours, joueur qui dépense tout | avant | après |
|---|---|---|
| occasionnel | 599 cartes, 778 cr en poche | 597 cartes, 2 173 cr |
| régulier | 1 649 cartes, 1 967 cr | 1 090 cartes, 272 cr |
| acharné | **6 150 cartes, 14 300 cr** | **1 598 cartes, 268 cr** |

L'accueil montre maintenant la série en cours, ce que rapportera demain, le
nombre d'artistes reconnus et le prochain palier.

### Le vocabulaire

**« À sec » ne voulait pas dire ce que tu croyais.** Ce n'était pas « plus de
crédits » : ça désignait une carte reconnue **sans aucune aide** — sans écouter
l'extrait, sans indice, du premier coup. C'est même la statistique du
classement. Que tu l'aies toi-même mal comprise était la meilleure preuve qu'il
fallait la renommer.

Partout : **« sans aide »**. Dans le carton, sur les cartes, dans les règles,
au profil, au classement, au crew. Le test échoue si « à sec » réapparaît.

Aussi : « Identification à sec » → « Reconnus sans aide » · « sort du à sec » →
« ne coûte rien, mais la carte ne comptera plus sans aide » · « Poser une
carte » → « Mettre une carte en vente » · « la file est vide » → une phrase qui
explique.

---

## Ton point 9 : l'import iTunes, franchement

**Il tourne entièrement dans ton navigateur**, en JSONP. Réponses à tes
questions, une par une :

| | |
|---|---|
| s'exécute côté client | **oui**, entièrement |
| s'exécute côté serveur | non |
| continue si tu fermes la page | **non** |
| file d'attente | non |
| progression | oui, à l'écran, pendant qu'il tourne |
| logs | non, rien de persistant |
| gère les erreurs | oui — un artiste muet est compté et la construction continue |
| évite les doublons | oui, côté serveur, à l'import |
| reprend après interruption | **oui** — un repère dans `localStorage`, relancer reprend où ça s'était arrêté |

**Le déplacer côté serveur n'est pas une amélioration, c'est un autre projet.**
Une fonction Netlify meurt au bout de 10 secondes et Apple limite à ~20
requêtes par minute : 461 artistes, c'est 25 minutes de travail. Il faut donc
une file persistante et un ordonnanceur qui la grignote toutes les minutes
(les tâches planifiées Netlify le permettent), plus un écran de suivi.
Comptes une demi-journée. **Je préfère te le dire que le bâcler au milieu du
reste** — et l'écran de recherche livré ici couvre déjà le geste courant.

---

## Vérifications

| Suite | Vérifie | |
|---|---|---|
| test-api.mjs | comptes, propositions, modération, crews | 154 |
| test-navigateur.mjs | le jeu complet dans Chromium | 136 |
| test-bibliotheque.mjs | la vue publique et **la règle du premier crédité** | 85 |
| test-jeu.mjs | cartons, enquête, marché | 62 |
| test-outils.mjs | les outils d'administration | 52 |
| test-defi.mjs | le défi du jour | 39 |
| test-charge.mjs | ce que la page télécharge | 32 |
| **test-economie.mjs** | **la prime, les paliers, la rentabilité des cartons** | **25** |
| test-boutique.mjs | la boutique | 25 |
| test-simultane.mjs | l'anti-duplication sous requêtes parallèles | 18 |
| test-mentions.mjs | les mentions légales | 15 |
| **test-carton.mjs** | **jamais deux fois la même carte, thèmes trop maigres** | **11** |
| test-blobs.mjs | le rangement | 8 |

Deux suites nouvelles, écrites à partir de tes retours. `test-carton.mjs` ouvre
cinquante cartons sur une bibliothèque volontairement déséquilibrée et échoue
si un doublon apparaît. `test-economie.mjs` échoue si un carton redevient
rentable.
