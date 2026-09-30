// L'INTÉGRITÉ — ce qui ne doit ni s'injecter, ni se perdre, ni se tricher.
//
//   · une adresse de pochette piégée ne sort jamais de son attribut HTML ;
//   · réécrire une fiche joueur n'efface plus ce qu'un autre y a mis entre-temps
//     (une vente au marché, des jetons Stripe) ;
//   · un paiement Stripe dont le crédit a échoué en route est repris, une fois ;
//   · les goûts de départ ne se déclarent qu'une fois.
//
//   node test-integrite.mjs

import { rm } from "node:fs/promises";
import { createHmac } from "node:crypto";

process.env.DIGGERS_STORE = "fichiers";
process.env.DIGGERS_DATA = ".data-integrite";
process.env.DIGGERS_SECRET = "test";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
await rm(".data-integrite", { recursive: true, force: true });

const compte = (await import("./netlify/functions/compte.mjs")).default;
const jeu = (await import("./netlify/functions/jeu.mjs")).default;
const stripe = (await import("./netlify/functions/stripe.mjs")).default;
const biblio = await import("./netlify/functions/_biblio.mjs");
const { store } = await import("./netlify/functions/_store.mjs");
const L = await import("./netlify/functions/_lib.mjs");

let ko = 0, n = 0;
const R = (nom, v) => { n++; if (!v) ko++; console.log((v ? "  ok    " : "  ÉCHEC ") + nom); };

async function post(fn, corps, jeton, ip) {
  const h = { "content-type": "application/json" };
  if (jeton) h.authorization = "Bearer " + jeton;
  if (ip) h["x-nf-client-connection-ip"] = ip;
  const r = await fn(new Request("http://x/api", { method: "POST", headers: h, body: JSON.stringify(corps) }));
  return { code: r.status, ...(await r.json().catch(() => ({}))) };
}
async function webhook(objet) {
  const brut = JSON.stringify(objet), t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(t + "." + brut).digest("hex");
  const r = await stripe(new Request("http://x/api/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=" + t + ",v1=" + sig },
    body: brut
  }));
  return { code: r.status, ...(await r.json().catch(() => ({}))) };
}
let nIp = 0;
const inscrire = async p => (await post(compte,
  { action: "inscription", pseudo: p, mdp: "motdepasse1" }, null, "10.1." + (++nIp) + ".1")).jeton;
const uidDe = async p => (await (await store("pseudos")).get(L.norm(p))).uid;

const tracks = [];
["Sœur K", "Bloc 4", "Nina Rey", "Vaudou Club", "Le Perchoir", "Marda", "Kosmo", "Ivy Sax"]
  .forEach((a, i) => {
    for (let k = 0; k < 8; k++) tracks.push({
      id: "c" + i + "x" + k, title: "Titre " + i + "-" + k, artist: a,
      album: "Album " + i, genre: "Pop", year: 2000 + k, ms: 200000,
      art: "https://is1-ssl.mzstatic.com/image/thumb/x" + i + k + "/100x100bb.jpg",
      preview: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/" + i + k + ".m4a",
      url: "https://music.apple.com/fr/album/x/" + i + k,
      pop: [95, 82, 70, 58, 44, 30, 16, 4][k]
    });
  });
await biblio.ecrire({ meta: {}, tracks });

/* ============================================================ */
console.log("\n=== UNE ADRESSE PIÉGÉE ===");
{
  const piege = 'https://a.mzstatic.com/x"onerror="alert(1)';
  const t = { title: "a", artist: "b", preview: "https://a.mzstatic.com/p.m4a", art: piege,
    url: "https://music.apple.com/x", year: 2020, ms: 30000 };
  R("elle passe la vérification d'hôte", L.validerTrack(t) === null);
  const propre = L.nettoyerTrack(t).art;
  R("mais ressort sans guillemet", !propre.includes('"'));
  R("et pointe toujours chez Apple", new URL(propre).hostname === "a.mzstatic.com");
  R("une adresse illisible devient vide", L.urlPropre("pas une adresse") === "");
}

/* ============================================================ */
console.log("\n=== RÉÉCRIRE SANS EFFACER ===");
{
  const jV = await inscrire("Vendeur");
  const uid = await uidDe("Vendeur");
  await post(jeu, { action: "etat" }, jV);   // sa partie existe, comme pour tout vendeur
  // Une requête lit la fiche du vendeur…
  const lue = await L.utilisateur(uid);
  const depart = (lue.jeu && lue.jeu.credits) || 0;
  // …pendant ce temps, une vente le crédite et Stripe lui ajoute des jetons…
  await L.majJoueur(uid, f => {
    f.jeu = f.jeu || { credits: 0, coffre: [] };
    f.jeu.credits = (f.jeu.credits || 0) + 250;
    f.jeu.coffre = (f.jeu.coffre || []).concat({ uid: "recue", id: "c0x0", known: true });
    f.jetons = 650;
    return f;
  });
  // …puis la première requête termine son travail et réécrit.
  lue.jeu = lue.jeu || { credits: 0, coffre: [] };
  lue.jeu.credits = (lue.jeu.credits || 0) - 100;
  lue.jeu.coffre = (lue.jeu.coffre || []).concat({ uid: "ouverte", id: "c1x0", known: false });
  lue.profil = { ...(lue.profil || {}), bio: "nouvelle bio" };
  await L.ecrireUtilisateur(lue);

  const f = await (await store("utilisateurs")).get(uid);
  R("le prix de la vente est toujours là", f.jeu.credits === depart + 250 - 100);
  R("les jetons Stripe aussi", f.jetons === 650);
  R("la carte reçue n'a pas disparu", f.jeu.coffre.some(c => c.uid === "recue"));
  R("et la modification de la requête est bien passée",
    f.jeu.coffre.some(c => c.uid === "ouverte") && f.profil.bio === "nouvelle bio");
  R("la fiche de l'appelant montre l'état réel", lue.jetons === 650 && lue.jeu.credits === f.jeu.credits);
}
{
  // Une fiche effacée entre la lecture et l'écriture ne ressuscite pas.
  await inscrire("Fantome");
  const uid = await uidDe("Fantome");
  const lue = await L.utilisateur(uid);
  await (await store("utilisateurs")).del(uid);
  lue.profil = { bio: "je reviens" };
  await L.ecrireUtilisateur(lue);
  R("un compte effacé n'est pas recréé", (await (await store("utilisateurs")).get(uid)) === null);
}

/* ============================================================ */
console.log("\n=== STRIPE : UN CRÉDIT INTERROMPU EST REPRIS ===");
{
  await inscrire("Iris");
  const uid = await uidDe("Iris");
  const ev = {
    id: "evt_repris", type: "checkout.session.completed",
    data: { object: { payment_status: "paid", client_reference_id: uid, amount_total: 999, currency: "eur",
      metadata: { uid, pack: "sacoche", jetons: "650" } } }
  };
  // La trace a été posée, mais le crédit n'a jamais eu lieu (fonction coupée en route).
  await (await store("paiements")).set(ev.id, { uid, jetons: 650, date: Date.now(), credite: false });
  const r1 = await webhook(ev);
  let f = await (await store("utilisateurs")).get(uid);
  R("le nouvel envoi de Stripe crédite enfin", r1.credite === 650 && f.jetons === 650);
  const r2 = await Promise.all([webhook(ev), webhook(ev)]);
  f = await (await store("utilisateurs")).get(uid);
  R("et les envois suivants ne créditent plus", r2.every(x => x.code === 200 && !x.credite) && f.jetons === 650);
  R("la trace est marquée créditée", (await (await store("paiements")).get(ev.id)).credite === true);

  // Même si la trace dit « pas crédité » alors que la fiche l'a déjà encaissé.
  await (await store("paiements")).set(ev.id, { uid, jetons: 650, date: Date.now(), credite: false });
  await webhook(ev);
  f = await (await store("utilisateurs")).get(uid);
  R("un paiement déjà encaissé ne l'est jamais deux fois", f.jetons === 650 && f.achatsJetons === 1);
}

/* ============================================================ */
console.log("\n=== LES GOÛTS DE DÉPART ===");
{
  const j = await inscrire("Nouvelle");
  let r = await post(jeu, { action: "gouts", artistes: ["Sœur K"] }, j);
  R("on les déclare à l'arrivée", r.code === 200 && r.etat.gouts.length === 1);
  r = await post(jeu, { action: "gouts", artistes: ["Bloc 4"] }, j);
  R("mais une seule fois", r.code === 409);
  const k = await inscrire("Pressee");
  r = await post(jeu, { action: "gouts", artistes: [] }, k);
  r = await post(jeu, { action: "gouts", artistes: ["Bloc 4"] }, k);
  R("passer l'étape compte aussi comme une déclaration", r.code === 409);
}

console.log("\n" + (ko ? ko + " ÉCHEC(S) sur " + n : n + " vérifications, aucune erreur"));
await rm(".data-integrite", { recursive: true, force: true });
process.exit(ko ? 1 : 0);
