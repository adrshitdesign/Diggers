// Vérifications du jeu tenu par le serveur : tirage, enquête, économie,
// Set quotidien, et marché entre joueurs.
//   node test-jeu.mjs

import { rm } from "node:fs/promises";

process.env.DIGGERS_STORE = "fichiers";
process.env.DIGGERS_DATA = ".data-jeu";
process.env.DIGGERS_SECRET = "test";
await rm(".data-jeu", { recursive: true, force: true });

const compte = (await import("./netlify/functions/compte.mjs")).default;
const jeu = (await import("./netlify/functions/jeu.mjs")).default;
const marche = (await import("./netlify/functions/marche.mjs")).default;
const J = await import("./netlify/functions/jeu.mjs");
const biblio = await import("./netlify/functions/_biblio.mjs");
const { store } = await import("./netlify/functions/_store.mjs");

let ko = 0, n = 0;
const R = (nom, v) => { n++; if (!v) ko++; console.log((v ? "  ok    " : "  ÉCHEC ") + nom); };

async function post(fn, corps, jeton) {
  const h = { "content-type": "application/json" };
  if (jeton) h.authorization = "Bearer " + jeton;
  const r = await fn(new Request("http://x/api", { method: "POST", headers: h, body: JSON.stringify(corps) }));
  return { code: r.status, ...(await r.json().catch(() => ({}))) };
}

/* ---------- une bibliothèque de test ---------- */
const ARTISTES = ["Sœur K", "Bloc 4", "Nina Rey", "Vaudou Club", "Le Perchoir", "Marda",
  "Kosmo", "Ivy Sax", "Tchoupi Sound", "Ferro", "Halcyon", "Dune 3"];
const GENRES = ["Hip-Hop/Rap", "Pop", "Électro", "Jazz"];
const tracks = [];
ARTISTES.forEach((a, i) => {
  // Six titres par artiste, étalés sur toutes les époques, toutes les durées
  // et toutes les popularités : quelle que soit la contrainte du jour, il y a
  // de quoi composer un set.
  for (let k = 0; k < 6; k++) {
    tracks.push({
      id: "c" + i + "x" + k,
      title: "Titre " + i + "-" + k,
      artist: a,
      album: "Album " + i,
      genre: GENRES[(i + k) % GENRES.length],
      year: [1972, 1988, 1996, 2004, 2015, 2022][k],
      ms: k % 2 ? 300000 : 180000,
      art: "https://is1-ssl.mzstatic.com/image/thumb/x" + i + k + "/100x100bb.jpg",
      preview: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/" + i + k + ".m4a",
      url: "https://music.apple.com/fr/album/x/" + i + k,
      pop: [95, 78, 60, 40, 20, 5][k] - (i % 5)
    });
  }
});
await biblio.ecrire({ meta: {}, tracks });

console.log("\n=== LE JEU EST AU SERVEUR ===");
let r = await post(compte, { action: "inscription", pseudo: "Mila", mdp: "motdepasse1" });
const jMila = r.jeton;
r = await post(compte, { action: "inscription", pseudo: "Théo", mdp: "motdepasse1" });
const jTheo = r.jeton;

r = await post(compte, { action: "sauver", code: "triche", resume: { cartes: 9999, taux: 100 } }, jMila);
R("on ne peut plus déposer sa propre sauvegarde", r.code === 410);

r = await post(jeu, { action: "etat" }, jMila);
R("un joueur neuf a 400 crédits et une étagère vide",
  r.code === 200 && r.etat.credits === 400 && r.etat.coffre.length === 0);
R("le carton du jour est disponible", r.etat.jourDispo === true);
R("le taux d'identification est encore vide", r.etat.taux === null);

r = await post(jeu, { action: "etat" }, "faux-jeton");
R("sans jeton valable, aucun état", r.code === 401);

console.log("\n=== OUVRIR UN CARTON ===");
r = await post(jeu, { action: "carton", type: "jour" }, jMila);
R("le carton du jour donne cinq cartes", r.code === 200 && r.cartes.length === 5);
R("il ne coûte rien", r.etat.credits === 400);
R("il n'est ouvrable qu'une fois", (await post(jeu, { action: "carton", type: "jour" }, jMila)).code === 429);

const c0 = r.cartes[0];
R("une carte face cachée ne dit ni titre ni artiste",
  c0.title === undefined && c0.artist === undefined && c0.id === undefined);
R("elle ne livre ni pochette ni extrait", c0.art === undefined && c0.preview === undefined);
R("elle propose quatre réponses", Array.isArray(c0.choices) && c0.choices.length === 4);
R("elle vaut 26 crédits tant qu'on n'a rien demandé", c0.valeur === 26);

r = await post(jeu, { action: "carton", type: "std" }, jMila);
R("un carton standard coûte 100 crédits", r.code === 200 && r.etat.credits === 300);
r = await post(jeu, { action: "carton", type: "scene" }, jTheo);
R("un carton de scène coûte 220 crédits", r.code === 200 && r.etat.credits === 180);
r = await post(jeu, { action: "carton", type: "or" }, jMila);
R("un carton inventé est refusé", r.code === 400);

console.log("\n=== L'ENQUÊTE ===");
r = await post(jeu, { action: "indice", uid: c0.uid, cle: "audio" }, jMila);
R("l'extrait ne coûte rien", r.code === 200 && r.etat.credits === 300);
R("il livre enfin l'adresse du son", !!r.carte.indices.preview);
R("mais il marque la carte comme écoutée", r.carte.heard === true);

r = await post(jeu, { action: "indice", uid: c0.uid, cle: "album" }, jMila);
R("l'album se paie sur le gain, pas sur la caisse", r.carte.valeur === 21 && r.etat.credits === 300);
r = await post(jeu, { action: "indice", uid: c0.uid, cle: "fausse-cle" }, jMila);
R("un indice inventé est refusé", r.code === 400);

r = await post(jeu, { action: "repondre", uid: c0.uid, choix: "Personne D'ici" }, jMila);
R("on ne peut pas répondre hors des propositions", r.code === 400);

// on triche pour connaître la bonne réponse : le test a le droit, pas le joueur.
let dossier = await (await store("utilisateurs")).get((await post(compte, { action: "moi" }, jMila)).moi.uid);
const vraie = tracks.find(t => t.id === dossier.jeu.coffre[0].id);
const faux = dossier.jeu.coffre[0].choices.find(x => x !== vraie.artist);

r = await post(jeu, { action: "repondre", uid: c0.uid, choix: faux }, jMila);
R("une mauvaise réponse ne rapporte rien", r.code === 200 && r.bon === false && r.etat.credits === 300);
R("elle fait tomber la valeur de la carte", r.valeur === 8);

r = await post(jeu, { action: "repondre", uid: c0.uid, choix: vraie.artist }, jMila);
R("la bonne réponse paie ce qu'il reste", r.code === 200 && r.bon === true && r.gain === 8 && r.etat.credits === 308);
R("la carte se retourne enfin", r.carte.known === true && r.carte.artist === vraie.artist);
R("elle n'est pas trouvée à sec", r.aSec === false);
R("le taux d'identification existe maintenant", r.etat.taux !== null);
R("on ne répond pas deux fois", (await post(jeu, { action: "repondre", uid: c0.uid, choix: vraie.artist }, jMila)).code === 409);

// une carte trouvée du premier coup, sans rien demander
dossier = await (await store("utilisateurs")).get(dossier.uid);
const propre = dossier.jeu.coffre.find(c => !c.known);
const bonne = tracks.find(t => t.id === propre.id).artist;
r = await post(jeu, { action: "repondre", uid: propre.uid, choix: bonne }, jMila);
R("trouvée du premier coup : 26 crédits et le statut à sec",
  r.bon === true && (r.gain === 26 || r.doublon === true) && (r.aSec === true));

console.log("\n=== FONDRE, PRESSER ===");
r = await post(jeu, { action: "presser", id: tracks[0].id }, jMila);
R("presser sans éclats est refusé", r.code === 402);

// on donne des éclats et deux exemplaires du même titre
dossier = await (await store("utilisateurs")).get(dossier.uid);
dossier.jeu.eclats = 20000;
const modele = { id: tracks[3].id, rarity: 3, press: "Standard", known: true, reveals: null, aSec: false, achete: false, tries: 0, heard: false, indices: [], choices: [] };
dossier.jeu.coffre.push({ ...modele, uid: "dbl-1" }, { ...modele, uid: "dbl-2", press: "Vinyle" });
await (await store("utilisateurs")).set(dossier.uid, dossier);

r = await post(jeu, { action: "fondre", uids: ["dbl-1", "dbl-2"] }, jMila);
R("fondre ne prend que le doublon, jamais le meilleur exemplaire", r.code === 200 && r.fondus === 1);
R("le vinyle est resté", r.etat.coffre.some(c => c.uid === "dbl-2") && !r.etat.coffre.some(c => c.uid === "dbl-1"));
r = await post(jeu, { action: "fondre", uids: ["dbl-2"] }, jMila);
R("un exemplaire unique ne se fond pas", r.code === 400);

r = await post(jeu, { action: "presser", id: tracks[0].id }, jMila);
R("presser donne une carte reconnue, marquée achetée",
  r.code === 200 && r.carte.known === true && r.carte.achete === true);
R("et retire les éclats", r.etat.eclats < 20000);

console.log("\n=== LE SET ===");
r = await post(jeu, { action: "set" }, jMila);
R("le Set annonce la contrainte du jour", r.code === 200 && typeof r.contrainte.l === "string");
r = await post(jeu, { action: "set-jouer", uids: ["a", "b", "c"] }, jMila);
R("il faut cinq cartes", r.code === 400);

// cinq cartes reconnues, cinq artistes, sans contrainte gênante
dossier = await (await store("utilisateurs")).get(dossier.uid);
const cont = J.contrainteDuJour();
const bons = tracks.filter(t => cont.f({ ...t, rarity: J.tierOf(t.pop) }));
const parArtiste = [];
for (const t of bons) if (!parArtiste.some(x => x.artist === t.artist)) parArtiste.push(t);
const cinq = parArtiste.slice(0, 5);
const uids = cinq.map((t, i) => "set-" + i);
cinq.forEach((t, i) => dossier.jeu.coffre.push({
  uid: uids[i], id: t.id, rarity: J.tierOf(t.pop), press: "Standard", known: true,
  reveals: null, aSec: false, achete: false, tries: 0, heard: false, indices: [], choices: []
}));
await (await store("utilisateurs")).set(dossier.uid, dossier);

if (cinq.length === 5) {
  const avant = (await post(jeu, { action: "etat" }, jMila)).etat.credits;
  r = await post(jeu, { action: "set-jouer", uids }, jMila);
  R("le set est noté par le serveur", r.code === 200 && r.note.total >= 0 && r.note.total <= 100);
  R("l'adversaire respecte la contrainte du jour", r.adverse.length === 5);
  R("le gain suit le résultat", r.etat.credits === avant + r.gain && [12, 20, 40].includes(r.gain));
  r = await post(jeu, { action: "set-jouer", uids: [uids[0], uids[0], uids[1], uids[2], uids[3]] }, jMila);
  R("deux fois la même carte est refusé", r.code === 400);
} else {
  R("bibliothèque de test suffisante pour un set", false);
}

console.log("\n=== LE MARCHÉ EST AUX JOUEURS ===");
dossier = await (await store("utilisateurs")).get(dossier.uid);
const aVendre = dossier.jeu.coffre.find(c => c.known && c.press !== "Test press");

r = await post(marche, { action: "poser", uid: aVendre.uid, prix: 250 }, jMila);
R("poser une carte la sort de l'étagère",
  r.code === 200 && !r.etat.coffre.some(c => c.uid === aVendre.uid));
const annonce = r.annonce.id;
r = await post(marche, { action: "poser", uid: aVendre.uid, prix: 250 }, jMila);
R("on ne la pose pas deux fois", r.code === 404);
r = await post(marche, { action: "poser", uid: aVendre.uid, prix: -5 }, jMila);
R("un prix négatif est refusé", r.code === 400);

r = await post(marche, { action: "liste" }, jTheo);
R("l'annonce est visible par les autres", r.code === 200 && r.annonces.some(a => a.id === annonce));
R("elle affiche l'écart avec la cote", typeof r.annonces[0].ecart === "number");

r = await post(marche, { action: "acheter", id: annonce }, jMila);
R("on n'achète pas sa propre annonce", r.code === 409);

// Théo a dépensé pour son carton de scène : on lui rend de quoi acheter.
{
  const dT = await (await store("pseudos")).get("theo");
  const uT = await (await store("utilisateurs")).get(dT.uid);
  uT.jeu.credits = 1000;
  await (await store("utilisateurs")).set(dT.uid, uT);
}
const soldeTheoAvant = (await post(jeu, { action: "etat" }, jTheo)).etat.credits;
const soldeMilaAvant = (await post(jeu, { action: "etat" }, jMila)).etat.credits;
r = await post(marche, { action: "acheter", id: annonce }, jTheo);
R("l'acheteur reçoit la carte", r.code === 200 && r.etat.coffre.some(c => c.uid === aVendre.uid));
R("il paie le prix demandé", r.etat.credits === soldeTheoAvant - 250);
R("la carte achetée ne compte pas dans le taux", r.achetee.achete === true);
r = await post(jeu, { action: "etat" }, jMila);
R("le vendeur est payé", r.etat.credits === soldeMilaAvant + 250);
r = await post(marche, { action: "acheter", id: annonce }, jTheo);
R("une annonce vendue ne se rachète pas", r.code === 404 || r.code === 409);

console.log("\n=== L'ÉCHANGE ===");
dossier = await (await store("utilisateurs")).get(dossier.uid);
const encore = dossier.jeu.coffre.find(c => c.known && c.press !== "Test press");
r = await post(marche, { action: "poser", uid: encore.uid, prix: 900 }, jMila);
const a2 = r.annonce.id;

let dTheo = await (await store("pseudos")).get("theo");
let uTheo = await (await store("utilisateurs")).get(dTheo.uid);
const sien = uTheo.jeu.coffre.find(c => c.known);
r = await post(marche, { action: "offrir", id: a2, uid: sien.uid }, jTheo);
R("proposer un échange sort la carte de l'étagère de celui qui propose",
  r.code === 200 && !r.etat.coffre.some(c => c.uid === sien.uid));
r = await post(marche, { action: "offrir", id: a2, uid: sien.uid }, jTheo);
R("on ne fait qu'une offre par annonce", r.code === 409 || r.code === 404);

r = await post(marche, { action: "miennes" }, jMila);
const off = r.annonces.find(a => a.id === a2);
R("le vendeur voit l'offre et la carte proposée",
  !!off && off.detailOffres.length === 1 && !!off.detailOffres[0].carte.artist);

r = await post(marche, { action: "repondre-offre", id: a2, offre: off.detailOffres[0].id, oui: true }, jMila);
R("le vendeur accepte : il reçoit la carte proposée",
  r.code === 200 && r.etat.coffre.some(c => c.uid === sien.uid));
r = await post(jeu, { action: "etat" }, jTheo);
R("et celui qui proposait reçoit l'annonce", r.etat.coffre.some(c => c.uid === encore.uid));

console.log("\n=== LE RETRAIT REND TOUT ===");
dossier = await (await store("utilisateurs")).get(dossier.uid);
const troisieme = dossier.jeu.coffre.find(c => c.known && c.press !== "Test press");
r = await post(marche, { action: "poser", uid: troisieme.uid, prix: 40 }, jMila);
const a3 = r.annonce.id;
uTheo = await (await store("utilisateurs")).get(dTheo.uid);
const offert = uTheo.jeu.coffre.find(c => c.known);
await post(marche, { action: "offrir", id: a3, uid: offert.uid }, jTheo);
r = await post(marche, { action: "retirer", id: a3 }, jMila);
R("retirer son annonce rend la carte au vendeur",
  r.code === 200 && r.etat.coffre.some(c => c.uid === troisieme.uid));
r = await post(jeu, { action: "etat" }, jTheo);
R("et rend sa carte à celui qui avait proposé un échange",
  r.etat.coffre.some(c => c.uid === offert.uid));

console.log("\n" + n + " vérifications, " + (ko ? ko + " ÉCHEC(S)" : "aucune erreur"));
await rm(".data-jeu", { recursive: true, force: true });
process.exit(ko ? 1 : 0);
