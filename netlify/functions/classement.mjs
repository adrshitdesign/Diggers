// /api/classement — le vrai classement, alimenté par les sauvegardes serveur.

import { store } from "./_store.mjs";
import { ok, preflight, ko } from "./_lib.mjs";

export const config = { path: "/api/classement" };

const MINI_CARTES = 10;   // en dessous, on ne classe pas : le taux ne veut rien dire

export default async function (req) {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return ko(405, "méthode non autorisée");

  const C = await store("classement");
  const cles = await C.list("");
  const tout = (await Promise.all(cles.map(k => C.get(k)))).filter(Boolean);

  const oreille = tout.filter(x => x.taux != null && x.cartes >= MINI_CARTES)
    .sort((a, b) => b.taux - a.taux || b.cartes - a.cartes).slice(0, 50);
  const collection = tout.slice().sort((a, b) => b.cartes - a.cartes).slice(0, 50);
  const set = tout.filter(x => x.meilleurSet > 0).sort((a, b) => b.meilleurSet - a.meilleurSet).slice(0, 50);
  const defricheurs = tout.filter(x => x.validees > 0).sort((a, b) => b.validees - a.validees).slice(0, 50);

  const alleger = l => l.map(x => ({ pseudo: x.pseudo, couleur: x.couleur, titre: x.titre,
    taux: x.taux, cartes: x.cartes, meilleurSet: x.meilleurSet, serie: x.serie, validees: x.validees }));

  return ok({ joueurs: tout.length, oreille: alleger(oreille), collection: alleger(collection),
    set: alleger(set), defricheurs: alleger(defricheurs) },
    { "cache-control": "public, max-age=30" });
}
