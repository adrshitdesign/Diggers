// LES ACTIONS SIMULTANÉES — le test qui compte.
//
// Tout le reste du serveur se lit comme du code correct : on vérifie le solde,
// on débite, on range. Ça ne tient que si les requêtes arrivent une par une.
// Elles n'arrivent pas une par une. Un double-clic, deux onglets, deux joueurs
// qui visent la même annonce : deux requêtes lisent la même fiche, la
// modifient chacune de leur côté, et la seconde écriture efface la première.
// C'est comme ça qu'on ouvre deux cartons en en payant un, et qu'un exemplaire
// unique devient deux.
//
//   node test-simultane.mjs

import { rm } from "node:fs/promises";
import { createHmac } from "node:crypto";

process.env.DIGGERS_STORE = "fichiers";
process.env.DIGGERS_DATA = ".data-simultane";
process.env.DIGGERS_SECRET = "test";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
process.env.STRIPE_SECRET = "sk_test";
await rm(".data-simultane", { recursive: true, force: true });

const compte = (await import("./netlify/functions/compte.mjs")).default;
const jeu = (await import("./netlify/functions/jeu.mjs")).default;
const marche = (await import("./netlify/functions/marche.mjs")).default;
const boutique = (await import("./netlify/functions/boutique.mjs")).default;
const stripe = (await import("./netlify/functions/stripe.mjs")).default;
const biblio = await import("./netlify/functions/_biblio.mjs");
const { store } = await import("./netlify/functions/_store.mjs");
const { majJoueur } = await import("./netlify/functions/_lib.mjs");

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

/* une bibliothèque suffisante pour tirer des cartons */
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

const U = await store("utilisateurs");
const uidDe = async p => (await (await store("pseudos")).get(p.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""))).uid;
// une adresse par compte : le serveur limite les inscriptions par IP, et
// c'est très bien — mais un test n'a pas à se cogner dedans.
let nIp = 0;
const inscrire = async p => (await post(compte,
  { action: "inscription", pseudo: p, mdp: "motdepasse1" }, null, "10.0." + (++nIp) + ".1")).jeton;

/* ============================================================ */
console.log("\n=== DOUBLE-CLIC SUR UN CARTON ===");
{
  const j = await inscrire("Mila");
  const uid = await uidDe("Mila");
  // 400 crédits, un carton standard en vaut 100 : quatre au maximum.
  const r = await Promise.all(Array.from({ length: 6 }, () => post(jeu, { action: "carton", type: "std" }, j)));
  const passes = r.filter(x => x.code === 200).length;
  const f = await U.get(uid);
  const payes = (400 - f.jeu.credits) / 100;
  R("le compte n'est jamais dans le rouge", f.jeu.credits >= 0);
  R("on paie exactement autant de cartons qu'on en reçoit", passes === payes);
  R("et toutes les cartes reçues sont bien sur l'étagère", f.jeu.coffre.length === passes * 5);
  R("au-delà du solde, c'est refusé proprement", passes <= 4);
  console.log("    " + passes + " carton(s) ouvert(s), " + f.jeu.credits + " crédits restants, "
    + f.jeu.coffre.length + " cartes");
}

/* ============================================================ */
console.log("\n=== DEUX ACHETEURS, UNE SEULE CARTE ===");
{
  const jV = await inscrire("Vendeuse"), uidV = await uidDe("Vendeuse");
  const acheteurs = [];
  for (const p of ["Ana", "Bilal", "Cléo", "Dylan"]) acheteurs.push({ p, j: await inscrire(p), uid: await uidDe(p) });

  // la vendeuse ouvre un carton, on révèle une carte pour pouvoir la vendre
  await post(jeu, { action: "carton", type: "jour" }, jV);
  await majJoueur(uidV, (u) => { u.jeu.coffre.forEach(c => { c.known = true; c.press = "Standard"; }); return u; });
  const mienne = (await U.get(uidV)).jeu.coffre[0];

  const pose = await post(marche, { action: "poser", uid: mienne.uid, prix: 50 }, jV);
  R("l'annonce est posée", pose.code === 200);
  const idAnnonce = pose.annonce.id;

  // les quatre se jettent dessus à la même milliseconde
  const r = await Promise.all(acheteurs.map(a => post(marche, { action: "acheter", id: idAnnonce }, a.j)));
  const gagnants = r.filter(x => x.code === 200);
  R("un seul acheteur repart avec la carte", gagnants.length === 1);
  R("les autres reçoivent « déjà partie »", r.filter(x => x.code === 409).length === 3);

  let exemplaires = 0;
  for (const a of acheteurs) exemplaires += ((await U.get(a.uid)).jeu || { coffre: [] }).coffre.filter(c => c.uid === mienne.uid).length;
  exemplaires += (await U.get(uidV)).jeu.coffre.filter(c => c.uid === mienne.uid).length;
  R("il n'existe toujours qu'un exemplaire de cette carte", exemplaires === 1);

  const v = await U.get(uidV);
  R("la vendeuse n'est payée qu'une fois", v.jeu.credits === 400 + 50);
  R("et l'annonce a disparu du marché", !(await (await store("annonces")).get(idAnnonce)));
}

/* ============================================================ */
console.log("\n=== UNE VENDEUSE, PLUSIEURS VENTES EN MÊME TEMPS ===");
{
  const jV = await inscrire("Sonia"), uidV = await uidDe("Sonia");
  await post(jeu, { action: "carton", type: "jour" }, jV);
  await majJoueur(uidV, (u) => { u.jeu.coffre.forEach(c => { c.known = true; c.press = "Standard"; }); return u; });
  const cartes = (await U.get(uidV)).jeu.coffre.slice(0, 3);

  const ids = [];
  for (const c of cartes) ids.push((await post(marche, { action: "poser", uid: c.uid, prix: 40 }, jV)).annonce.id);
  const creditsAvant = (await U.get(uidV)).jeu.credits;

  const acheteurs = [];
  for (const p of ["Elias", "Fatou", "Gaby"]) acheteurs.push(await inscrire(p));

  // trois ventes différentes, au même instant, vers la même vendeuse
  const r = await Promise.all(ids.map((id, i) => post(marche, { action: "acheter", id }, acheteurs[i])));
  R("les trois ventes aboutissent", r.every(x => x.code === 200));
  const apres = (await U.get(uidV)).jeu.credits;
  R("la vendeuse touche les trois prix, pas un seul", apres === creditsAvant + 120);
  console.log("    crédits : " + creditsAvant + " → " + apres);
}

/* ============================================================ */
console.log("\n=== DEUX ACHATS DE DÉCOR À LA FOIS ===");
{
  const j = await inscrire("Hugo"), uid = await uidDe("Hugo");
  await majJoueur(uid, (u) => { u.jetons = 300; return u; });   // de quoi n'en payer qu'un seul à 250
  const r = await Promise.all([
    post(boutique, { action: "acheter", id: "ban-or" }, j),
    post(boutique, { action: "acheter", id: "ban-chrome" }, j)
  ]);
  const passes = r.filter(x => x.code === 200).length;
  const f = await U.get(uid);
  R("un seul décor à 250 jetons passe avec 300 jetons", passes === 1);
  R("le solde ne devient pas négatif", f.jetons === 50);
  R("et l'inventaire correspond au solde", (f.cosmetiques || []).length === passes);
}

/* ============================================================ */
console.log("\n=== STRIPE QUI REPASSE LE MÊME MESSAGE ===");
{
  const j = await inscrire("Iris"), uid = await uidDe("Iris");
  const ev = {
    id: "evt_double", type: "checkout.session.completed",
    data: { object: { payment_status: "paid", client_reference_id: uid, amount_total: 999, currency: "eur",
      metadata: { uid, pack: "sacoche", jetons: "650" } } }
  };
  // Stripe réessaie quand il n'a pas eu de réponse : les deux peuvent arriver ensemble
  const r = await Promise.all([webhook(ev), webhook(ev), webhook(ev)]);
  const credites = r.filter(x => x.credite).length;
  const f = await U.get(uid);
  R("un seul des trois messages crédite", credites === 1);
  R("le joueur reçoit 650 jetons, pas 1950", f.jetons === 650);
  R("et un seul achat est compté", f.achatsJetons === 1);
}

console.log("\n" + (ko ? ko + " ÉCHEC(S) sur " + n : n + " vérifications, aucune erreur"));
await rm(".data-simultane", { recursive: true, force: true });
process.exit(ko ? 1 : 0);
