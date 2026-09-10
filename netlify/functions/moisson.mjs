// /api/moisson — piloter la moissonneuse depuis l'écran d'administration.
//
// La logique est dans _moisson.mjs, partagée avec la tâche planifiée : ce
// fichier n'est qu'une porte, et il vérifie qui frappe.

import { ok, ko, preflight, corps, authentifier } from "./_lib.mjs";
import * as M from "./_moisson.mjs";
import * as biblio from "./_biblio.mjs";

export const config = { path: "/api/moisson" };

export default async function (req) {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return ko(405, "méthode non autorisée");

  const u = await authentifier(req);
  if (!u) return ko(401, "Connexion expirée.");
  if (u.role !== "admin") return ko(403, "Réservé à l'administrateur.");

  const b = await corps(req);

  if (b.action === "etat") {
    const e = await M.lireEtat();
    const lib = await biblio.lire();
    return ok({ etat: resume(e), titres: lib.tracks.length, plafond: biblio.PLAFOND,
      graines: M.grainesToutes().length });
  }

  if (b.action === "demarrer") {
    const e = await M.demarrer(!!b.refaire);
    return ok({ etat: resume(e) });
  }

  if (b.action === "arreter") {
    return ok({ etat: resume(await M.arreter()) });
  }

  /* Un tour à la demande : c'est ce que l'écran d'admin appelle en boucle
     quand on veut aller vite, tab ouvert. Trois requêtes par tour, pas plus —
     au-delà on dépasse les dix secondes d'une fonction. */
  if (b.action === "tour") {
    const n = Math.min(4, Math.max(1, Number(b.n) || 3));
    const e = await M.unTour(n);
    const lib = await biblio.lire();
    return ok({ etat: resume(e), fait: e.fait || 0, recoltes: e.recoltes || 0,
      titres: lib.tracks.length });
  }

  return ko(400, "Action inconnue.");
}

/* Ce que l'écran a besoin de savoir, et rien de plus. */
function resume(e) {
  const total = e.phase === "artistes" ? e.file.length : M.grainesToutes().length;
  const fait = e.phase === "artistes" ? e.curseur : e.graine;
  return {
    actif: !!e.actif, phase: e.phase, fait, total,
    ajoutes: e.ajoutes || 0, enAttente: e.enAttente || 0,
    vus: e.vus || 0, requetes: e.requetes || 0,
    refuses: e.refuses || 0, erreurs: e.erreurs || 0,
    dernierEchec: e.dernierEchec || "",
    demarre: e.demarre || 0, dernier: e.dernier || 0,
    message: e.message || ""
  };
}
