// La bibliothèque publique : un seul artiste par carte, et le nombre
// d'exemplaires réellement en circulation.
//   node test-bibliotheque.mjs

import { rm } from "node:fs/promises";

process.env.DIGGERS_STORE = "fichiers";
process.env.DIGGERS_DATA = ".data-bib";
process.env.DIGGERS_SECRET = "test";
process.env.DIGGERS_ADMIN = "cle-admin-de-test";
await rm(".data-bib", { recursive: true, force: true });

const compte = (await import("./netlify/functions/compte.mjs")).default;
const jeu = (await import("./netlify/functions/jeu.mjs")).default;
const moderation = (await import("./netlify/functions/moderation.mjs")).default;
const bibliotheque = (await import("./netlify/functions/bibliotheque.mjs")).default;
const biblio = await import("./netlify/functions/_biblio.mjs");
const { store } = await import("./netlify/functions/_store.mjs");
const { majJoueur } = await import("./netlify/functions/_lib.mjs");

let ko = 0, n = 0;
const R = (nom, v) => { n++; if (!v) ko++; console.log((v ? "  ok    " : "  ÉCHEC ") + nom); };
let nIp = 0;
async function post(fn, corps, jeton) {
  const h = { "content-type": "application/json", "x-nf-client-connection-ip": "10.0." + (++nIp) + ".1" };
  if (jeton) h.authorization = "Bearer " + jeton;
  const r = await fn(new Request("http://x/api", { method: "POST", headers: h, body: JSON.stringify(corps) }));
  return { code: r.status, ...(await r.json().catch(() => ({}))) };
}
async function get(fn, q) {
  const r = await fn(new Request("http://x/api/bibliotheque" + (q || ""), { method: "GET" }));
  return { code: r.status, ...(await r.json().catch(() => ({}))) };
}
const piste = (id, artist, title, pop, extra) => ({
  id, title, artist, album: "Album", genre: "Hip-Hop/Rap", year: 2019, ms: 200000,
  art: "https://is1-ssl.mzstatic.com/image/thumb/" + id + "/100x100bb.jpg",
  preview: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/" + id + ".m4a",
  url: "https://music.apple.com/fr/album/x/" + id,
  pop, poids: 2, ...(extra || {})
});

/* ============================================================
   UN SEUL ARTISTE PAR CARTE
   Le jeu propose quatre noms et demande « c'est qui ? ». Une carte signée
   « GIMS & Dadju » n'a aucune bonne réponse dans la liste.
   ============================================================ */
console.log("\n=== DÉCOUPER UNE LIGNE DE CRÉDITS ===");
R("un featuring est repéré", biblio.plusieursArtistes("GIMS & Dadju"));
R("une virgule aussi", biblio.plusieursArtistes("XVI, Ninho & Davido"));
R("« feat. » aussi", biblio.plusieursArtistes("Ninho feat. Niska"));
R("un nom seul ne l'est pas", !biblio.plusieursArtistes("Ninho"));
R("un nom composé non plus", !biblio.plusieursArtistes("Hamza Namira"));
R("on retrouve les deux noms", JSON.stringify(biblio.decouper("GIMS & Dadju")) === '["GIMS","Dadju"]');
R("et les trois", biblio.decouper("XVI, Ninho & Davido").length === 3);

console.log("\n=== QUI EST L'ARTISTE PRINCIPAL ===");
{
  const solos = new Map([
    ["ninho", { nom: "Ninho", compte: 30 }],
    ["gazo", { nom: "Gazo", compte: 4 }]
  ]);
  R("celui qui a le plus de titres à son nom", biblio.principal("Gazo & Ninho", solos) === "Ninho");
  R("même écrit en premier", biblio.principal("Ninho & Gazo", solos) === "Ninho");
  R("si aucun n'est connu, on ne devine pas", biblio.principal("Alpha & Beta", solos) === null);
}

console.log("\n=== LA RÉPARATION ===");
{
  const tracks = [];
  for (let i = 0; i < 12; i++) tracks.push(piste("n" + i, "Ninho", "Titre N" + i, 60 + i));
  for (let i = 0; i < 3; i++) tracks.push(piste("g" + i, "Gazo", "Titre G" + i, 40 + i));
  tracks.push(piste("duo1", "Gazo & Ninho", "Mangez-les", 55));
  tracks.push(piste("duo2", "Ninho & Gazo", "Mangez-les", 55));      // même morceau, autre ordre
  tracks.push(piste("solo", "Hamza Namira", "Ailleurs", 30));         // un autre artiste, pas un featuring
  tracks.push(piste("duo3", "Alpha & Beta", "Inconnus", 20));          // deux inconnus : on n'y touche pas
  // un vrai groupe, dont le nom contient des séparateurs
  for (let i = 0; i < 5; i++) tracks.push(piste("e" + i, "Earth, Wind & Fire", "Titre E" + i, 70 + i));
  await biblio.ecrire({ meta: {}, tracks });

  const a = biblio.apercuArtistes(tracks);
  R("l'aperçu annonce exactement ce que la réparation fera", a.aCorriger === 1 && a.aFusionner === 1);
  R("et compte celles qu'il laisse volontairement", a.laissees === 6);
  R("il annonce la fusion à venir", a.aFusionner === 1);
  R("il montre des exemples lisibles",
    a.exemples.length === 2 && a.exemples.every(x => x.avant && x.apres && x.titre));

  const r = await biblio.reparerArtistes();
  R("une carte corrigée et gardée", r.corriges === 1);
  R("une carte en double supprimée", r.fusionnes === 1);
  R("les deux compteurs ne racontent pas la même carte deux fois",
    r.corriges + r.fusionnes === 2);

  const apres = await biblio.lire();
  R("plus aucun featuring déguisé en artiste",
    !apres.tracks.some(t => /GIMS|Gazo &|& Gazo/.test(t.artist)));
  const duo = apres.tracks.find(t => t.title === "Mangez-les");
  R("le duo est signé du plus connu des deux", duo.artist === "Ninho");
  R("et la ligne complète est gardée en crédits", /Gazo/.test(duo.credits) && /Ninho/.test(duo.credits));
  R("l'artiste au nom composé n'a pas été touché",
    apres.tracks.some(t => t.artist === "Hamza Namira"));
  R("le groupe au nom à rallonge est intact",
    apres.tracks.filter(t => t.artist === "Earth, Wind & Fire").length === 5);
  R("le duo d'inconnus est laissé tel quel",
    apres.tracks.some(t => t.artist === "Alpha & Beta"));
  R("rien d'autre n'a bougé", apres.tracks.length === 23);

  const r2 = await biblio.reparerArtistes();
  R("relancer la réparation ne change plus rien", r2.corriges === 0 && r2.fusionnes === 0);
}

console.log("\n=== LE BOUTON DE MODÉRATION ===");
{
  // Le tout premier compte du site est le fondateur, donc administrateur :
  // c'est le deuxième qui joue le rôle du joueur ordinaire.
  const j = (await post(compte, { action: "inscription", pseudo: "Patronne", mdp: "motdepasse1" })).jeton;
  const jq = (await post(compte, { action: "inscription", pseudo: "Quidam", mdp: "motdepasse1" })).jeton;
  let r = await post(moderation, { action: "artistes", apercu: true }, jq);
  R("un joueur ordinaire n'y touche pas", r.code === 403);
  r = await post(moderation, { action: "artistes" }, jq);
  R("et il ne peut pas non plus la lancer", r.code === 403);
  await post(compte, { action: "admin", cle: process.env.DIGGERS_ADMIN }, j);
  r = await post(moderation, { action: "artistes", apercu: true }, j);
  R("l'administratrice peut regarder avant d'agir", r.code === 200 && r.apercu === true);
  R("et il ne reste rien à corriger", r.aCorriger === 0);
}

/* ============================================================
   COMBIEN D'EXEMPLAIRES EXISTENT VRAIMENT
   ============================================================ */
console.log("\n=== LA VUE PUBLIQUE ===");
let r = await get(bibliotheque);
R("elle s'ouvre sans compte", r.code === 200);
R("elle annonce le nombre de titres", r.meta.titres === 23);
R("aucun exemplaire tant que personne ne joue", r.meta.exemplaires === 0);
R("elle rend les cartes avec leur rareté", r.cartes.length > 0 && !!r.cartes[0].rareteNom);
R("elle ne cache ni titre ni artiste", r.cartes.every(c => c.title && c.artist));
R("elle donne le nombre d'exemplaires de chaque carte",
  r.cartes.every(c => typeof c.exemplaires === "number"));
R("et le détail par rareté", r.meta.parRarete.length === 6);

console.log("\n=== ON COMPTE POUR DE VRAI ===");
{
  const U = await store("utilisateurs");
  const pseudos = ["Ana", "Bilal", "Cléo"];
  const uids = {};
  for (const p of pseudos) {
    const j = (await post(compte, { action: "inscription", pseudo: p, mdp: "motdepasse1" })).jeton;
    await post(jeu, { action: "carton", type: "jour" }, j);
    uids[p] = (await (await store("pseudos")).get(p.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, ""))).uid;
  }
  // on force une carte connue chez deux joueuses, dont un doublon
  await majJoueur(uids.Ana, u => {
    u.jeu.coffre = [
      { uid: "a1", id: "n0", press: "Vinyle", rarity: 3, known: true },
      { uid: "a2", id: "n0", press: "Standard", rarity: 3, known: true },
      { uid: "a3", id: "n1", press: "Or ✦", rarity: 3, known: true }
    ];
    return u;
  });
  await majJoueur(uids.Bilal, u => {
    u.jeu.coffre = [{ uid: "b1", id: "n0", press: "Standard", rarity: 3, known: true }];
    return u;
  });
  await majJoueur(uids.Cléo, u => { u.jeu.coffre = []; return u; });
  await (await store("cache")).del("exemplaires");   // on refait le compte tout de suite

  const v = await get(bibliotheque, "?q=Titre N0");
  const c = v.cartes.find(x => x.id === "n0");
  R("la carte est retrouvée par la recherche", !!c);
  R("trois exemplaires en circulation", c.exemplaires === 3);
  R("chez deux joueuses seulement", c.proprietaires === 2);
  R("le détail des pressages est juste",
    JSON.stringify(c.pressages) === JSON.stringify([{ n: "Standard", nb: 2 }, { n: "Vinyle", nb: 1 }]));
  R("le total du jeu est juste", v.meta.exemplaires === 4);
  R("et le nombre de joueurs aussi", v.meta.joueurs === 3);

  const or = await get(bibliotheque, "?q=Titre N1");
  const c2 = or.cartes.find(x => x.id === "n1");
  R("un pressage Or est compté comme tel",
    c2.pressages.length === 1 && c2.pressages[0].n === "Or ✦" && c2.pressages[0].nb === 1);
}

console.log("\n=== CHERCHER, TRIER, TOURNER LES PAGES ===");
{
  let v = await get(bibliotheque, "?q=gazo");
  R("la recherche filtre sur l'artiste", v.total > 0 && v.cartes.every(c => /gazo/i.test(c.artist + c.credits)));
  v = await get(bibliotheque, "?q=zzzzzz");
  R("une recherche sans réponse ne plante pas", v.code === 200 && v.total === 0);

  v = await get(bibliotheque, "?tri=rare");
  const pops = v.cartes.map(c => c.pop);
  R("le tri par rareté met les plus confidentiels devant",
    pops.every((p, i) => i === 0 || pops[i - 1] <= p));
  v = await get(bibliotheque, "?tri=commun");
  const pops2 = v.cartes.map(c => c.pop);
  R("et le tri inverse les plus connus", pops2.every((p, i) => i === 0 || pops2[i - 1] >= p));

  v = await get(bibliotheque, "?tri=repandu");
  R("on peut trier par nombre d'exemplaires", v.cartes[0].exemplaires >= v.cartes[1].exemplaires);

  v = await get(bibliotheque, "?rarete=3");
  R("on peut ne regarder qu'un palier", v.cartes.every(c => c.rarete === 3));

  v = await get(bibliotheque, "?page=99");
  R("une page hors limite retombe sur la dernière", v.page === v.pages);
}

console.log("\n=== CE QUI NE DOIT PAS FUITER ===");
{
  const v = await get(bibliotheque);
  R("aucune adresse d'extrait n'est publiée ici",
    v.cartes.every(c => c.preview === undefined));
  R("aucun identifiant de joueur non plus",
    !JSON.stringify(v).includes("uid\":\"a1"));
}

/* La même règle vit à trois endroits : le serveur (pour réparer), le
   constructeur en ligne de commande et celui du navigateur (pour ne plus
   laisser entrer le problème). Si l'un dérive, le jeu redevient injouable
   sans que rien ne casse — donc on compare les trois. */
console.log("\n=== LA MÊME RÈGLE PARTOUT ===");
{
  const { readFile } = await import("node:fs/promises");
  const motif = /\/\\s\*\(\?:,\|&\|\\\/\|\\bfeat[^\n]*?\/i/;
  const trouve = async f => {
    const t = await readFile(f, "utf8");
    const m = t.match(/SEP_ARTISTES\s*=\s*(\/[^\n]+?\/i)\s*;/);
    return m ? m[1] : null;
  };
  const a1 = await trouve("./netlify/functions/_biblio.mjs");
  const a2 = await trouve("./build-catalogue.mjs");
  const a3 = await trouve("./index.html");
  R("le serveur porte la règle", !!a1);
  R("le constructeur en ligne de commande aussi", !!a2);
  R("et celui du navigateur aussi", !!a3);
  R("les trois sont identiques", a1 === a2 && a2 === a3);

  const u = (await import("./netlify/functions/_biblio.mjs"));
  R("un homonyme n'est pas un featuring", !u.plusieursArtistes("Haris Hamza"));
  R("un groupe au nom composé non plus", !u.plusieursArtistes("Tame Impala"));
  R("mais « Earth, Wind & Fire » en est un au sens du découpage",
    u.plusieursArtistes("Earth, Wind & Fire"));
}

console.log("\n" + (ko ? ko + " ÉCHEC(S) sur " + n : n + " vérifications, aucune erreur"));
await rm(".data-bib", { recursive: true, force: true });
process.exit(ko ? 1 : 0);
