// LA BIBLIOTHÈQUE — une seule entité.
// Tous les sons du jeu vivent ici : ceux importés au départ et ceux que la
// communauté fait entrer ensuite. Un seul enregistrement, lu et réécrit en
// entier : c'est ce qui rend la recherche, la correction et l'export immédiats.

import { store } from "./_store.mjs";
import { signature, validerTrack, norm } from "./_lib.mjs";

/* Combien de sons le jeu peut porter.
   Ce n'est pas un chiffre rond posé au hasard : la bibliothèque est un seul
   enregistrement, lu en entier à chaque requête. Jusqu'à la v2.5 elle était
   en plus renvoyée telle quelle à chaque joueur qui ouvrait le jeu — c'était
   ça, la vraie limite, et le plafond de 20 000 était le point où le site
   cassait. Le navigateur ne la reçoit plus (voir catalogue.mjs) et le serveur
   la garde quelques secondes en mémoire (voir lireCache ci-dessous), donc le
   plafond peut monter. À 50 000 sons l'enregistrement pèse ~28 Mo et se lit en
   130 ms : c'est encore raisonnable. Au-delà, il faudra le découper — et ce
   jour-là ce commentaire sera à réécrire, pas le chiffre à augmenter. */
export const PLAFOND = 50000;

const vide = () => ({ meta: { version: 2, maj: 0, titres: 0 }, tracks: [] });

export async function lire() {
  const s = await store("bibliotheque");
  let b = await s.get("tout");
  if (b && Array.isArray(b.tracks)) return b;

  // Reprise de l'ancien rangement (un enregistrement par son) : une fois, puis plus jamais.
  const C = await store("catalogue");
  const cles = await C.list("");
  const tracks = (await Promise.all(cles.map(k => C.get(k)))).filter(Boolean);
  b = { meta: { version: 2, maj: Date.now(), titres: tracks.length }, tracks };
  if (tracks.length) await s.set("tout", b);
  return b;
}

/* ---------------- la copie chaude ----------------
   Ouvrir un carton, jouer un set, afficher le marché : chacune de ces actions
   relisait la bibliothèque entière depuis le rangement. À 8 Mo c'était déjà
   du temps perdu à chaque clic ; à 28 Mo ce serait un jeu lent.

   On la garde donc quelques secondes en mémoire. Le compromis est explicite :
   un son ajouté peut mettre jusqu'à dix secondes à apparaître dans les tirages
   d'un autre serveur. Personne ne s'en aperçoit, et personne ne peut y perdre
   quoi que ce soit — les cartes déjà tirées ne dépendent pas de cette copie.

   La modération, elle, ne lit jamais la copie : quand on vient de retirer un
   son, on veut le voir disparaître tout de suite. Elle appelle lire(). */
const FRAICHEUR = 10000;
let memo = null, memoT = 0;

export async function lireCache() {
  if (memo && Date.now() - memoT < FRAICHEUR) return memo;
  const b = await lire();
  memo = b; memoT = Date.now();
  return b;
}

export async function ecrire(b) {
  /* Un numéro de version qui ne recule jamais. La date ne suffit pas : deux
     écritures dans la même milliseconde portent la même, et tout ce qui se
     cache sur cette clé sert alors une réponse périmée. */
  b.meta = { ...(b.meta || {}), version: 2, maj: Date.now(),
    rev: ((b.meta && b.meta.rev) || 0) + 1, titres: b.tracks.length,
    noyau: b.tracks.filter(t => t.source !== "communaute").length,
    communaute: b.tracks.filter(t => t.source === "communaute").length };
  await (await store("bibliotheque")).set("tout", b);
  // Celui qui vient d'écrire n'a aucune raison de lire une version périmée.
  memo = b; memoT = Date.now();
  return b;
}

/* L'ensemble des signatures : sert au pare-doublons des propositions. */
export function signatures(b) {
  return new Set(b.tracks.map(signature));
}

export async function ajouter(track) {
  const b = await lire();
  ENTIERS_IMPORT = await nomsEntiers();
  LIGNES_IMPORT = contexteImport(b, [track]);
  if (b.tracks.length >= PLAFOND) throw new Error("Bibliothèque pleine.");
  /* Même porte que l'import : une proposition validée ne peut pas entrer
     signée de deux noms. On rend la fiche telle qu'elle est rangée — c'est
     elle, et pas la version envoyée, qui part en récompense au trouveur. */
  const n = normaliserImport(track);
  /* normaliserImport range une fiche d'import : elle la marque « noyau » et
     ne connaît pas les champs d'une entrée communautaire. On lui emprunte ses
     garde-fous, pas son étiquette. */
  const propre = n
    ? { ...n, source: track.source || n.source, proposePar: track.proposePar,
        valideLe: track.valideLe, indice: track.indice || "" }
    : { ...track };
  const sig = signature(propre);
  const deja = b.tracks.find(t => signature(t) === sig);
  if (deja) return { b, ajoute: false, track: deja };
  b.tracks.push(propre);
  await ecrire(b);
  return { b, ajoute: true, track: propre };
}

export async function modifier(id, patch) {
  const b = await lire();
  const t = b.tracks.find(x => String(x.id) === String(id));
  if (!t) return null;
  if (patch.title)  t.title  = String(patch.title).slice(0, 160);
  if (patch.artist) t.artist = String(patch.artist).slice(0, 120);
  if (patch.genre)  t.genre  = String(patch.genre).slice(0, 60);
  if (patch.year)   t.year   = Math.max(1900, Math.min(new Date().getFullYear() + 1, Number(patch.year)));
  if (patch.indice !== undefined) t.indice = String(patch.indice).slice(0, 120);
  if (patch.pop !== undefined) {
    const p = Number(patch.pop);
    if (Number.isFinite(p)) t.pop = Math.max(0, Math.min(99, Math.round(p)));
  }
  await ecrire(b);
  return t;
}

export async function retirer(id) {
  const b = await lire();
  const i = b.tracks.findIndex(x => String(x.id) === String(id));
  if (i < 0) return null;
  const [t] = b.tracks.splice(i, 1);
  await ecrire(b);
  return t;
}

/* Import par tranches : le navigateur envoie le catalogue par paquets.
   Le premier paquet peut demander de repartir de zéro sur le noyau. */
/* Le contexte de l'import, relu une fois par lot et pas une fois par morceau.

   ENTIERS : les noms déclarés à la main.
   LIGNES  : combien de titres portent chaque signature — c'est ce qui
             distingue un groupe d'un featuring. Sans lui, la porte d'entrée
             découpait « Earth, Wind & Fire » : elle voyait bien un séparateur,
             mais elle ne pouvait pas savoir que quatre autres titres portaient
             la même signature. Le compte se fait donc sur la bibliothèque
             ACTUELLE plus le lot qui arrive : c'est la seule vue complète du
             moment, et elle suffit — quatre titres d'un groupe importés
             ensemble se reconnaissent entre eux. */
let ENTIERS_IMPORT = new Set();
let LIGNES_IMPORT = new Map();

function contexteImport(bibliotheque, lot) {
  const m = new Map();
  const compter = t => {
    if (!t || !t.artist) return;
    const k = norm(t.artist);
    m.set(k, (m.get(k) || 0) + 1);
  };
  for (const t of (bibliotheque.tracks || [])) compter(t);
  for (const t of (lot || [])) compter(t);
  return m;
}

export async function importer(tracks, remplacerNoyau) {
  const b = await lire();
  ENTIERS_IMPORT = await nomsEntiers();
  LIGNES_IMPORT = contexteImport(b, tracks);
  if (remplacerNoyau) b.tracks = b.tracks.filter(t => t.source === "communaute");

  const vus = signatures(b);
  let ajoutes = 0, ignores = 0, refuses = 0;

  for (const brut of (tracks || [])) {
    if (b.tracks.length >= PLAFOND) break;
    const t = normaliserImport(brut);
    if (!t) { refuses++; continue; }
    const sig = signature(t);
    if (vus.has(sig)) { ignores++; continue; }
    vus.add(sig);
    b.tracks.push(t);
    ajoutes++;
  }
  await ecrire(b);
  return { ajoutes, ignores, refuses, total: b.tracks.length };
}

/* On garde l'identifiant d'origine : les sauvegardes des joueurs s'y réfèrent. */
function normaliserImport(t) {
  if (!t || t.id === undefined || t.id === null) return null;
  /* LA PORTE D'ENTRÉE. Jusqu'ici, le garde-fou « un seul artiste par carte »
     vivait dans le constructeur, côté navigateur : tout ce qui entrait par un
     autre chemin (import de fichier, proposition validée, script) pouvait
     déposer « GIMS & Dadju » en base, et il fallait repasser derrière avec le
     bouton de réparation. Il est maintenant ici, sur le seul passage que tout
     le monde emprunte. */
  const signe = String(t.artist || "").trim().slice(0, 120);
  const seul = artistePrincipal(signe, { entiers: ENTIERS_IMPORT, lignes: LIGNES_IMPORT });
  const c = {
    id: t.id,
    title: String(t.title || "").trim().slice(0, 160),
    artist: seul || signe,
    // la ligne complète ne se perd pas : elle s'affiche sous la carte retournée
    credits: t.credits ? String(t.credits).slice(0, 160) : (seul ? signe : ""),
    album: t.album ? String(t.album).slice(0, 160) : "",
    genre: t.genre ? String(t.genre).slice(0, 60) : "Autre",
    year: Number(t.year) || null,
    ms: Number(t.ms) || 0,
    art: String(t.art || ""),
    preview: String(t.preview || ""),
    url: String(t.url || ""),
    poids: Number(t.poids) || 2,
    rank: Number(t.rank) || 0,
    // Une popularité absente n'est pas une raison d'écarter un son : une liste
    // collée à la main n'en porte jamais. On prend le milieu de l'échelle.
    pop: Math.max(0, Math.min(99, Math.round(Number.isFinite(Number(t.pop)) ? Number(t.pop) : 50))),
    source: "noyau"
  };
  if (!Number.isFinite(c.pop)) return null;
  if (!c.year) c.year = 2000;
  if (!c.ms) c.ms = 180000;
  if (validerTrack(c)) return null;      // mêmes garde-fous que pour une proposition
  return c;
}

export async function vider(source) {
  const b = await lire();
  const avant = b.tracks.length;
  b.tracks = source ? b.tracks.filter(t => (t.source || "noyau") !== source) : [];
  await ecrire(b);
  return { retires: avant - b.tracks.length, total: b.tracks.length };
}


/* ============================================================
   UN SEUL ARTISTE PAR CARTE — la réparation
   ------------------------------------------------------------
   Le jeu demande « c'est qui ? » et propose quatre noms. Une carte signée
   « GIMS & Dadju » n'a aucune bonne réponse : la vraie n'est pas dans la
   liste. Les cartes entrées avant la v2.2 portent la ligne de crédits
   complète d'Apple ; celles d'après portent déjà un seul nom.

   LA RÈGLE (v2.7) : le PREMIER artiste crédité possède le morceau.
   « A & B », « A feat. B », « A, B » — c'est A, toujours. C'est la convention
   de l'industrie, c'est ce qu'attend un joueur, et c'est déterministe : le
   même morceau tombe toujours sur le même artiste.

   Avant la v2.7 on gardait le plus CONNU des noms cités. C'était plus malin
   et c'était une erreur : « Mairo & H JeuneCrack » partait chez H JeuneCrack
   si celui-ci avait plus de titres, et le même morceau pouvait changer de
   propriétaire à mesure que la bibliothèque grossissait.

   La ligne complète part dans les crédits, affichée une fois la carte
   retournée : personne n'est effacé, mais une seule bonne réponse existe.

   Deux cartes peuvent alors se retrouver identiques (« Ninho & Gazo » et
   « Gazo & Ninho » deviennent le même morceau) : la seconde disparaît.
   ============================================================ */

const SEP_ARTISTES = /\s*(?:,|&|\/|\bfeat\.?|\bft\.?|\bfeaturing\b|\bavec\b|\bwith\b|\bvs\.?|\bx\b|\+)\s*/i;
const SEP_ARTISTES_G = new RegExp(SEP_ARTISTES.source, "gi");

export const plusieursArtistes = nom => SEP_ARTISTES.test(String(nom || ""));

export function decouper(nom) {
  return String(nom || "").split(SEP_ARTISTES_G).map(x => x.trim()).filter(Boolean);
}

/* Le premier nom cité. C'est tout. */
export function principal(ligne) {
  const parts = decouper(ligne);
  if (parts.length < 2) return null;
  return parts[0];
}

/* « feat. », « ft. », « featuring », « avec », « with », « vs » ne laissent
   aucun doute : c'est une collaboration, jamais un nom de groupe. Sur ces
   lignes-là on découpe sans hésiter. */
const MOT_FEAT = /\b(?:feat\.?|ft\.?|featuring|avec|with|vs\.?)\b/i;
export const collaborationExplicite = nom => MOT_FEAT.test(String(nom || ""));

/* Les noms qu'on ne découpe jamais, quoi qu'il arrive. « Earth, Wind & Fire »
   est un groupe ; le ramener à « Earth » serait pire que de ne rien faire.
   Le garde-fou automatique ci-dessous en attrape la plupart, mais un duo qui
   n'a que deux titres dans le jeu lui échappe : cette liste est là pour ça,
   et elle se remplit depuis l'écran de modération. */
export async function nomsEntiers() {
  const c = await (await store("config")).get("noms-entiers");
  const l = (c && Array.isArray(c.noms)) ? c.noms : [];
  return new Set(l.map(norm));
}

/* Le garde-fou automatique : une ligne de featuring se répète rarement d'un
   titre à l'autre, un nom de groupe se répète à chaque titre. Au-delà de ce
   seuil, on considère que c'est un nom et pas une collaboration — sauf si la
   ligne porte un « feat. », qui tranche la question. */
export const SEUIL_GROUPE = 3;

/* Faut-il découper cette ligne, et si oui en quoi ?
   Une seule fonction, pour que l'import, la réparation et l'aperçu répondent
   exactement la même chose. */
export function artistePrincipal(ligne, { lignes, entiers } = {}) {
  const nom = String(ligne || "");
  if (!plusieursArtistes(nom)) return null;
  if (entiers && entiers.has(norm(nom))) return null;          // exception déclarée
  const explicite = collaborationExplicite(nom);
  if (!explicite && lignes && (lignes.get(norm(nom)) || 0) >= SEUIL_GROUPE) return null;  // un groupe
  const seul = principal(nom);
  return (seul && norm(seul) !== norm(nom)) ? seul : null;
}

/* Combien de titres portent EXACTEMENT cette ligne : un groupe se répète
   d'un titre à l'autre, une collaboration presque jamais. */
function comptageLignes(tracks) {
  const lignes = new Map();
  for (const t of tracks) {
    const k = norm(t.artist);
    lignes.set(k, (lignes.get(k) || 0) + 1);
  }
  return lignes;
}

export function canoniser(tracks, entiers) {
  const lignes = comptageLignes(tracks);
  // on ramène chaque ligne à un seul nom, puis on jette les doublons
  const vus = new Set(), sortie = [];
  let corriges = 0, fusionnes = 0;
  for (const t of tracks) {
    let c = t, change = false;
    const seul = artistePrincipal(t.artist, { lignes, entiers });
    if (seul) { c = { ...t, artist: seul, credits: t.credits || t.artist }; change = true; }
    const sig = signature(c);
    // Une carte qui disparaît n'est pas « corrigée » : elle est fusionnée.
    // Les deux compteurs ne doivent pas raconter la même carte deux fois.
    if (vus.has(sig)) { fusionnes++; continue; }
    vus.add(sig);
    if (change) corriges++;
    sortie.push(c);
  }
  return { tracks: sortie, corriges, fusionnes };
}

/* Ce que la réparation ferait, sans rien changer : de quoi regarder avant
   d'appuyer. */
export function apercuArtistes(tracks, entiers) {
  const lignes = comptageLignes(tracks);
  const touchees = tracks.filter(t => !!artistePrincipal(t.artist, { lignes, entiers }));
  /* Ce qu'on laisse tel quel : des groupes, ou des noms déclarés entiers. On
     les nomme, pour que la modération puisse vérifier qu'il n'y a pas
     d'erreur là-dedans plutôt que de lire un simple compteur. */
  const gardees = tracks.filter(t => plusieursArtistes(t.artist)
    && !artistePrincipal(t.artist, { lignes, entiers }));
  /* On annonce exactement les chiffres que la réparation rendra, sinon
     l'aperçu et le résultat se contredisent sous les yeux de la modération. */
  const r = canoniser(tracks, entiers);
  return {
    total: tracks.length,
    aCorriger: r.corriges,
    laissees: gardees.length,
    aFusionner: r.fusionnes,
    exemples: touchees.slice(0, 30).map(t => ({
      titre: t.title, avant: t.artist, apres: artistePrincipal(t.artist, { lignes, entiers })
    })),
    // les noms qu'on garde entiers, chacun une fois, avec leur nombre de titres
    groupes: [...new Map(gardees.map(t => [norm(t.artist),
      { nom: t.artist, titres: lignes.get(norm(t.artist)) || 1 }])).values()].slice(0, 60)
  };
}

/* La même chose, mais sur la bibliothèque enregistrée. */
export async function reparerArtistes() {
  const b = await lire();
  const entiers = await nomsEntiers();
  const avant = b.tracks.length;
  const r = canoniser(b.tracks, entiers);
  b.tracks = r.tracks;
  await ecrire(b);
  return { corriges: r.corriges, fusionnes: r.fusionnes, avant, total: b.tracks.length };
}
