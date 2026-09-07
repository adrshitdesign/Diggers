// Ce que le navigateur télécharge en ouvrant le jeu — et ce qu'il n'y trouve
// plus. Jusqu'à la v2.5, /api/catalogue renvoyait la bibliothèque entière :
// 14 000 cartes, huit mégaoctets, à chaque chargement de page.
//   node test-charge.mjs

import { rm } from "node:fs/promises";

process.env.DIGGERS_STORE = "fichiers";
process.env.DIGGERS_DATA = ".data-charge";
process.env.DIGGERS_SECRET = "test";
process.env.DIGGERS_ADMIN = "cle-admin-test";
await rm(".data-charge", { recursive: true, force: true });

const compte = (await import("./netlify/functions/compte.mjs")).default;
const moder  = (await import("./netlify/functions/moderation.mjs")).default;
const catal  = (await import("./netlify/functions/catalogue.mjs")).default;
const biblio = (await import("./netlify/functions/bibliotheque.mjs")).default;
const jeu    = (await import("./netlify/functions/jeu.mjs")).default;

let ko = 0, n = 0;
const R = (nom, v) => { n++; if (!v) ko++; console.log((v ? "  ok    " : "  ÉCHEC ") + nom); };
async function post(fn, corps, jeton) {
  const h = { "content-type": "application/json" };
  if (jeton) h.authorization = "Bearer " + jeton;
  const r = await fn(new Request("http://x/api", { method: "POST", headers: h, body: JSON.stringify(corps) }));
  return { code: r.status, ok: r.ok, ...(await r.json().catch(() => ({}))) };
}
async function get(fn, q) {
  const r = await fn(new Request("http://x/api" + (q || ""), { method: "GET" }));
  const texte = await r.text();
  let d = {}; try { d = JSON.parse(texte); } catch (e) {}
  return { code: r.status, octets: Buffer.byteLength(texte), ...d };
}

/* Une bibliothèque de la taille de la vraie : 40 artistes × 60 titres. */
const ART = Array.from({ length: 40 }, (_, i) => "Artiste " + String(i).padStart(2, "0"));
const tracks = [];
ART.forEach((a, i) => {
  for (let k = 0; k < 60; k++) tracks.push({
    id: "t" + i + "-" + k, title: "Titre " + i + "-" + k, artist: a,
    album: "Album " + i, genre: ["Pop", "Rap", "Rock", "Jazz"][(i + k) % 4],
    year: 1970 + ((i + k) % 55), ms: 180000 + k * 900,
    art: "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/" + i + "/" + k + "/aa/source/400x400bb.jpg",
    preview: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/mzaf_" + i + k + ".m4a",
    url: "https://music.apple.com/fr/album/x/" + i + k,
    pop: 99 - ((i * 60 + k) % 99), rank: k + 1
  });
});

let r = await post(compte, { action: "inscription", pseudo: "Chef", mdp: "motdepasse1" });
const jChef = r.jeton;
for (let i = 0; i < tracks.length; i += 400)
  await post(moder, { action: "importer", tracks: tracks.slice(i, i + 400) }, jChef);

console.log("\nCe que le navigateur reçoit en ouvrant le jeu");

const complet = await get(catal, "?complet=1");
const leger = await get(catal);
R("la bibliothèque de test compte 2400 sons", complet.tracks.length === 2400);
R("le catalogue léger n'envoie aucune carte", leger.tracks === undefined);
R("il annonce quand même combien il y en a", leger.meta.titres === 2400);
R("et combien d'artistes", leger.meta.artistes === 40);

const gain = complet.octets / leger.octets;
console.log("      complet " + Math.round(complet.octets / 1024) + " Ko · léger "
  + Math.round(leger.octets / 1024) + " Ko · " + gain.toFixed(0) + " fois moins");
R("il pèse au moins dix fois moins que la bibliothèque entière", gain >= 10);
R("et sa taille ne suit pas le nombre de sons", leger.octets < 120 * 1024);

R("il porte la liste d'artistes de l'écran des goûts", leger.artistes.length === 40);
R("chaque artiste a un nom, une pochette et un compte",
  leger.artistes.every(a => a.n && a.art && a.c > 0));
R("la liste est triée du plus connu au moins connu",
  leger.artistes.every((a, i) => i === 0 || leger.artistes[i - 1].pop >= a.pop));
R("elle est plafonnée, quelle que soit la taille du jeu", leger.artistes.length <= 300);
R("aucun extrait audio ne voyage dans la liste d'artistes",
  !JSON.stringify(leger.artistes).includes("AudioPreview"));

R("un extrait accompagne le bouton « tester le son »",
  !!(leger.test && leger.test.preview && leger.test.artist));
R("mais un seul", JSON.stringify(leger.test).length < 500);

R("les mentions légales voyagent toujours avec", "editeur" in leger.meta);

console.log("\nLe catalogue léger reste juste quand la bibliothèque bouge");

await post(moder, { action: "importer", tracks: [{
  id: "nouveau-1", title: "Le nouveau", artist: "Artiste Neuf", album: "A", genre: "Pop",
  year: 2024, ms: 200000, art: "https://is1-ssl.mzstatic.com/x/400x400bb.jpg",
  preview: "https://audio-ssl.itunes.apple.com/x.m4a", url: "https://music.apple.com/fr/x", pop: 99 }] }, jChef);
const apres = await get(catal);
R("un son ajouté fait monter le compteur", apres.meta.titres === 2401);
R("et son artiste apparaît dans la liste", apres.artistes.some(a => a.n === "Artiste Neuf"));
R("le cache ne sert pas une version périmée", apres.meta.artistes === 41);

await post(moder, { action: "retirer", track: "nouveau-1" }, jChef);
const apres2 = await get(catal);
R("un son retiré fait redescendre le compteur", apres2.meta.titres === 2400);
R("et son artiste disparaît", !apres2.artistes.some(a => a.n === "Artiste Neuf"));

console.log("\nCe qui remplace la bibliothèque en mémoire");

let b = await get(biblio, "?q=Titre 3-7&parPage=24");
R("chercher un titre se fait côté serveur", b.total >= 1);
R("et ne renvoie qu'une page", b.cartes.length <= 24);
R("les cartes rendues portent de quoi les afficher",
  b.cartes.every(c => c.title && c.artist && c.art && typeof c.pop === "number"));
R("et leur durée, pour la barre de la carte", b.cartes.every(c => typeof c.ms === "number"));
R("mais pas d'extrait : ce n'est pas un juke-box",
  !JSON.stringify(b.cartes).includes("AudioPreview"));

b = await get(biblio, "?ids=t0-0,t1-1,t2-2");
R("un set partagé se retrouve par identifiants", b.cartes.length === 3);
R("celles-là portent l'extrait, la page invite à l'écouter",
  b.cartes.every(c => c.preview && c.preview.includes("AudioPreview")));
b = await get(biblio, "?ids=" + Array.from({ length: 40 }, (_, i) => "t0-" + i).join(","));
R("on ne peut pas vider la bibliothèque dix par dix", b.cartes.length <= 10);
b = await get(biblio, "?ids=t0-0,nexistepas");
R("un identifiant inconnu est simplement absent", b.cartes.length === 1 && b.demandes === 2);

r = await post(biblio, { connus: [
  { artist: "Artiste 00", title: "Titre 0-0" },
  { artist: "Personne", title: "Rien du tout" },
  { artist: "artiste 00", title: "titre 0-0" }] });
R("le serveur dit ce qui est déjà dans le jeu",
  JSON.stringify(r.connus) === JSON.stringify([true, false, true]));
r = await post(biblio, { connus: Array.from({ length: 200 }, () => ({ artist: "x", title: "y" })) });
R("la question est bornée", r.connus.length <= 40);

console.log("\nLe jeu tourne toujours");

r = await post(jeu, { action: "carton", type: "std" }, jChef);
R("un carton s'ouvre", r.ok === true && r.cartes && r.cartes.length === 5);
R("les cartes sortent face cachée", r.cartes.every(c => !c.title));

console.log("\n" + n + " vérifications, " + (ko ? ko + " ERREUR(S)" : "aucune erreur"));
await rm(".data-charge", { recursive: true, force: true });
process.exit(ko ? 1 : 0);
