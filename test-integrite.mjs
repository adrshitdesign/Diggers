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

/* ============================================================ */
console.log("\n=== LA BIBLIOTHÈQUE : UN SEUL ÉCRIVAIN À LA FOIS ===");
{
  const avant = (await biblio.lire()).tracks.length;
  const son = i => ({ ...tracks[0], id: "simul" + i, title: "Simultané " + i, artist: "Artiste simultané " + i });
  // cinq imports lancés ensemble : avant, chacun repartait de sa lecture et effaçait les autres
  await Promise.all([0, 1, 2, 3, 4].map(i => biblio.importer([son(i)])));
  const lib = await biblio.lire();
  R("cinq imports simultanés entrent tous les cinq", lib.tracks.length === avant + 5);
  // un retrait et un ajout croisés
  await Promise.all([biblio.retirer("simul0"), biblio.importer([son(9)])]);
  const lib2 = await biblio.lire();
  R("un retrait et un ajout croisés passent tous les deux",
    !lib2.tracks.some(t => t.id === "simul0") && lib2.tracks.some(t => t.id === "simul9"));
}

/* ============================================================ */
console.log("\n=== LA MOISSONNEUSE ===");
{
  const M = await import("./netlify/functions/_moisson.mjs");
  M.reglerSeuil(1);   // on verse à chaque tour, pour voir la récolte arriver
  // Apple, simulé : chaque appel rend un morceau neuf, après un temps de réponse.
  let appels = 0, delai = 300;
  const vraiFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (!String(url).includes("itunes.apple.com")) return vraiFetch(url);
    const k = ++appels;
    await new Promise(r => setTimeout(r, delai));
    return new Response(JSON.stringify({ results: [{
      wrapperType: "track", kind: "song", trackId: 900000 + k, artistId: 700000 + k,
      trackName: "Moisson " + k, artistName: "Artiste moissonné " + k, collectionName: "Album",
      primaryGenreName: "Pop", releaseDate: "2020-01-01T00:00:00Z", trackTimeMillis: 200000,
      artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/m" + k + "/100x100bb.jpg",
      previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/m" + k + ".m4a",
      trackViewUrl: "https://music.apple.com/fr/album/m/" + k }] }), { status: 200 });
  };

  await M.demarrer(true);
  const [t1, t2] = await Promise.all([M.unTour(1), M.unTour(1)]);
  R("deux tours lancés ensemble : un seul interroge Apple", appels === 1);
  R("l'autre le dit et rend la main", [t1, t2].some(t => t.note === "un tour est déjà en cours"));
  const lib = await biblio.lire();
  R("la récolte du tour entre dans la bibliothèque", lib.tracks.some(t => t.title === "Moisson 1"));

  // « Arrêter » pendant qu'un tour est en vol : c'est l'arrêt qui gagne.
  delai = 500;
  const enVol = M.unTour(1);
  await new Promise(r => setTimeout(r, 150));
  await M.arreter();
  await enVol;
  const e = await M.lireEtat();
  R("« Arrêter » pendant un tour arrête vraiment", e.actif === false);
  R("et la récolte de ce tour n'est pas perdue",
    (await biblio.lire()).tracks.some(t => t.title === "Moisson 2"));
  const apres = appels;
  await M.unTour(1);
  R("un tour après l'arrêt ne fait rien", appels === apres);

  globalThis.fetch = vraiFetch;
  M.reglerSeuil(2500);
}

/* ============================================================ */
console.log("\n=== UN PSEUDO, UN SEUL COMPTE ===");
{
  let nIp2 = 0;
  const essai = p => post(compte, { action: "inscription", pseudo: p, mdp: "motdepasse1" }, null, "10.9." + (++nIp2) + ".1");
  const rs = await Promise.all(Array.from({ length: 5 }, () => essai("Doublon")));
  R("cinq inscriptions simultanées du même pseudo : une seule passe",
    rs.filter(r => r.code === 200).length === 1 && rs.filter(r => r.code === 409).length === 4);
  const gagnant = rs.find(r => r.code === 200);
  const idx = await (await store("pseudos")).get("doublon");
  R("et l'index pointe bien vers ce compte-là", idx && idx.uid === gagnant.moi.uid);
  const co = await post(compte, { action: "connexion", pseudo: "Doublon", mdp: "motdepasse1" }, null, "10.9.99.1");
  R("qui peut se connecter sous son nom", co.code === 200 && co.moi.uid === gagnant.moi.uid);

  // deux joueurs qui prennent le même nouveau pseudo au même moment
  const a = (await essai("Premiere")).jeton, b2 = (await essai("Seconde")).jeton;
  const rn = await Promise.all([
    post(compte, { action: "profil", profil: { pseudo: "Convoité" } }, a),
    post(compte, { action: "profil", profil: { pseudo: "Convoité" } }, b2)]);
  R("deux renommages vers le même pseudo : un seul passe",
    rn.filter(r => r.code === 200).length === 1 && rn.filter(r => r.code === 409).length === 1);

  // une inscription coupée en route ne bloque pas un pseudo pour toujours
  await (await store("pseudos")).set("fantome2", { uid: "personne", depuis: Date.now() - 120000 });
  R("un pseudo réservé par une inscription avortée se libère", (await essai("Fantome2")).code === 200);
  await (await store("pseudos")).set("recent", { uid: "personne", depuis: Date.now() });
  R("mais pas pendant qu'une inscription est peut-être en cours", (await essai("Recent")).code === 409);
}

/* ============================================================ */
console.log("\n=== UN SEUL FONDATEUR ===");
{
  // un site neuf : plus aucun compte
  for (const d of ["utilisateurs", "pseudos", "config"])
    await rm(".data-integrite/" + d, { recursive: true, force: true });
  let nIp3 = 0;
  const rs = await Promise.all(["Alpha", "Bravo", "Charlie", "Delta"].map(p =>
    post(compte, { action: "inscription", pseudo: p, mdp: "motdepasse1" }, null, "10.8." + (++nIp3) + ".1")));
  R("quatre inscriptions simultanées sur un site neuf réussissent", rs.every(r => r.code === 200));
  R("mais une seule devient administratrice", rs.filter(r => r.fondateur).length === 1);
  const U = await store("utilisateurs");
  const admins = (await Promise.all((await U.list("")).map(k => U.get(k)))).filter(u => u && u.role === "admin");
  R("et un seul compte porte le rôle", admins.length === 1);
}

console.log("\n" + (ko ? ko + " ÉCHEC(S) sur " + n : n + " vérifications, aucune erreur"));
await rm(".data-integrite", { recursive: true, force: true });
process.exit(ko ? 1 : 0);
