// /api/stripe — l'oreille qui écoute la caisse.
//
// C'est le seul endroit qui crédite des jetons. Le navigateur ne peut pas le
// faire : il n'a aucune action pour ça, et cette porte-ci ne s'ouvre qu'à un
// message signé par Stripe.
//
// Trois précautions, dans cet ordre :
//   1. la signature est vérifiée avant de lire quoi que ce soit ;
//   2. l'horodatage doit être récent, sinon un message capté hier pourrait être
//      rejoué aujourd'hui ;
//   3. chaque événement n'est traité qu'une fois — Stripe réessaie quand il
//      n'obtient pas de réponse, et deux crédits pour un paiement, c'est un bug
//      qui se répare à la main.

import { createHmac, timingSafeEqual } from "node:crypto";
import { store, majAtomique } from "./_store.mjs";
import { ok, ko, preflight, majJoueur } from "./_lib.mjs";

export const config = { path: "/api/stripe" };

const TOLERANCE = 300;   // cinq minutes

export function verifierSignature(brut, entete, secret) {
  if (!brut || !entete || !secret) return { ok: false, raison: "signature absente" };
  const parts = Object.fromEntries(String(entete).split(",").map(x => x.split("=", 2)));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > TOLERANCE) return { ok: false, raison: "horodatage trop vieux" };
  const attendu = createHmac("sha256", secret).update(t + "." + brut).digest("hex");
  const donne = String(parts.v1 || "");
  if (donne.length !== attendu.length) return { ok: false, raison: "signature invalide" };
  if (!timingSafeEqual(Buffer.from(donne), Buffer.from(attendu))) return { ok: false, raison: "signature invalide" };
  return { ok: true };
}

export default async function (req) {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return ko(405, "méthode non autorisée");

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return ko(503, "Aucune caisse configurée.");

  const brut = await req.text();
  const v = verifierSignature(brut, req.headers.get("stripe-signature"), secret);
  if (!v.ok) return ko(400, "Message refusé : " + v.raison);

  let ev = null;
  try { ev = JSON.parse(brut); } catch { return ko(400, "Message illisible."); }
  if (!ev || !ev.id) return ko(400, "Message vide.");

  // On ne traite que la fin d'un paiement réussi ; le reste est acquitté sans rien faire.
  if (ev.type !== "checkout.session.completed") return ok({ ignore: ev.type });

  const journal = await store("paiements");
  const connu = await journal.get(ev.id);
  if (connu && (connu.credite || connu.orphelin)) return ok({ deja: true });

  const s = ev.data && ev.data.object;
  const m = (s && s.metadata) || {};
  const uid = String(m.uid || s.client_reference_id || "");
  const jetons = Math.max(0, Math.min(100000, Number(m.jetons) || 0));
  if (s && s.payment_status !== "paid") return ok({ ignore: "non payé" });
  if (!uid || !jetons) return ok({ ignore: "message sans destinataire" });

  /* On POSE LA TRACE D'ABORD, et seulement si elle n'existait pas.
     Stripe réessaie quand il n'obtient pas de réponse à temps : deux messages
     identiques peuvent arriver en même temps, et le simple « je regarde puis
     j'écris » d'avant laissait passer les deux — donc deux fois les jetons
     pour un seul paiement. Ici, un seul des deux gagne cette écriture. */
  const trace = await majAtomique("paiements", ev.id, (deja) => {
    // Une trace déjà là mais jamais créditée : un envoi précédent a échoué
    // en route, on reprend le travail au lieu de le déclarer fait.
    if (deja) return (deja.credite || deja.orphelin) ? null : deja;
    return {
      uid, jetons, pack: m.pack || "", date: Date.now(),
      montant: (s && s.amount_total) || 0, devise: (s && s.currency) || "eur",
      credite: false
    };
  });
  if (!trace.ecrit) return ok({ deja: true });

  /* Le crédit ne passe qu'une fois, même si deux reprises arrivent ensemble :
     la fiche du joueur garde elle-même la liste des paiements déjà encaissés,
     et le contrôle se fait dans la même écriture que l'ajout des jetons. */
  let dejaEncaisse = false;
  const r = await majJoueur(uid, (f) => {
    const vus = Array.isArray(f.paiementsEncaisses) ? f.paiementsEncaisses : [];
    if (vus.includes(ev.id)) { dejaEncaisse = true; return null; }
    f.jetons = Math.max(0, Number(f.jetons) || 0) + jetons;
    f.achatsJetons = (f.achatsJetons || 0) + 1;
    f.paiementsEncaisses = vus.concat(ev.id).slice(-100);
    return f;
  });
  if (!r.ecrit && !dejaEncaisse) {
    if (r.raison === "abandon") {
      // Le compte a été effacé entre le paiement et le message : on garde la
      // trace pour pouvoir rembourser, mais on ne crédite personne.
      await majAtomique("paiements", ev.id, (t) => ({ ...(t || {}), orphelin: true }));
      return ok({ orphelin: true });
    }
    /* Le compte existe mais l'écriture n'est pas passée (trop de requêtes au
       même moment). Avant, on répondait 200 en le marquant « orphelin » :
       Stripe ne réessayait jamais et les jetons payés étaient perdus. On
       répond maintenant en erreur, et Stripe renverra le message. */
    return ko(503, "Crédit non enregistré, Stripe va réessayer.");
  }
  await majAtomique("paiements", ev.id, (t) => ({ ...(t || {}), credite: true }));
  return ok(dejaEncaisse ? { deja: true } : { credite: jetons });
}
