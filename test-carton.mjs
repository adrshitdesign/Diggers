// Un carton doit ouvrir cinq fois quelque chose.
// Le retour qui a motivé ce test : « thème bollywood, il a eu 5 fois le même son ».
//   node test-carton.mjs

import { rm } from "node:fs/promises";

process.env.DIGGERS_STORE = "fichiers";
process.env.DIGGERS_DATA = ".data-carton";
process.env.DIGGERS_SECRET = "test";
process.env.DIGGERS_ADMIN = "cle-admin-test";
await rm(".data-carton", { recursive: true, force: true });

const compte = (await import("./netlify/functions/compte.mjs")).default;
const moder  = (await import("./netlify/functions/moderation.mjs")).default;
const jeu    = (await import("./netlify/functions/jeu.mjs")).default;
const { store } = await import("./netlify/functions/_store.mjs");

/* Les cartons coûtent des crédits et ce test en ouvre cinquante : on remet la
   cagnotte à niveau directement dans le rangement, comme le ferait un jour de
   jeu. Ce n'est pas ce qu'on teste ici. */
async function renflouer(pseudoNorm) {
  const U = await store("utilisateurs");
  const idx = await (await store("pseudos")).get(pseudoNorm);
  const u = await U.get(idx.uid);
  u.jeu = u.jeu || {};
  u.jeu.credits = 100000;
  await U.set(u.uid, u);
}

let ko = 0, n = 0;
const R = (nom, v) => { n++; if (!v) ko++; console.log((v ? "  ok    " : "  ÉCHEC ") + nom); };
async function post(fn, corps, jeton) {
  const h = { "content-type": "application/json" };
  if (jeton) h.authorization = "Bearer " + jeton;
  const r = await fn(new Request("http://x/api", { method: "POST", headers: h, body: JSON.stringify(corps) }));
  return { code: r.status, ok: r.ok, ...(await r.json().catch(() => ({}))) };
}
const carte = (id, artist, title, genre, pop) => ({
  id: String(id), title, artist, album: "Album", genre, year: 2020, ms: 180000,
  art: "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg",
  preview: "https://audio-ssl.itunes.apple.com/x/" + id + ".m4a",
  url: "https://music.apple.com/fr/album/x/" + id, pop, poids: 2, rank: 1
});

let r = await post(compte, { action: "inscription", pseudo: "Chef", mdp: "motdepasse1" });
const jChef = r.jeton;

/* Une bibliothèque volontairement déséquilibrée : un genre fourni, un genre
   maigre — exactement la situation qui produisait cinq fois la même carte. */
const tracks = [];
for (let i = 0; i < 40; i++) tracks.push(carte("rap" + i, "Rappeur " + i, "Titre " + i, "Hip-Hop/Rap", 10 + i * 2));
for (let i = 0; i < 2; i++)  tracks.push(carte("bol" + i, "Chanteuse " + i, "Chanson " + i, "Bollywood", 40 + i));
await post(moder, { action: "importer", tracks }, jChef);

console.log("\nUn carton ne donne jamais deux fois la même carte");

await post(jeu, { action: "etat" }, jChef);   // crée la partie si elle n'existe pas encore
await renflouer("chef");
let doublons = 0, cartons = 0;
for (let i = 0; i < 25; i++) {
  const c = await post(jeu, { action: "carton", type: "std" }, jChef);
  if (!c.ok) break;
  cartons++;
  const ids = c.cartes.map(x => x.uid.split("-")[0]);
  if (new Set(ids).size !== ids.length) doublons++;
}
R("on a pu ouvrir des cartons", cartons >= 3);
R("aucun carton standard ne contient deux fois le même morceau", doublons === 0);

console.log("\nUn thème trop maigre n'est pas proposé");

/* Bollywood n'a que 2 titres : le carton à thème ne doit jamais le tirer. */
await renflouer("chef");
let bollywood = 0, aThemes = 0, doublonsTheme = 0;
for (let i = 0; i < 30; i++) {
  const c = await post(jeu, { action: "carton", type: "scene" }, jChef);
  if (!c.ok) break;
  aThemes++;
  if (c.theme === "Bollywood") bollywood++;
  const ids = c.cartes.map(x => x.uid.split("-")[0]);
  if (new Set(ids).size !== ids.length) doublonsTheme++;
}
R("on a pu ouvrir des cartons à thème", aThemes >= 3);
R("le thème est annoncé", aThemes > 0);
R("un genre à 2 titres n'est jamais tiré comme thème", bollywood === 0);
R("aucun carton à thème ne contient deux fois le même morceau", doublonsTheme === 0);

console.log("\nQuand aucun style n'est assez fourni, on le dit — on ne débite rien");

/* On remplace la bibliothèque par une où aucun genre n'atteint cinq titres. */
await post(moder, { action: "vider", source: "tout" }, jChef);
const maigres = [];
for (let i = 0; i < 3; i++) maigres.push(carte("a" + i, "A" + i, "T" + i, "Genre A", 50));
for (let i = 0; i < 3; i++) maigres.push(carte("b" + i, "B" + i, "T" + i, "Genre B", 50));
await post(moder, { action: "importer", tracks: maigres }, jChef);
await renflouer("chef");

const avant = (await post(jeu, { action: "etat" }, jChef)).etat.credits;
r = await post(jeu, { action: "carton", type: "scene" }, jChef);
R("le carton à thème est refusé, pas rempli de doublons", r.code === 409);
R("et il explique pourquoi", /assez de morceaux/.test(r.erreur || ""));
const apres = (await post(jeu, { action: "etat" }, jChef)).etat.credits;
R("aucun crédit n'a été débité", apres === avant);

r = await post(jeu, { action: "carton", type: "std" }, jChef);
R("le carton standard, lui, marche toujours", r.ok === true);
R("il donne autant de cartes qu'il y a de morceaux distincts, sans en répéter",
  new Set(r.cartes.map(x => x.uid.split("-")[0])).size === r.cartes.length);

console.log("\n" + n + " vérifications, " + (ko ? ko + " ERREUR(S)" : "aucune erreur"));
await rm(".data-carton", { recursive: true, force: true });
process.exit(ko ? 1 : 0);
