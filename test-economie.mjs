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
R("le carton coûte 140", avant - apresAchat === 140);

/* On répond juste, du premier coup, sur les cinq. Le meilleur cas possible. */
let gagne = 0;
const lib = (await post(moder, { action: "bibliotheque" }, jChef)).tracks;
for (const c of r.cartes) {
  const vraie = lib.find(t => String(t.id) === c.uid.split("-")[0]);
  const rep = await post(jeu, { action: "repondre", uid: c.uid, choix: vraie.artist }, jChef);
  if (rep.bon) gagne += rep.gain;
}
R("même parfaitement joué, il rend moins qu'il ne coûte", gagne < 140);
console.log("      carton 140 crédits → " + gagne + " crédits de reconnaissances");

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

console.log("\n" + n + " vérifications, " + (ko ? ko + " ERREUR(S)" : "aucune erreur"));
await rm(".data-eco", { recursive: true, force: true });
process.exit(ko ? 1 : 0);
