// LA BIBLIOTHÈQUE — une seule entité.
// Tous les sons du jeu vivent ici : ceux importés au départ et ceux que la
// communauté fait entrer ensuite. Un seul enregistrement, lu et réécrit en
// entier : c'est ce qui rend la recherche, la correction et l'export immédiats.

import { store } from "./_store.mjs";
import { signature, validerTrack } from "./_lib.mjs";

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
