// Le défi du jour : thème commun, une carte chacun, vote aveugle, palmarès.
//   node test-defi.mjs

import { rm } from "node:fs/promises";

process.env.DIGGERS_STORE = "fichiers";
process.env.DIGGERS_DATA = ".data-defi";
process.env.DIGGERS_SECRET = "test";
await rm(".data-defi", { recursive: true, force: true });

const compte = (await import("./netlify/functions/compte.mjs")).default;
const jeu = (await import("./netlify/functions/jeu.mjs")).default;
const defi = (await import("./netlify/functions/defi.mjs")).default;
const { THEMES, themeDu, MAX_VOTES, GAIN_VOTE, GAIN_PODIUM } = await import("./netlify/functions/defi.mjs");
const { jour, majJoueur } = await import("./netlify/functions/_lib.mjs");
const biblio = await import("./netlify/functions/_biblio.mjs");
const { store } = await import("./netlify/functions/_store.mjs");

let ko = 0, n = 0;
const R = (nom, v) => { n++; if (!v) ko++; console.log((v ? "  ok    " : "  ÉCHEC ") + nom); };
let nIp = 0;
async function post(fn, corps, jeton, ip) {
  const h = { "content-type": "application/json" };
  if (jeton) h.authorization = "Bearer " + jeton;
  if (ip) h["x-nf-client-connection-ip"] = ip;
  const r = await fn(new Request("http://x/api", { method: "POST", headers: h, body: JSON.stringify(corps) }));
  return { code: r.status, ...(await r.json().catch(() => ({}))) };
}
async function get(fn) {
  const r = await fn(new Request("http://x/api", { method: "GET" }));
  return { code: r.status, ...(await r.json().catch(() => ({}))) };
}
const inscrire = async p => (await post(compte,
  { action: "inscription", pseudo: p, mdp: "motdepasse1" }, null, "10.0." + (++nIp) + ".1")).jeton;
const U = await store("utilisateurs");
const uidDe = async p => (await (await store("pseudos")).get(
  p.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, ""))).uid;

/* une bibliothèque de test */
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

/* quatre joueuses avec une étagère garnie et reconnue */
const J = {}, UID = {};
for (const p of ["Mila", "Théo", "Sam", "Lina"]) {
  J[p] = await inscrire(p); UID[p] = await uidDe(p);
  await post(jeu, { action: "carton", type: "jour" }, J[p]);
  await majJoueur(UID[p], (u) => { u.jeu.coffre.forEach(c => { c.known = true; }); return u; });
}

console.log("\n=== LE THÈME ===");
let r = await get(defi);
R("le thème du jour sort sans compte", r.code === 200 && !!r.theme);
R("il est le même à chaque appel", (await get(defi)).theme === r.theme);
R("il vient bien de la liste", THEMES.includes(r.theme));
R("un autre jour donne un autre thème", themeDu("2026-01-01") !== themeDu("2026-01-02"));
console.log("    thème du jour : " + r.theme);

console.log("\n=== POSER SA CARTE ===");
r = await post(defi, { action: "poser", uid: "n'importe quoi" });
R("poser sans compte est refusé", r.code === 401);

r = await post(defi, { action: "cartes" }, J.Mila);
R("le serveur propose les cartes de l'étagère", r.code === 200 && r.cartes.length > 0);
R("chaque carte porte son titre et sa pochette", r.cartes.every(c => c.title && c.art));
const maCarte = r.cartes[0];

r = await post(defi, { action: "poser", uid: "inconnue" }, J.Mila);
R("une carte qu'on n'a pas est refusée", r.code === 404);

r = await post(defi, { action: "poser", uid: maCarte.uid }, J.Mila);
R("Mila pose sa carte", r.code === 200 && r.entrees === 1);
R("le serveur renvoie le morceau, relu dans la bibliothèque",
  r.posee && r.posee.title === maCarte.title && /mzstatic\.com/.test(r.posee.art));

r = await post(defi, { action: "poser", uid: maCarte.uid }, J.Mila);
R("on ne pose qu'une carte par jour", r.code === 409);

/* une carte face cachée ne répond à rien */
{
  const j2 = await inscrire("Cachotier"), uid2 = await uidDe("Cachotier");
  await post(jeu, { action: "carton", type: "jour" }, j2);
  const c = (await U.get(uid2)).jeu.coffre[0];
  r = await post(defi, { action: "poser", uid: c.uid }, j2);
  R("une carte face cachée ne peut pas être posée", r.code === 409);
}

for (const p of ["Théo", "Sam", "Lina"]) {
  const l = await post(defi, { action: "cartes" }, J[p]);
  await post(defi, { action: "poser", uid: l.cartes[0].uid }, J[p]);
}
r = await post(defi, { action: "etat" }, J.Mila);
R("l'état montre quatre cartes posées", r.entrees === 4);
R("et la carte qu'on a posée", r.posee && !!r.posee.title);

console.log("\n=== VOTER À L'AVEUGLE ===");
r = await post(defi, { action: "duel" }, J.Mila);
R("un duel sort", r.code === 200 && r.duel && r.duel.length === 2);
R("il ne contient jamais sa propre carte",
  !r.duel.some(x => x.carte.title === maCarte.title));
R("il ne dit pas qui a posé", r.duel.every(x => x.pseudo === undefined));
R("mais il donne de quoi juger", r.duel.every(x => x.carte.title && x.carte.preview));

const creditsAvant = (await post(defi, { action: "etat" }, J.Mila)).credits;
let v = await post(defi, { action: "voter", gagnant: r.duel[0].id, perdant: r.duel[1].id }, J.Mila);
R("le vote passe", v.code === 200 && v.vote === true);
R("il rapporte " + GAIN_VOTE + " crédits, tout de suite", v.credits === creditsAvant + GAIN_VOTE);
R("on ne tranche pas deux fois le même duel",
  (await post(defi, { action: "voter", gagnant: r.duel[0].id, perdant: r.duel[1].id }, J.Mila)).code === 409);

{
  const d = await (await store("defis")).get(jour());
  const sienne = d.entrees.find(e => e.uid === UID.Mila);
  const autre = d.entrees.find(e => e.uid !== UID.Mila);
  R("on ne vote pas pour sa propre carte",
    (await post(defi, { action: "voter", gagnant: sienne.id, perdant: autre.id }, J.Mila)).code === 403);
}

console.log("\n=== LES BORNES ===");
{
  const d = await (await store("defis")).get(jour());
  const a = d.entrees.filter(e => e.uid !== UID.Théo);
  let refus = 0;
  for (let i = 0; i < MAX_VOTES + 4; i++) {
    const x = await post(defi, { action: "voter", gagnant: a[i % a.length].id,
      perdant: a[(i + 1) % a.length].id }, J.Théo);
    if (x.code === 429) { refus++; break; }
  }
  const f = await U.get(UID.Théo);
  R("le quota de duels finit par se fermer", refus > 0 || f.defi.votes <= MAX_VOTES);
  R("et il ne dépasse jamais " + MAX_VOTES, f.defi.votes <= MAX_VOTES);
}

console.log("\n=== LE PALMARÈS ===");
{
  const S = await store("defis");
  const dh = "2026-01-15";
  await S.set(dh, { date: dh, theme: themeDu(dh), clos: false, entrees: [
    { id: "e1", uid: UID.Mila, pseudo: "Mila", carteId: "c0x0", rarity: 2, press: "Vinyle", duels: 10, gagnes: 9 },
    { id: "e2", uid: UID.Théo, pseudo: "Théo", carteId: "c1x1", rarity: 3, press: "Standard", duels: 10, gagnes: 5 },
    { id: "e3", uid: UID.Sam,  pseudo: "Sam",  carteId: "c2x2", rarity: 4, press: "Promo", duels: 10, gagnes: 2 },
    { id: "e4", uid: "fantome", pseudo: "Trop peu vue", carteId: "c3x3", rarity: 1, press: "Standard", duels: 1, gagnes: 1 }
  ] });
  const avant = (await U.get(UID.Mila)).jeu.credits;
  r = await post(defi, { action: "palmares", date: dh }, J.Mila);
  R("le palmarès sort", r.code === 200 && r.podium.length === 3);
  R("il est trié sur le taux de victoire", r.podium[0].pseudo === "Mila" && r.podium[0].taux === 90);
  R("une entrée trop peu vue n'est pas classée", !r.podium.some(x => x.pseudo === "Trop peu vue"));
  R("le podium affiche enfin les pseudos", r.podium.every(x => !!x.pseudo));
  R("et le vrai morceau, relu dans la bibliothèque", r.podium[0].carte.title === "Titre 0-0");

  const apres = (await U.get(UID.Mila)).jeu.credits;
  R("la gagnante est payée sur son vrai solde", apres === avant + GAIN_PODIUM[0]);
  R("et son compteur de victoires a bougé", (await U.get(UID.Mila)).defisGagnes === 1);
  await post(defi, { action: "palmares", date: dh }, J.Théo);
  R("un second appel ne la paie pas deux fois", (await U.get(UID.Mila)).jeu.credits === apres);
}

/* ============================================================
   TOUT LE MONDE EN MÊME TEMPS
   Le défi est le seul endroit du jeu où des dizaines de personnes écrivent
   sur le MÊME enregistrement à la même seconde. Sans écriture conditionnelle,
   les votes s'écrasent : le palmarès devient faux, et le quota de 24 se saute
   en ouvrant deux onglets.
   ============================================================ */
console.log("\n=== TOUT LE MONDE EN MÊME TEMPS ===");
{
  const D = await store("defis"), j2 = jour();

  // 1. six envois simultanés de la même personne → une seule carte
  const solo = await inscrire("Presse"), uidSolo = await uidDe("Presse");
  await post(jeu, { action: "carton", type: "jour" }, solo);
  await majJoueur(uidSolo, (u) => { u.jeu.coffre.forEach(c => { c.known = true; }); return u; });
  const l = await post(defi, { action: "cartes" }, solo);
  const rs = await Promise.all(Array.from({ length: 6 }, () =>
    post(defi, { action: "poser", uid: l.cartes[0].uid }, solo)));
  const etat1 = await D.get(j2);
  R("un seul des six envois simultanés passe", rs.filter(x => x.code === 200).length === 1);
  R("et le défi ne contient qu'une carte de ce joueur",
    etat1.entrees.filter(e => e.uid === uidSolo).length === 1);

  // 2. des votes simultanés → aucun duel perdu
  await D.set(j2, { ...etat1, entrees: etat1.entrees.map(x => ({ ...x, duels: 0, gagnes: 0 })) });
  const arbitre = await inscrire("Arbitre"), uidArb = await uidDe("Arbitre");
  const e = (await D.get(j2)).entrees;
  const paires = [];   // (A,B) et (B,A) sont le même duel : on ne les compte qu'une fois
  for (let i = 0; i < e.length; i++) for (let k = i + 1; k < e.length; k++) paires.push([e[i], e[k]]);
  const lot = paires.slice(0, 10);
  const vs = await Promise.all(lot.map(([g2, p]) =>
    post(defi, { action: "voter", gagnant: g2.id, perdant: p.id }, arbitre)));
  const passes = vs.filter(x => x.code === 200).length;
  const etat2 = await D.get(j2);
  const totalDuels = etat2.entrees.reduce((t, x) => t + (x.duels || 0), 0);
  R("les votes simultanés passent tous", passes === lot.length);
  R("et aucun duel n'est perdu en route", totalDuels === passes * 2);
  const fa = await U.get(uidArb);
  R("le compteur de votes du joueur est exact", fa.defi.votes === passes);
  R("et ses crédits correspondent exactement à ses votes",
    fa.jeu.credits === 400 + passes * GAIN_VOTE);
}

console.log("\n" + (ko ? ko + " ÉCHEC(S) sur " + n : n + " vérifications, aucune erreur"));
await rm(".data-defi", { recursive: true, force: true });
process.exit(ko ? 1 : 0);
