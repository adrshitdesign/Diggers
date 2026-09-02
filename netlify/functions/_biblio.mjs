// LA BIBLIOTHÈQUE — une seule entité.
// Tous les sons du jeu vivent ici : ceux importés au départ et ceux que la
// communauté fait entrer ensuite. Un seul enregistrement, lu et réécrit en
// entier : c'est ce qui rend la recherche, la correction et l'export immédiats.

import { store } from "./_store.mjs";
import { signature, validerTrack, norm } from "./_lib.mjs";

export const PLAFOND = 20000;

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

export async function ecrire(b) {
  b.meta = { ...(b.meta || {}), version: 2, maj: Date.now(), titres: b.tracks.length,
    noyau: b.tracks.filter(t => t.source !== "communaute").length,
    communaute: b.tracks.filter(t => t.source === "communaute").length };
  await (await store("bibliotheque")).set("tout", b);
  return b;
}

/* L'ensemble des signatures : sert au pare-doublons des propositions. */
export function signatures(b) {
  return new Set(b.tracks.map(signature));
}

export async function ajouter(track) {
  const b = await lire();
  if (b.tracks.length >= PLAFOND) throw new Error("Bibliothèque pleine.");
  const sig = signature(track);
  if (b.tracks.some(t => signature(t) === sig)) return { b, ajoute: false };
  b.tracks.push(track);
  await ecrire(b);
  return { b, ajoute: true };
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
export async function importer(tracks, remplacerNoyau) {
  const b = await lire();
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
  const c = {
    id: t.id,
    title: String(t.title || "").trim().slice(0, 160),
    artist: String(t.artist || "").trim().slice(0, 120),
    credits: t.credits ? String(t.credits).slice(0, 160) : "",
    album: t.album ? String(t.album).slice(0, 160) : "",
    genre: t.genre ? String(t.genre).slice(0, 60) : "Autre",
    year: Number(t.year) || null,
    ms: Number(t.ms) || 0,
    art: String(t.art || ""),
    preview: String(t.preview || ""),
    url: String(t.url || ""),
    poids: Number(t.poids) || 2,
    rank: Number(t.rank) || 0,
    pop: Math.max(0, Math.min(99, Math.round(Number(t.pop)))),
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

   La règle de réparation : on découpe la ligne, et on garde celui des noms
   qui existe DÉJÀ comme artiste seul dans la bibliothèque — celui qui a le
   plus de titres à son nom, donc celui que les joueurs reconnaissent. La
   ligne complète part dans les crédits, affichée une fois la carte retournée.

   Deux cartes peuvent alors se retrouver identiques (« Ninho & Gazo » et
   « Gazo & Ninho » deviennent le même morceau) : la seconde disparaît.
   ============================================================ */

const SEP_ARTISTES = /\s*(?:,|&|\/|\bfeat\.?|\bft\.?|\bfeaturing\b|\bavec\b|\bwith\b|\bvs\.?|\bx\b|\+)\s*/i;
const SEP_ARTISTES_G = new RegExp(SEP_ARTISTES.source, "gi");

export const plusieursArtistes = nom => SEP_ARTISTES.test(String(nom || ""));

export function decouper(nom) {
  return String(nom || "").split(SEP_ARTISTES_G).map(x => x.trim()).filter(Boolean);
}

/* Qui est l'artiste principal de cette ligne ? Celui qui, parmi les noms
   cités, a déjà le plus de titres SEUL dans la bibliothèque.

   Et sinon : personne. On ne devine pas. « Earth, Wind & Fire » contient des
   séparateurs mais c'est un groupe, pas un featuring — le renommer « Earth »
   serait pire que le laisser tel quel. Tant qu'aucun des noms cités n'est un
   artiste connu du jeu, on ne touche à rien. */
export function principal(ligne, solos) {
  const parts = decouper(ligne);
  if (parts.length < 2) return null;
  let meilleur = null, score = 0;
  for (const p of parts) {
    const s = solos.get(norm(p));
    if (s && s.compte > score) { meilleur = s.nom; score = s.compte; }
  }
  return meilleur;
}

/* Un deuxième garde-fou, pour les groupes que le jeu ne connaît pas encore :
   une ligne de featuring se répète rarement d'un titre à l'autre, un nom de
   groupe se répète à chaque titre. Au-delà de ce seuil, on considère que
   c'est un nom, pas une collaboration. */
export const SEUIL_GROUPE = 3;

export function canoniser(tracks) {
  // 1. qui est déjà un artiste seul, et avec combien de titres
  const solos = new Map();
  for (const t of tracks) {
    if (plusieursArtistes(t.artist)) continue;
    const k = norm(t.artist);
    const e = solos.get(k) || { nom: t.artist, compte: 0 };
    e.compte++;
    solos.set(k, e);
  }

  // 1 bis. combien de titres portent EXACTEMENT cette ligne : un groupe se
  // répète, une collaboration presque jamais
  const lignes = new Map();
  for (const t of tracks) {
    const k = norm(t.artist);
    lignes.set(k, (lignes.get(k) || 0) + 1);
  }

  // 2. on ramène chaque ligne à un seul nom, puis on jette les doublons
  const vus = new Set(), sortie = [];
  let corriges = 0, fusionnes = 0;
  for (const t of tracks) {
    let c = t, change = false;
    if (plusieursArtistes(t.artist) && (lignes.get(norm(t.artist)) || 0) < SEUIL_GROUPE) {
      const seul = principal(t.artist, solos);
      if (seul && norm(seul) !== norm(t.artist)) {
        c = { ...t, artist: seul, credits: t.credits || t.artist };
        change = true;
      }
    }
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
export function apercuArtistes(tracks) {
  const solos = new Map();
  for (const t of tracks) {
    if (plusieursArtistes(t.artist)) continue;
    const k = norm(t.artist);
    const e = solos.get(k) || { nom: t.artist, compte: 0 };
    e.compte++; solos.set(k, e);
  }
  const lignes = new Map();
  for (const t of tracks) {
    const k = norm(t.artist);
    lignes.set(k, (lignes.get(k) || 0) + 1);
  }
  // seules comptent celles qu'on saurait vraiment corriger
  const touchees = tracks.filter(t => plusieursArtistes(t.artist)
    && (lignes.get(norm(t.artist)) || 0) < SEUIL_GROUPE
    && !!principal(t.artist, solos));
  const laissees = tracks.filter(t => plusieursArtistes(t.artist)).length - touchees.length;
  /* On annonce exactement les chiffres que la réparation rendra, sinon
     l'aperçu et le résultat se contredisent sous les yeux de la modération. */
  const r = canoniser(tracks);
  return {
    total: tracks.length,
    aCorriger: r.corriges,
    laissees,                       // groupes et duos dont aucun membre n'est connu du jeu
    aFusionner: r.fusionnes,
    exemples: touchees.slice(0, 30).map(t => ({
      titre: t.title, avant: t.artist, apres: principal(t.artist, solos)
    }))
  };
}

/* La même chose, mais sur la bibliothèque enregistrée. */
export async function reparerArtistes() {
  const b = await lire();
  const avant = b.tracks.length;
  const r = canoniser(b.tracks);
  b.tracks = r.tracks;
  await ecrire(b);
  return { corriges: r.corriges, fusionnes: r.fusionnes, avant, total: b.tracks.length };
}
