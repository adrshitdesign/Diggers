// /api/crews — les collectifs. Un code à six signes, vingt places, un chef.

import { store } from "./_store.mjs";
import { ok, ko, preflight, corps, authentifier, ecrireUtilisateur, utilisateur, uuid } from "./_lib.mjs";

export const config = { path: "/api/crews" };

const PLACES = 20;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // sans I, O, 0, 1

function codeNeuf() {
  let c = "";
  for (let i = 0; i < 6; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return c;
}

async function vue(crew) {
  const R = await store("classement");
  const membres = (await Promise.all(crew.membres.map(uid => R.get(uid)))).filter(Boolean);
  membres.sort((a, b) => (b.taux ?? -1) - (a.taux ?? -1) || b.cartes - a.cartes);
  const cartes = membres.reduce((a, m) => a + (m.cartes || 0), 0);
  const taux = membres.filter(m => m.taux != null);
  return {
    id: crew.id, nom: crew.nom, code: crew.code, chef: crew.chef, cree: crew.cree,
    places: PLACES, membres: membres.map(m => ({ uid: m.uid, pseudo: m.pseudo, couleur: m.couleur,
      titre: m.titre, cartes: m.cartes, taux: m.taux, meilleurSet: m.meilleurSet, validees: m.validees })),
    total: { cartes, taux: taux.length ? Math.round(taux.reduce((a, m) => a + m.taux, 0) / taux.length) : null,
      validees: membres.reduce((a, m) => a + (m.validees || 0), 0) }
  };
}

export default async function (req) {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return ko(405, "méthode non autorisée");

  const u = await authentifier(req);
  if (!u) return ko(401, "Il faut un compte pour rejoindre un crew.");
  const b = await corps(req);
  const C = await store("crews");
  const IDX = await store("codes");

  if (b.action === "mien") {
    if (!u.crew) return ok({ crew: null });
    const c = await C.get(u.crew);
    if (!c) { u.crew = null; await ecrireUtilisateur(u); return ok({ crew: null }); }
    return ok({ crew: await vue(c), chef: c.chef === u.uid });
  }

  if (b.action === "creer") {
    if (u.crew) return ko(409, "Tu es déjà dans un crew. Quitte-le d'abord.");
    const nom = String(b.nom || "").trim().slice(0, 28);
    if (nom.length < 3) return ko(400, "Le nom du crew fait 3 signes au minimum.");
    let code = codeNeuf();
    for (let i = 0; i < 8 && await IDX.get(code); i++) code = codeNeuf();
    if (await IDX.get(code)) return ko(503, "Réessaie dans un instant.");
    const c = { id: uuid(), nom, code, chef: u.uid, membres: [u.uid], cree: Date.now() };
    await C.set(c.id, c);
    await IDX.set(code, { id: c.id });
    u.crew = c.id; await ecrireUtilisateur(u);
    return ok({ crew: await vue(c), chef: true });
  }

  if (b.action === "rejoindre") {
    if (u.crew) return ko(409, "Tu es déjà dans un crew.");
    const code = String(b.code || "").trim().toUpperCase();
    const p = await IDX.get(code);
    if (!p) return ko(404, "Ce code ne correspond à aucun crew.");
    const c = await C.get(p.id);
    if (!c) return ko(404, "Ce crew n'existe plus.");
    if (c.membres.length >= PLACES) return ko(409, "Ce crew est complet.");
    if (!c.membres.includes(u.uid)) c.membres.push(u.uid);
    await C.set(c.id, c);
    u.crew = c.id; await ecrireUtilisateur(u);
    return ok({ crew: await vue(c), chef: c.chef === u.uid });
  }

  if (b.action === "quitter") {
    if (!u.crew) return ko(400, "Tu n'es dans aucun crew.");
    const c = await C.get(u.crew);
    if (c) {
      c.membres = c.membres.filter(x => x !== u.uid);
      if (!c.membres.length) { await C.del(c.id); await IDX.del(c.code); }
      else { if (c.chef === u.uid) c.chef = c.membres[0]; await C.set(c.id, c); }
    }
    u.crew = null; await ecrireUtilisateur(u);
    return ok({ crew: null });
  }

  if (b.action === "renommer") {
    if (!u.crew) return ko(400, "Tu n'es dans aucun crew.");
    const c = await C.get(u.crew);
    if (!c || c.chef !== u.uid) return ko(403, "Seul le chef renomme le crew.");
    const nom = String(b.nom || "").trim().slice(0, 28);
    if (nom.length < 3) return ko(400, "Le nom du crew fait 3 signes au minimum.");
    c.nom = nom; await C.set(c.id, c);
    return ok({ crew: await vue(c), chef: true });
  }

  if (b.action === "exclure") {
    if (!u.crew) return ko(400, "Tu n'es dans aucun crew.");
    const c = await C.get(u.crew);
    if (!c || c.chef !== u.uid) return ko(403, "Seul le chef exclut.");
    const cible = await utilisateur(String(b.uid || ""));
    if (!cible || cible.crew !== c.id) return ko(404, "Ce membre n'est pas dans le crew.");
    if (cible.uid === u.uid) return ko(400, "Pour partir, utilise « quitter ».");
    c.membres = c.membres.filter(x => x !== cible.uid);
    await C.set(c.id, c);
    cible.crew = null; await ecrireUtilisateur(cible);
    return ok({ crew: await vue(c), chef: true });
  }

  if (b.action === "palmares") {
    const ids = await C.list("");
    const tous = (await Promise.all(ids.map(i => C.get(i)))).filter(Boolean);
    const vues = await Promise.all(tous.map(vue));
    vues.sort((a, b2) => (b2.total.taux ?? -1) - (a.total.taux ?? -1) || b2.total.cartes - a.total.cartes);
    return ok({ crews: vues.slice(0, 30).map(v => ({ nom: v.nom, membres: v.membres.length,
      cartes: v.total.cartes, taux: v.total.taux, validees: v.total.validees })) });
  }

  return ko(400, "Action inconnue.");
}
