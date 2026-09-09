# Diggers v2.7.5 — le Défi passe devant, le Set s'en va

**Six fichiers** : `index.html` à la racine, puis `jeu.mjs`, `defi.mjs`,
`crews.mjs`, `classement.mjs` et `compte.mjs` dans `netlify/functions`.

**863 vérifications automatiques**, toutes vertes (642 côté serveur, 221 dans
un vrai Chromium).

---

## 1. Le Set est retiré

Il ne « marchait pas » pour une raison précise, et je te la dois : l'écran
appelait deux fonctions de dessin — la courbe de popularité et les jauges de
notation — qui **n'existent plus dans le fichier**. Elles ont disparu dans une
refonte antérieure, et rien ne le signalait : le mode plantait à l'ouverture,
en silence.

Et même réparé, il était devenu injouable. Sa contrainte du jour tire au sort
parmi sept, dont « que des Faces B ou plus rare ». Depuis qu'on a rendu les
paliers rares vraiment rares (v2.7.3), une Face B tombe une fois sur
vingt-cinq : demander cinq cartes de ce niveau, d'artistes différents, c'est
demander l'impossible à un joueur normal. Le mode se refermait sur
« Tu en as 0 pour 0 artiste(s) ».

Retiré partout, proprement :

- l'onglet et l'écran disparaissent, ainsi que le partage d'un set en image et
  par lien ;
- les deux actions serveur répondent **410** avec une phrase qui dit où jouer
  maintenant — un onglet resté ouvert ne tombe pas dans le vide ;
- le tableau **« Meilleur set »** quitte le classement, le KPI du même nom
  quitte le profil (remplacé par **ta série de jours**), et les deux lignes de
  gain « set gagné / set perdu » quittent le tableau des crédits ;
- la section 7 des règles décrit maintenant **le Défi du jour**, et dit
  franchement que le Set est retiré pour le moment.

Rien de ce qui était gagné en Set n'a été repris : ce sont des crédits, ils
restent.

## 2. Le pourcentage « reconnus sans aide » était faux

Le vrai bug, et il était bien là où tu le disais.

Le taux se calcule sur un journal d'identifications. Mais **chaque mauvaise
réponse y écrivait sa propre ligne**, puis la bonne réponse en écrivait une
autre. Une carte trouvée au deuxième essai comptait donc **deux échecs** au
lieu d'un. Pire : le chiffre du dessous — « 5 sur 5 trouvées sans révélateur »
— comptait des **cartes**, pas des tentatives. Les deux nombres ne parlaient
pas de la même chose et se contredisaient à l'écran. Je l'ai reproduit :
**18 % affiché, sous « 5 sur 5 »**.

Deux corrections :

- **une carte = une ligne**, écrite au moment où la carte se referme (trouvée,
  ou passée). Se tromper coûte toujours le « sans aide » de cette carte, mais
  une seule fois ;
- la ligne de détail compte désormais **exactement ce que le taux compte** — le
  drapeau que le serveur pose sur la carte, au lieu d'une reconstitution locale
  à partir des révélateurs.

Le journal garde les 200 dernières cartes, donc l'historique d'avant se corrige
tout seul en jouant.

## 3. L'accueil devient une vraie page d'accueil

Le Défi est un jeu **quotidien** : s'il faut aller le chercher dans un onglet,
il n'est pas joué. Il est maintenant sous les cartons, sur la page où le joueur
arrive déjà tous les jours :

- **le thème du jour**, en clair ;
- si tu n'as pas posé de carte : un bouton qui t'y emmène ;
- si tu as posé : **le duel se joue sur place**. Tu votes, les 2 crédits
  tombent, et le duel suivant s'enchaîne sans changer de page. C'est le geste
  du jeu, il ne devait pas coûter deux clics de navigation.

L'onglet Défi complet reste là — le palmarès, ta carte posée, l'historique.

## 4. Un onglet Crews au classement

Le classement des crews existait déjà, mais **tout en bas de l'écran Crew** —
c'est-à-dire à l'endroit où l'on ne va que quand on en a déjà un. Il devient un
onglet du **Classement**, à la place de « Meilleur set ». Un crew s'y classe
sur l'oreille **moyenne** de ses membres, pas sur leur nombre : recruter large
ne fait pas monter, recruter juste oui.

Au passage, le palmarès des crews **ne demande plus de compte** : c'est un
classement, il s'affiche dans un écran qui se consulte sans compte comme le
reste du jeu, et il ne rend que des totaux déjà publics — jamais la liste des
membres.

## 5. Un duel déjà tranché revenait en boucle

Trouvé en écrivant le test de l'accueil, et c'est un vrai bug de fond : le
tirage d'un duel **ne regardait pas la liste des duels déjà jugés**. Un joueur
qui avait voté sur la seule paire disponible se la voyait reproposer, votait,
et se faisait répondre « tu as déjà tranché ce duel ». C'était supportable tant
que le Défi était un onglet qu'on ouvrait une fois par jour ; c'était
inacceptable maintenant qu'il est sur l'accueil.

Le serveur cherche désormais une paire **neuve**, en gardant la priorité aux
cartes les moins vues — et quand il n'y en a plus, il le dit au lieu de servir
un duel qui sera refusé.

---

## Vérifications

| Suite | Vérifie | |
|---|---|---|
| **test-navigateur.mjs** | le jeu dans Chromium, **le Défi sur l'accueil, le taux, les crews** | **221** |
| test-api.mjs | comptes, propositions, modération, crews | 156 |
| test-bibliotheque.mjs | le premier crédité, les dates, l'identifiant d'artiste | 137 |
| **test-jeu.mjs** | cartons, **une carte = une entrée**, marché, fondre | **65** |
| test-economie.mjs | le quota du jour, les paliers, l'absence de pressage | 56 |
| test-outils.mjs | les outils d'administration | 52 |
| test-defi.mjs | le défi du jour | 39 |
| test-charge.mjs | ce que la page télécharge | 32 |
| test-recherche.mjs | comment un morceau est retrouvé chez Apple | 28 |
| test-boutique.mjs | la boutique | 25 |
| test-simultane.mjs | l'anti-duplication sous requêtes parallèles | 18 |
| test-mentions.mjs | les mentions légales | 15 |
| test-carton.mjs | jamais deux fois la même carte | 11 |
| test-blobs.mjs | le rangement | 8 |
