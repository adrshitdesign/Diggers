# Diggers v2.7.8 — relire la correction, et pouvoir la défaire

**Deux fichiers** : `index.html` à la racine et `moderation.mjs` dans
`netlify/functions`.

**939 vérifications automatiques**, toutes vertes (683 côté serveur, 256 dans
un vrai Chromium).

---

## Le problème que tu décris

« Je dois tout faire d'un coup, je ne peux pas passer sur chaque morceau. »
C'est exact, et c'était mal pensé de ma part : je te présentais une liste de
plusieurs centaines de lignes et **un seul bouton**. Relire un par un est
impossible ; tout accepter en bloc est précisément ce dont tu te méfies.

Sauf que ce ne sont pas des centaines de **décisions**. Une passe complète, ce
sont quelques dizaines de renommages qui se répètent : « ce nom-là devient
celui-là », vingt fois. C'est ça qu'il fallait te montrer.

## 1. La relecture se fait par renommage, pas par morceau

L'écran de validation est refait :

- **une ligne par décision** — `Faux nom → Vrai nom`, avec le nombre de
  morceaux concernés et trois titres en exemple ;
- **tout est coché d'avance**, et tu **décoches ce qui te paraît faux** ;
- un **filtre** pour retrouver un nom dans la liste, **tout cocher** /
  **tout décocher** (qui n'agissent que sur ce que le filtre laisse voir), et un
  compteur de ce qui est retenu ;
- seul ce qui est coché est appliqué.

Ce qui est décoché **n'est pas perdu et n'est pas marqué** : la prochaine
vérification te le represésentera. Tu peux donc traiter en plusieurs fois, par
paquets de décisions que tu es sûr de vouloir.

Trois cents corrections deviennent ainsi une dizaine de décisions à prendre.

## 2. On peut tout défaire

Une correction en masse qu'on ne peut pas annuler est une correction qu'on
n'ose pas lancer — et quand on la lance quand même, on découvre l'erreur trop
tard. C'est exactement où tu en es.

Le serveur garde maintenant, pour chaque morceau touché, **ce qu'il était
avant** : son nom d'artiste, sa ligne de crédits, son identifiant. Un bouton
**« Annuler la dernière correction »** (dans les outils de la bibliothèque)
remet tout en place.

- il annonce **combien** de morceaux reviendraient en arrière et **depuis
  quelle correction** — date, heure, et qui l'a lancée ;
- il couvre **la passe entière**, pas le dernier envoi : une correction part en
  paquets de cinq cents, et ils s'annulent ensemble ;
- l'identifiant d'artiste revient lui aussi à ce qu'il était ;
- un seul niveau : c'est la **dernière** passe qu'on défait. Après annulation,
  il n'y a plus rien à annuler.

## Ce que je te conseille de faire

1. dépose les deux fichiers, recharge en **Ctrl+Maj+R** ;
2. **« Annuler la dernière correction »** si ta correction précédente t'a laissé
   un doute — tu repars propre ;
3. relance **Vérifier les artistes chez Apple**, et cette fois **lis les
   renommages** : décoche ce qui te choque, applique le reste. Recommence
   autant de fois que tu veux, ça converge ;
4. puis **Un nom, deux artistes** pour les homonymes façon SDM.
