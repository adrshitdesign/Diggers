// /api/catalogue — la bibliothèque entière, ouverte à tous, en lecture seule.
// C'est la source du jeu : le fichier catalogue.json n'est plus qu'un point
// de départ que l'on importe une fois depuis l'écran d'administration.

import { ok, preflight, ko } from "./_lib.mjs";
import { store } from "./_store.mjs";
import { lire } from "./_biblio.mjs";

export const config = { path: "/api/catalogue" };

export default async function (req) {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return ko(405, "méthode non autorisée");

  const b = await lire();
  // Les mentions légales sont publiques par nature : elles voyagent avec le catalogue,
  // ça évite un appel de plus au chargement du jeu.
  const editeur = await (await store("config")).get("editeur");
  return ok({ meta: { ...b.meta, source: "bibliothèque Diggers", editeur: editeur || null },
    tracks: b.tracks }, { "cache-control": "public, max-age=60" });
}
