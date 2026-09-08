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
const { majJoueur, norm } = await import("./netlify/functions/_lib.mjs");

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

/* LA RÈGLE, DEPUIS LA v2.7 : le premier nom cité possède le morceau.
   Avant, on gardait le plus connu des noms — plus malin, et faux : le même
   morceau changeait de propriétaire à mesure que la bibliothèque grossissait. */
console.log("\n=== QUI EST L'ARTISTE PRINCIPAL ===");
{
  R("le premier nom cité, toujours", biblio.principal("Gazo & Ninho") === "Gazo");
  R("même si l'autre est plus connu", biblio.principal("Ninho & Gazo") === "Ninho");
  R("un « feat. » ne change rien à la règle", biblio.principal("Ninho feat. Niska") === "Ninho");
  R("une virgule non plus", biblio.principal("XVI, Ninho & Davido") === "XVI");
  R("un nom seul n'a pas d'artiste principal", biblio.principal("Ninho") === null);

  R("« feat. » est une collaboration explicite", biblio.collaborationExplicite("A feat. B"));
  R("« avec » aussi", biblio.collaborationExplicite("A avec B"));
  R("« & » ne l'est pas — ça peut être un nom de groupe",
    !biblio.collaborationExplicite("Earth, Wind & Fire"));

  /* Un nom qui revient sur trois titres ou plus est un groupe, pas un duo
     d'un soir : on n'y touche pas. Sauf s'il porte un « feat. ». */
  const groupe = new Map([["earthwindfire", 5], ["afeatb", 5]]);
  R("un groupe est laissé entier",
    biblio.artistePrincipal("Earth, Wind & Fire", { lignes: groupe }) === null);
  R("mais un « feat. » répété reste un featuring",
    biblio.artistePrincipal("A feat. B", { lignes: groupe }) === "A");
  R("un duo qui n'a qu'un titre est découpé",
    biblio.artistePrincipal("Gazo & Ninho", { lignes: new Map([["gazoninho", 1]]) }) === "Gazo");
  R("un nom déclaré entier n'est jamais découpé",
    biblio.artistePrincipal("Simon & Garfunkel", { entiers: new Set(["simongarfunkel"]) }) === null);
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
  /* « Gazo & Ninho » devient Gazo, « Ninho & Gazo » devient Ninho : ce ne sont
     plus le même morceau, donc plus rien à fusionner. C'est la contrepartie
     assumée de la règle du premier nommé — elle est déterministe, elle n'est
     pas maligne. La modération voit les deux et tranche si elle veut. */
  R("l'aperçu annonce exactement ce que la réparation fera",
    a.aCorriger === 3 && a.aFusionner === 0);
  R("et compte celles qu'il laisse volontairement", a.laissees === 5);
  R("il nomme les groupes qu'il garde entiers",
    a.groupes.some(x => x.nom === "Earth, Wind & Fire" && x.titres === 5));
  R("il montre des exemples lisibles",
    a.exemples.length === 3 && a.exemples.every(x => x.avant && x.apres && x.titre));

  const r = await biblio.reparerArtistes();
  R("les trois lignes à plusieurs noms sont ramenées à un seul", r.corriges === 3);
  R("rien n'est fusionné à tort", r.fusionnes === 0);

  const apres = await biblio.lire();
  R("plus aucun featuring déguisé en artiste",
    !apres.tracks.some(t => /Gazo &|& Gazo/.test(t.artist)));
  const duos = apres.tracks.filter(t => t.title === "Mangez-les");
  R("chaque duo est signé de son premier nom",
    duos.length === 2 && duos.some(t => t.artist === "Gazo") && duos.some(t => t.artist === "Ninho"));
  const duo = duos[0];
  R("et la ligne complète est gardée en crédits", /Gazo/.test(duo.credits) && /Ninho/.test(duo.credits));
  R("l'artiste au nom composé n'a pas été touché",
    apres.tracks.some(t => t.artist === "Hamza Namira"));
  R("un duo de deux inconnus est découpé comme les autres",
    apres.tracks.some(t => t.title === "Inconnus" && t.artist === "Alpha"));
  R("le groupe au nom à rallonge est intact",
    apres.tracks.filter(t => t.artist === "Earth, Wind & Fire").length === 5);
  R("aucune carte n'a disparu", apres.tracks.length === 24);

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
  await post(compte, { action: "promouvoir", cle: process.env.DIGGERS_ADMIN }, j);
  r = await post(moderation, { action: "artistes", apercu: true }, j);
  R("l'administratrice peut regarder avant d'agir", r.code === 200 && r.apercu === true);
  R("et il ne reste rien à corriger", r.aCorriger === 0);
}

/* ============================================================
   LA LISTE D'ARTISTES SE RÈGLE DEPUIS L'ÉCRAN
   Avant, ajouter un artiste voulait dire modifier index.html, republier le
   site et recommencer. C'était le principal frein à faire grossir le jeu.
   ============================================================ */
console.log("\n=== LA LISTE D'ARTISTES ===");
{
  const j = (await post(compte, { action: "inscription", pseudo: "Cheffe", mdp: "motdepasse1" })).jeton;
  const jq = (await post(compte, { action: "inscription", pseudo: "Badaud", mdp: "motdepasse1" })).jeton;
  await post(compte, { action: "promouvoir", cle: process.env.DIGGERS_ADMIN }, j);

  let r = await post(moderation, { action: "liste-artistes" }, j);
  R("au départ il n'y a pas de liste enregistrée", r.code === 200 && r.liste === null);

  r = await post(moderation, { action: "liste-artistes", artistes: ["Jul", "Ninho"] }, jq);
  R("un joueur ordinaire n'écrit pas la liste", r.code === 403);

  r = await post(moderation, { action: "liste-artistes", artistes: [
    "Jul", ["Ninho", 3], ["Fishbach", 1], "  ", "jul", ["Gazo", 9], ["Sofiane Pamart"]
  ] }, j);
  R("l'administratrice enregistre la liste", r.code === 200);
  R("le poids par défaut est 2", r.liste.find(x => x[0] === "Jul")[1] === 2);
  R("un poids donné est gardé", r.liste.find(x => x[0] === "Ninho")[1] === 3);
  R("un poids hors bornes est ramené dans les clous", r.liste.find(x => x[0] === "Gazo")[1] === 3);
  R("les lignes vides sautent", !r.liste.some(x => !x[0].trim()));
  R("les doublons aussi, même écrits autrement", r.liste.filter(x => norm(x[0]) === "jul").length === 1);
  R("elle compte ce qui est entré et ce qui est tombé", r.enregistres === 5 && r.ignores === 2);

  r = await post(moderation, { action: "liste-artistes" }, jq);
  R("un joueur ordinaire ne la lit pas non plus", r.code === 403);
  r = await post(moderation, { action: "liste-artistes" }, j);
  R("la modération la relit telle quelle", r.code === 200 && r.liste.length === 5);
  R("on sait qui l'a écrite et quand", r.par === "Cheffe" && r.maj > 0);

  r = await post(moderation, { action: "liste-artistes", artistes: [] }, j);
  R("une liste vide est refusée plutôt qu'enregistrée", r.code === 400);
  r = await post(moderation, { action: "liste-artistes" }, j);
  R("et l'ancienne est toujours là", r.liste.length === 5);

  r = await post(moderation, { action: "liste-artistes",
    artistes: Array.from({ length: 3100 }, (_, i) => "Artiste " + i) }, j);
  R("une liste démesurée est refusée", r.code === 413);

  r = await post(moderation, { action: "liste-artistes-defaut" }, jq);
  R("un joueur ordinaire ne remet pas la liste d'origine", r.code === 403);
  r = await post(moderation, { action: "liste-artistes-defaut" }, j);
  R("l'administratrice, si", r.code === 200);
  r = await post(moderation, { action: "liste-artistes" }, j);
  R("et le jeu reprend sa liste d'origine", r.liste === null);
}

/* ============================================================
   COMBIEN D'EXEMPLAIRES EXISTENT VRAIMENT
   ============================================================ */
console.log("\n=== LA VUE PUBLIQUE ===");
let r = await get(bibliotheque);
R("elle s'ouvre sans compte", r.code === 200);
R("elle annonce le nombre de titres", r.meta.titres === 24);
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

/* ============================================================
   RELIRE LE TRAVAIL DE LA RÉPARATION
   Un compteur ne dit pas si le travail est bien fait. Cet écran montre les
   deux côtés de la décision, et permet de revenir en arrière.
   ============================================================ */
/* La porte d'entrée doit protéger les groupes elle aussi, pas seulement la
   réparation. Le premier test du navigateur a montré le contraire : importer
   quatre titres de « Vent, Terre & Feu » les découpait un par un, parce que
   normaliserImport ne savait pas compter les signatures. */
/* « J'ai toujours le même nombre de sons que dans l'import de bibliothèque » :
   tout ce qu'on ajoutait après coup se confondait avec le fonds de départ,
   parce que rien ne datait les entrées. */
console.log("\n=== QUAND UN SON EST-IL ENTRÉ ? ===");
{
  await biblio.ecrire({ meta: {}, tracks: [] });
  await biblio.importer([piste("d1", "Un", "Titre A", 60), piste("d2", "Deux", "Titre B", 60)]);
  let b = await biblio.lire();
  R("chaque son entré porte sa date", b.tracks.every(t => t.ajouteLe > 0));
  R("la bibliothèque compte les ajouts de la semaine", b.meta.ajouts7 === 2);
  R("et ceux du mois", b.meta.ajouts30 === 2);
  R("et combien de sons portent une date", b.meta.dates === 2);

  /* Un son entré il y a longtemps ne compte pas dans les ajouts récents. */
  b.tracks[0].ajouteLe = Date.now() - 40 * 86400000;
  await biblio.ecrire(b);
  b = await biblio.lire();
  R("un son vieux de quarante jours sort des sept derniers", b.meta.ajouts7 === 1);
  R("et des trente derniers aussi", b.meta.ajouts30 === 1);
  R("mais il reste compté dans le total", b.meta.titres === 2);

  /* Les sons d'avant cette version n'ont pas de date : on ne leur en invente
     pas une, ils comptent comme fonds de départ. */
  const sansDate = piste("vieux", "Trois", "Titre C", 60);
  delete sansDate.ajouteLe;
  b.tracks.push(sansDate);
  await biblio.ecrire(b);
  b = await biblio.lire();
  R("un son sans date ne passe pas pour un ajout récent", b.meta.ajouts7 === 1);
  R("et le fonds de départ se déduit du total", b.meta.titres - b.meta.dates === 1);
}

console.log("\n=== LA PORTE D'ENTRÉE PROTÈGE LES GROUPES ===");
{
  await biblio.ecrire({ meta: {}, tracks: [] });
  const lot = [];
  for (let i = 0; i < 4; i++) lot.push(piste("vt" + i, "Vent, Terre & Feu", "Titre " + i, 60));
  lot.push(piste("duo", "Kosmo & Marda", "Deux voix", 55));
  lot.push(piste("ft", "Kosmo feat. Marda", "Invitée", 55));
  await biblio.importer(lot);
  const b = await biblio.lire();
  const nom = id => (b.tracks.find(t => String(t.id) === id) || {}).artist;

  R("un groupe importé d'un bloc reste entier", nom("vt0") === "Vent, Terre & Feu");
  R("ses quatre titres aussi",
    b.tracks.filter(t => t.artist === "Vent, Terre & Feu").length === 4);
  R("un duo isolé est découpé dès l'import", nom("duo") === "Kosmo");
  R("et la ligne complète part en crédits",
    (b.tracks.find(t => String(t.id) === "duo") || {}).credits === "Kosmo & Marda");
  R("un « feat. » est découpé même s'il se répète", nom("ft") === "Kosmo");

  /* Un cinquième titre du groupe, importé plus tard : la bibliothèque le
     connaît déjà, il reste entier. */
  await biblio.importer([piste("vt9", "Vent, Terre & Feu", "Tardif", 60)]);
  const b2 = await biblio.lire();
  R("un titre ajouté plus tard reconnaît son groupe",
    (b2.tracks.find(t => String(t.id) === "vt9") || {}).artist === "Vent, Terre & Feu");
}

console.log("\n=== LES NOMS COMPOSÉS, À LA LOUPE ===");
{
  const jAdmin = (await post(compte, { action: "inscription", pseudo: "Relecteur", mdp: "motdepasse1" })).jeton;
  await post(compte, { action: "promouvoir", cle: "cle-admin-de-test" }, jAdmin);

  const tracks = [];
  for (let i = 0; i < 4; i++) tracks.push(piste("z" + i, "Ninho", "Solo " + i, 60));
  tracks.push(piste("duoA", "Gazo & Ninho", "Ensemble", 55));
  tracks.push(piste("duoB", "Gazo & Ninho", "Encore", 55));
  for (let i = 0; i < 4; i++) tracks.push(piste("gr" + i, "Earth, Wind & Fire", "Titre " + i, 70));
  await biblio.ecrire({ meta: {}, tracks });
  await biblio.reparerArtistes();

  let r = await post(moderation, { action: "composes" }, jAdmin);
  R("l'écran s'ouvre", r.code === 200);
  R("il montre ce qui a été découpé", r.decoupes.length === 1);
  R("avec l'avant et l'après", r.decoupes[0].avant === "Gazo & Ninho" && r.decoupes[0].apres === "Gazo");
  R("et combien de cartes sont concernées", r.decoupes[0].titres === 2);
  R("il donne des exemples de titres", r.decoupes[0].exemples.length === 2);
  R("il montre aussi ce qui a été laissé entier", r.gardes.length === 1);
  R("le groupe est nommé", r.gardes[0].nom === "Earth, Wind & Fire" && r.gardes[0].titres === 4);
  R("et le jeu dit à partir de combien de titres il protège", r.seuil === 3);

  /* On annule le découpage : les cartes reprennent leur nom entier ET la
     ligne est protégée, sinon la réparation suivante recommencerait. */
  r = await post(moderation, { action: "retablir", ligne: "Gazo & Ninho" }, jAdmin);
  R("annuler un découpage rend les cartes", r.code === 200 && r.rendues === 2);
  const apres = await biblio.lire();
  R("elles portent de nouveau le nom entier",
    apres.tracks.filter(t => t.artist === "Gazo & Ninho").length === 2);
  R("et n'ont plus de ligne de crédits en double",
    apres.tracks.filter(t => t.artist === "Gazo & Ninho").every(t => !t.credits));

  const prot = await post(moderation, { action: "noms-entiers" }, jAdmin);
  R("la ligne est protégée dans la foulée", (prot.noms || []).includes("Gazo & Ninho"));

  const r2 = await biblio.reparerArtistes();
  R("et la réparation suivante ne la redécoupe pas", r2.corriges === 0);
  r = await post(moderation, { action: "composes" }, jAdmin);
  R("elle apparaît maintenant du bon côté", r.decoupes.length === 0 && r.gardes.length === 2);
  R("marquée comme déclarée à la main",
    r.gardes.some(x => x.nom === "Gazo & Ninho" && x.declare === true));

  r = await post(moderation, { action: "retablir", ligne: "Personne & Personne" }, jAdmin);
  R("annuler une ligne inconnue est refusé proprement", r.code === 404);
}

console.log("\n" + (ko ? ko + " ÉCHEC(S) sur " + n : n + " vérifications, aucune erreur"));
await rm(".data-bib", { recursive: true, force: true });
process.exit(ko ? 1 : 0);
