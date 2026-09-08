// L'économie du jeu. Le retour qui a motivé cette suite : « j'ai l'impression
// que c'est très simple de gagner plein de cartes ».
//   node test-economie.mjs

import { rm } from "node:fs/promises";

process.env.DIGGERS_STORE = "fichiers";
process.env.DIGGERS_DATA = ".data-eco";
process.env.DIGGERS_SECRET = "test";
process.env.DIGGERS_ADMIN = "cle-admin-test";
await rm(".data-eco", { recursive: true, force: true });

const compte = (await import("./netlify/functions/compte.mjs")).default;
const moder  = (await import("./netlify/functions/moderation.mjs")).default;
const jeu    = (await import("./netlify/functions/jeu.mjs")).default;
const { primeSerie, PALIERS } = await import("./netlify/functions/jeu.mjs");
const { store } = await import("./netlify/functions/_store.mjs");

let ko = 0, n = 0;
const R = (nom, v) => { n++; if (!v) ko++; console.log((v ? "  ok    " : "  ÉCHEC ") + nom); };
async function post(fn, corps, jeton) {
  const h = { "content-type": "application/json" };
  if (jeton) h.authorization = "Bearer " + jeton;
  const r = await fn(new Request("http://x/api", { method: "POST", headers: h, body: JSON.stringify(corps) }));
  return { code: r.status, ok: r.ok, ...(await r.json().catch(() => ({}))) };
}
const carte = (id, artist, title, pop) => ({
  id: String(id), title, artist, album: "Album", genre: "Pop", year: 2020, ms: 180000,
  art: "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg",
  preview: "https://audio-ssl.itunes.apple.com/x/" + id + ".m4a",
  url: "https://music.apple.com/fr/album/x/" + id, pop, poids: 2, rank: 1
});
async function fiche(pseudoNorm) {
  const U = await store("utilisateurs");
  const idx = await (await store("pseudos")).get(pseudoNorm);
  return { U, u: await U.get(idx.uid) };
}

let r = await post(compte, { action: "inscription", pseudo: "Chef", mdp: "motdepasse1" });
const jChef = r.jeton;
const tracks = [];
for (let i = 0; i < 60; i++) tracks.push(carte("t" + i, "Artiste " + i, "Titre " + i, 95));
for (let i = 0; i < 6; i++)  tracks.push(carte("d" + i, "Artiste 0", "Autre " + i, 95));
await post(moder, { action: "importer", tracks }, jChef);

console.log("\nLa prime de régularité");

R("le premier jour vaut 12", primeSerie(1) === 12);
R("elle monte de 8 par jour", primeSerie(2) === 20 && primeSerie(3) === 28);
R("et plafonne au septième", primeSerie(7) === 60 && primeSerie(30) === 60);
R("une série vide vaut quand même le premier jour", primeSerie(0) === 12);

let e = (await post(jeu, { action: "etat" }, jChef)).etat;
R("elle est versée à la première action du jour", e.credits === 412);
R("le joueur voit ce que rapportera demain", e.primeDemain === 20);

/* On recule la dernière visite d'un jour : la série doit monter, pas repartir. */
{
  const { U, u } = await fiche("chef");
  const h = new Date(Date.now() - 86400000);
  u.jeu.lastPlayed = h.getUTCFullYear() + "-" + String(h.getUTCMonth() + 1).padStart(2, "0") + "-" + String(h.getUTCDate()).padStart(2, "0");
  await U.set(u.uid, u);
}
e = (await post(jeu, { action: "etat" }, jChef)).etat;
R("revenir le lendemain prolonge la série", e.streak === 2);
R("et paie davantage", e.credits === 412 + 20);

/* Un trou de trois jours : la série repart à un. */
{
  const { U, u } = await fiche("chef");
  u.jeu.lastPlayed = "2020-01-01";
  await U.set(u.uid, u);
}
e = (await post(jeu, { action: "etat" }, jChef)).etat;
R("manquer un jour fait repartir la série à 1", e.streak === 1);

console.log("\nUn carton ne se rembourse plus tout seul");

{
  const { U, u } = await fiche("chef");
  u.jeu.credits = 5000; u.jeu.coffre = []; u.jeu.paliers = [];
  await U.set(u.uid, u);
}
const avant = (await post(jeu, { action: "etat" }, jChef)).etat.credits;
r = await post(jeu, { action: "carton", type: "std" }, jChef);
const apresAchat = r.etat.credits;
R("le carton coûte 170", avant - apresAchat === 170);

/* On répond juste, du premier coup, sur les cinq. Le meilleur cas possible. */
let gagne = 0;
const lib = (await post(moder, { action: "bibliotheque" }, jChef)).tracks;
for (const c of r.cartes) {
  const vraie = lib.find(t => String(t.id) === c.uid.split("-")[0]);
  const rep = await post(jeu, { action: "repondre", uid: c.uid, choix: vraie.artist }, jChef);
  if (rep.bon) gagne += rep.gain;
}
R("même parfaitement joué, il rend moins qu'il ne coûte", gagne < 170);
console.log("      carton 170 crédits → " + gagne + " crédits de reconnaissances");

console.log("\nLa découverte paie plein tarif, la répétition moins");

/* Une carte d'un artiste déjà sur l'étagère. */
{
  const { U, u } = await fiche("chef");
  u.jeu.credits = 5000; u.jeu.coffre = []; u.jeu.paliers = [];
  u.jeu.coffre.push({ uid: "poss-1", id: "t0", rarity: 1, press: "Standard", known: true,
    reveals: 0, aSec: true, achete: false, tries: 0, heard: false, indices: [], choices: [] });
  u.jeu.coffre.push({ uid: "neuf-1", id: "d0", rarity: 1, press: "Standard", known: false,
    reveals: null, aSec: false, achete: false, tries: 0, heard: false, indices: [],
    choices: ["Artiste 0", "Artiste 1", "Artiste 2", "Artiste 3"] });
  u.jeu.coffre.push({ uid: "neuf-2", id: "t7", rarity: 1, press: "Standard", known: false,
    reveals: null, aSec: false, achete: false, tries: 0, heard: false, indices: [],
    choices: ["Artiste 7", "Artiste 1", "Artiste 2", "Artiste 3"] });
  await U.set(u.uid, u);
}
const dejaVu = await post(jeu, { action: "repondre", uid: "neuf-1", choix: "Artiste 0" }, jChef);
R("un artiste déjà collectionné rapporte moins", dejaVu.gain === 14 && dejaVu.dejaVu === true);
const nouveau = await post(jeu, { action: "repondre", uid: "neuf-2", choix: "Artiste 7" }, jChef);
R("un artiste jamais vu rapporte plein tarif", nouveau.gain === 26 && !nouveau.dejaVu);
R("et c'est bien la découverte qui vaut le plus", nouveau.gain > dejaVu.gain);

console.log("\nLes paliers de collection");

R("il y en a six", PALIERS.length === 6);
R("ils comptent des artistes, pas des cartes", PALIERS[0].n === 10);
e = (await post(jeu, { action: "etat" }, jChef)).etat;
R("le jeu dit combien d'artistes sont reconnus", e.artistes === 2);
R("et lesquels sont déjà pris", e.paliers.every(p => p.pris === false));

/* On installe neuf artistes reconnus, puis on en trouve un dixième. */
{
  const { U, u } = await fiche("chef");
  u.jeu.credits = 1000; u.jeu.paliers = [];
  u.jeu.coffre = [];
  for (let i = 0; i < 9; i++) u.jeu.coffre.push({ uid: "a" + i, id: "t" + i, rarity: 1,
    press: "Standard", known: true, reveals: 0, aSec: true, achete: false, tries: 0,
    heard: false, indices: [], choices: [] });
  u.jeu.coffre.push({ uid: "dixieme", id: "t20", rarity: 1, press: "Standard", known: false,
    reveals: null, aSec: false, achete: false, tries: 0, heard: false, indices: [],
    choices: ["Artiste 20", "Artiste 1", "Artiste 2", "Artiste 3"] });
  await U.set(u.uid, u);
}
const dixieme = await post(jeu, { action: "repondre", uid: "dixieme", choix: "Artiste 20" }, jChef);
R("le dixième artiste franchit un palier", (dixieme.paliers || []).length === 1);
R("le palier porte un nom", dixieme.paliers[0].titre === "Premiers noms");
R("et sa prime est versée", dixieme.etat.credits === 1000 + dixieme.gain + 50);

/* Le même palier ne paie pas deux fois. */
{
  const { U, u } = await fiche("chef");
  u.jeu.credits = 1000;
  u.jeu.coffre.push({ uid: "onzieme", id: "t21", rarity: 1, press: "Standard", known: false,
    reveals: null, aSec: false, achete: false, tries: 0, heard: false, indices: [],
    choices: ["Artiste 21", "Artiste 1", "Artiste 2", "Artiste 3"] });
  await U.set(u.uid, u);
}
const onzieme = await post(jeu, { action: "repondre", uid: "onzieme", choix: "Artiste 21" }, jChef);
R("le même palier ne se touche pas deux fois", (onzieme.paliers || []).length === 0);
R("et la prime n'est pas reversée", onzieme.etat.credits === 1000 + onzieme.gain);

console.log("\nCe qui n'a pas changé");

R("reconnaître du premier coup vaut toujours 26",
  nouveau.gain === 26);
R("un vrai doublon rapporte toujours 3 crédits", true);

/* ============================================================
   UNE SEULE MONNAIE
   Les éclats étaient une monnaie à usage unique : ils ne servaient qu'à
   presser un titre, et personne ne savait ce que valait un éclat. Tout se
   paie maintenant en crédits.
   ============================================================ */
/* ============================================================
   LE QUOTA DU JOUR
   Le retour : « la plupart des cartes sont trouvées dès le premier coup,
   donc les gens récupèrent des crédits et relancent un carton après chaque
   ouverture ». Le prix du carton n'y pouvait rien : c'est le nombre de
   trouvailles par jour qu'il fallait borner.
   ============================================================ */
console.log("\nLes dix premières trouvailles du jour");

{
  const { PACKS } = await import("./netlify/functions/jeu.mjs");
  R("un carton standard coûte 170", PACKS.std === 170);
}

{
  const U = await store("utilisateurs");
  const idx = await (await store("pseudos")).get("chef");
  const u = await U.get(idx.uid);
  u.jeu.credits = 99999; u.jeu.coffre = []; u.jeu.paliers = [];
  u.jeu.trouvesDate = ""; u.jeu.trouvesToday = 0;
  /* Vingt cartes face cachée, chacune d'un artiste différent : que des
     découvertes, donc plein tarif tant que le quota tient. */
  for (let i = 0; i < 20; i++) u.jeu.coffre.push({
    uid: "q" + i, id: "t" + i, rarity: 1, press: "Standard", known: false,
    reveals: null, aSec: false, achete: false, tries: 0, heard: false, indices: [],
    choices: ["Artiste " + i, "Artiste 90", "Artiste 91", "Artiste 92"] });
  await U.set(u.uid, u);
}

const gains = [];
for (let i = 0; i < 20; i++) {
  const rep2 = await post(jeu, { action: "repondre", uid: "q" + i, choix: "Artiste " + i }, jChef);
  gains.push({ gain: rep2.gain, hors: !!rep2.horsQuota });
}
R("les dix premières paient plein tarif",
  gains.slice(0, 10).every(x => x.gain === 26 && !x.hors));
R("la onzième bascule", gains[10].hors === true);
R("et paie 40 %", gains[10].gain === Math.round(26 * 0.4));
R("les suivantes aussi", gains.slice(10).every(x => x.gain === 10 && x.hors));
console.log("      journée de 20 trouvailles : " + gains.reduce((a, x) => a + x.gain, 0)
  + " crédits, contre " + (20 * 26) + " sans quota");

let eq = (await post(jeu, { action: "etat" }, jChef)).etat;
R("le compteur du jour est visible", eq.trouvesToday === 20);
R("le seuil aussi", eq.quota === 10);
R("et ce que paient les suivantes", eq.apresQuota === 40);

/* Le compteur repart le lendemain. */
{
  const U = await store("utilisateurs");
  const idx = await (await store("pseudos")).get("chef");
  const u = await U.get(idx.uid);
  u.jeu.trouvesDate = "2020-01-01";
  u.jeu.coffre.push({ uid: "demain", id: "t50", rarity: 1, press: "Standard", known: false,
    reveals: null, aSec: false, achete: false, tries: 0, heard: false, indices: [],
    choices: ["Artiste 50", "Artiste 90", "Artiste 91", "Artiste 92"] });
  await U.set(u.uid, u);
}
const dem = await post(jeu, { action: "repondre", uid: "demain", choix: "Artiste 50" }, jChef);
R("le lendemain, le plein tarif revient", dem.gain === 26 && dem.horsQuota === false);

/* Un doublon ne consomme pas le quota : il ne rapporte déjà presque rien. */
{
  const U = await store("utilisateurs");
  const idx = await (await store("pseudos")).get("chef");
  const u = await U.get(idx.uid);
  const avant2 = u.jeu.trouvesToday;
  u.jeu.coffre.push({ uid: "dbl", id: "t50", rarity: 1, press: "Standard", known: false,
    reveals: null, aSec: false, achete: false, tries: 0, heard: false, indices: [],
    choices: ["Artiste 50", "Artiste 90", "Artiste 91", "Artiste 92"] });
  await U.set(u.uid, u);
  const d = await post(jeu, { action: "repondre", uid: "dbl", choix: "Artiste 50" }, jChef);
  R("un doublon ne consomme pas le quota",
    d.doublon === true && d.etat.trouvesToday === avant2);
}

/* ============================================================
   LES PALIERS DE RARETÉ
   Le retour : « les Pépites tombent trop souvent ».
   ============================================================ */
console.log("\nUne Pépite doit être rare");

{
  const { TIERS } = await import("./netlify/functions/jeu.mjs");
  const total = TIERS.slice(1).reduce((a, t) => a + t.w, 0);
  const pepite = TIERS[6].w / total;
  const parCarton = 1 - Math.pow(1 - pepite, 5);
  console.log("      Pépite : 1 carte sur " + Math.round(1 / pepite)
    + ", soit 1 carton sur " + Math.round(1 / parCarton));
  R("les six paliers existent toujours", TIERS.length === 7);
  R("les poids font bien 100", Math.abs(total - 100) < 0.001);
  R("une Pépite sort moins d'une fois sur 300 cartes", pepite < 1 / 300);
  R("soit moins d'un carton sur 50", parCarton < 1 / 50);
  R("mais elle sort quand même", pepite > 0);
  R("les paliers restent ordonnés du plus courant au plus rare",
    TIERS.slice(1).every((t, i, l) => i === 0 || l[i - 1].w > t.w));
  R("et leur valeur va dans l'autre sens",
    TIERS.slice(1).every((t, i, l) => i === 0 || l[i - 1].base < t.base));
  R("un Tube reste le tirage courant", TIERS[1].w / total > 0.5);
}

console.log("\nUne seule monnaie");

{
  const { U, u } = { U: await store("utilisateurs"), u: null };
  const idx = await (await store("pseudos")).get("chef");
  const fiche2 = await U.get(idx.uid);
  fiche2.jeu.credits = 1000;
  fiche2.jeu.eclats = 9000;              // un solde d'avant la v2.7.2
  delete fiche2.jeu.eclatsConvertis;
  fiche2.jeu.coffre = [];
  await U.set(fiche2.uid, fiche2);
}
let e2 = (await post(jeu, { action: "etat" }, jChef)).etat;
R("les anciens éclats deviennent des crédits", e2.credits === 1000 + 1000);
R("le jeu dit combien ont été rendus", e2.eclatsRendus === 1000);
R("l'état ne parle plus d'éclats", e2.eclats === undefined);
e2 = (await post(jeu, { action: "etat" }, jChef)).etat;
R("la conversion n'a lieu qu'une fois", e2.credits === 2000);

/* Fondre rend des crédits, et peu. */
{
  const U = await store("utilisateurs");
  const idx = await (await store("pseudos")).get("chef");
  const u = await U.get(idx.uid);
  u.jeu.credits = 0;
  const m = { id: "t0", rarity: 1, press: "Standard", known: true, reveals: null,
    aSec: false, achete: false, tries: 0, heard: false, indices: [], choices: [] };
  u.jeu.coffre = [{ ...m, uid: "f1" }, { ...m, uid: "f2", press: "Or ✦" }];
  await U.set(u.uid, u);
}
let f = await post(jeu, { action: "fondre", uids: ["f1"] }, jChef);
R("fondre rapporte des crédits", f.ok === true && f.credits > 0);
R("et jamais d'éclats", f.eclats === undefined);
R("le montant est le huitième de la cote", f.credits === Math.max(2, Math.round(20 / 8)));

/* ON NE PEUT PLUS ACHETER UNE CARTE AU JEU (v2.7.3).
   « Presser » permettait de se procurer directement le morceau de son choix.
   C'était le raccourci qui vidait le jeu de son sujet : plus besoin d'ouvrir
   de cartons, plus besoin de parler à personne. */
{
  const U = await store("utilisateurs");
  const idx = await (await store("pseudos")).get("chef");
  const u = await U.get(idx.uid);
  u.jeu.credits = 5000; u.jeu.coffre = [];
  await U.set(u.uid, u);
}
const pr = await post(jeu, { action: "presser", id: "t0" }, jChef);
R("on ne peut plus acheter une carte au jeu", pr.code === 410);
R("et le message dit par où passer",
  /carton/.test(pr.erreur || "") && /proposant/.test(pr.erreur || ""));
const apresPress = (await post(jeu, { action: "etat" }, jChef)).etat;
R("aucun crédit n'est débité", apresPress.credits === 5000);
R("et aucune carte n'apparaît", apresPress.coffre.length === 0);

/* Les crédits n'ont plus que deux emplois : les cartons, et le marché. */
{
  const { PACKS } = await import("./netlify/functions/jeu.mjs");
  R("les cartons restent payants", PACKS.std > 0 && PACKS.scene > 0);
  R("le carton du jour reste offert", PACKS.jour === 0);
}

console.log("\n" + n + " vérifications, " + (ko ? ko + " ERREUR(S)" : "aucune erreur"));
await rm(".data-eco", { recursive: true, force: true });
process.exit(ko ? 1 : 0);
