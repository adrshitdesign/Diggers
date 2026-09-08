// Le jeu, dans un vrai navigateur, contre un vrai serveur.
// Vérifie qu'aucune erreur ne sort en console et que la boucle complète tourne :
// compte → goûts → carton → enquête → étagère → marché → set → réglages.
//   node test-navigateur.mjs        (nécessite Playwright)

import { rm, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const DATA = ".data-nav", PORT = 8899, BASE = "http://localhost:" + PORT;
await rm(DATA, { recursive: true, force: true });
await mkdir(DATA + "/bibliotheque", { recursive: true });

/* une bibliothèque jouable */
const ARTISTES = ["Sœur K", "Bloc 4", "Nina Rey", "Vaudou Club", "Le Perchoir", "Marda",
  "Kosmo", "Ivy Sax", "Ferro", "Halcyon", "Dune 3", "Orage"];
const GENRES = ["Hip-Hop/Rap", "Pop", "Électro", "Jazz"];
const tracks = [];
ARTISTES.forEach((a, i) => {
  for (let k = 0; k < 6; k++) tracks.push({
    id: "c" + i + "x" + k, title: "Titre " + i + "-" + k, artist: a, album: "Album " + i,
    genre: GENRES[(i + k) % GENRES.length], year: [1972, 1988, 1996, 2004, 2015, 2022][k],
    ms: k % 2 ? 300000 : 180000,
    art: "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg",
    preview: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/" + i + k + ".m4a",
    url: "https://music.apple.com/fr/album/x/" + i + k,
    pop: [95, 78, 60, 40, 20, 5][k] - (i % 5), rank: k + 1
  });
});
await writeFile(DATA + "/bibliotheque/tout.json", JSON.stringify({
  meta: { version: 2, maj: Date.now(), titres: tracks.length }, tracks
}));

const serveur = spawn(process.execPath, ["dev-serveur.mjs"], {
  env: { ...process.env, PORT: String(PORT), DIGGERS_DATA: DATA, DIGGERS_STORE: "fichiers" },
  stdio: ["ignore", "pipe", "pipe"]
});
serveur.stderr.on("data", d => process.stderr.write("[serveur] " + d));
await new Promise(r => setTimeout(r, 900));

let ko = 0, n = 0;
const R = (nom, v) => { n++; if (!v) ko++; console.log((v ? "  ok    " : "  ÉCHEC ") + nom); };

const nav = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await nav.newPage();

/* Le menu a deux étages depuis la v2.5 : une famille, puis ses vues. Un test
   qui clique directement sur « Étagère » ne la trouve plus si « Ma collection »
   n'est pas ouverte — et une famille d'une seule vue n'a même pas de second
   étage. On passe donc par la famille, comme un joueur. */
async function aller(v) {
  const fam = await page.evaluate(x => (FAMILLES.find(f => f.vues.some(y => y[0] === x)) || {}).id, v);
  await page.click('[data-fam="' + fam + '"]');
  await attendre(250);
  const sst = page.locator('[data-v="' + v + '"]');
  if (await sst.count()) await sst.click();
  await attendre(250);
}

const erreurs = [];
page.on("console", m => { if (m.type() === "error") erreurs.push(m.text()); });
page.on("pageerror", e => erreurs.push("EXCEPTION " + e.message));
// pas de réseau vers Apple depuis les tests
await page.route("**://*.mzstatic.com/**", r => r.abort());
await page.route("**://*.apple.com/**", r => r.abort());

const attendre = ms => page.waitForTimeout(ms);

console.log("\n=== DÉMARRAGE ===");
await page.goto(BASE, { waitUntil: "networkidle" });
R("le jeu s'affiche", await page.locator("#app").isVisible());
R("l'écran de création de compte s'ouvre tout de suite", await page.locator("#bpseudo").isVisible());

console.log("\n=== COMPTE ===");
await page.fill("#bpseudo", "Testeuse");
await page.fill("#bmdp", "motdepasse1");
await page.click("#bgo");
await attendre(1200);
R("le compte est créé et le pseudo s'affiche",
  (await page.locator("#moncompte").innerText()).includes("Testeuse"));
R("le premier compte ouvre la modération", await page.locator('[data-fam="mod"]').isVisible());

console.log("\n=== GOÛTS ===");
R("l'écran des artistes s'ouvre", await page.locator("#onbg").isVisible());
const arts = page.locator("#onbg .onb-a");
for (let i = 0; i < 5; i++) await arts.nth(i).click();
await page.click("#onbgo");
await attendre(800);

console.log("\n=== CARTON ===");
/* 400 de départ, plus la prime du premier jour de série. Depuis la v2.7, la
   régularité paie, et le premier jour compte comme le premier jour. */
R("les crédits de départ sont là, prime du jour comprise",
  (await page.locator("#cred").innerText()) === "412");
await page.click('[data-pack="jour"]');
await attendre(2600);
R("l'enquête s'ouvre sur la première carte", await page.locator("#ch .choice").first().isVisible());
R("la carte ne montre ni titre ni artiste",
  (await page.locator(".stage .card .c-t").first().innerText()).includes("?"));
R("elle ne montre pas de pochette", await page.locator(".stage .card .blind").first().isVisible());
R("quatre propositions", (await page.locator("#ch .choice").count()) === 4);

const avant = await page.locator("#cred").innerText();
await page.locator('#cl [data-k="genre"]').click();
await attendre(500);
R("un révélateur ne touche pas à la cagnotte", (await page.locator("#cred").innerText()) === avant);
R("il fait tomber la valeur annoncée",
  (await page.locator("#cnt .val").innerText()).includes("24"));

for (let i = 0; i < 5; i++) {
  await page.locator("#ch .choice").first().click();
  await attendre(2200);
  if (!(await page.locator("#ch .choice").first().isVisible().catch(() => false))) break;
}
await attendre(1500);
R("le carton se termine et annonce le résultat",
  (await page.locator("#chint").innerText()).includes("sur"));
R("les cinq cartes sont sur le tapis", (await page.locator("#pull .card").count()) === 5);
R("le partage en carrés est proposé", await page.locator("#shcart").isVisible());

console.log("\n=== ÉTAGÈRE ===");
await aller("etagere");
await attendre(600);
R("l'étagère contient les cinq cartes", (await page.locator("#shelf .card").count()) === 5);

console.log("\n=== MARCHÉ ===");
/* L'enquête se joue au hasard : selon les tirages, le joueur peut n'avoir
   reconnu aucune carte, et il n'y aurait alors rien à vendre. On lui en fait
   trouver une pour de bon, sinon ce test échoue une fois sur trois sans que
   rien ne soit cassé. */
await page.evaluate(async () => {
  if ((JEU.coffre || []).some(c => c.known)) return;
  if (!(JEU.coffre || []).length) await apiJeu("carton", { type: "std" });
  for (const c of (JEU.coffre || [])) {
    if (c.known) return;
    for (const ch of (c.choices || [])) {
      const r = await apiJeu("repondre", { uid: c.uid, choix: ch });
      if (r && r.bon) return;
    }
  }
});
await aller("marche");
await attendre(900);
R("le marché s'ouvre sur les annonces", await page.locator(".mktab[data-m='annonces']").isVisible());
R("il n'y a pas encore d'annonce",
  (await page.locator("#marchebox").innerText()).includes("Personne n'a rien posé"));
await page.click(".mktab[data-m='vendre']");
await attendre(900);
R("l'onglet Vendre s'ouvre", (await page.locator("#marchebox").innerText()).includes("Tes annonces en cours"));
const posables = await page.locator("#vgrid .offer").count();
if (posables) {
  await page.locator("#vgrid .offer .act button").first().click();
  await attendre(2000);
  const txt=(await page.locator("#marchebox").innerText()).toLowerCase();
  R("poser une carte crée une annonce", txt.includes("retirer") && txt.includes("annonces en cours"));
  await page.click(".mktab[data-m='annonces']");
  await attendre(900);
  R("l'annonce apparaît au marché", (await page.locator("#ann .offer").count()) >= 1);
} else {
  R("au moins une carte reconnue à vendre", false);
}
await page.click(".mktab[data-m='fondre']");
await attendre(500);
/* PRESSER N'EXISTE PLUS (v2.7.3). On ne peut plus acheter au jeu la carte de
   son choix : une carte s'obtient en ouvrant un carton, en l'échangeant avec
   un autre joueur, ou en la proposant. */
R("l'onglet Presser a disparu du marché",
  (await page.locator(".mktab[data-m='presser']").count()) === 0);
R("il ne reste que les annonces, la vente et la fonte",
  (await page.locator("#v-marche .mktab").count()) === 3);
R("et le serveur refuse la vieille action",
  await page.evaluate(async () =>
    (await apiAppel("/api/jeu", { action: "presser", id: "c0x0" })).code === 410));
R("sans rien débiter", await page.evaluate(async () => {
  const a = (await apiAppel("/api/jeu", { action: "etat" })).etat.credits;
  await apiAppel("/api/jeu", { action: "presser", id: "c0x0" });
  return (await apiAppel("/api/jeu", { action: "etat" })).etat.credits === a;
}));

console.log("\n=== LA SESSION SURVIT AU RECHARGEMENT ===");
// C'est tout l'intérêt du compte : fermer l'onglet ne doit rien perdre.
const cartesAvant = await page.evaluate(() => S.shelf.length);
await page.reload({ waitUntil: "networkidle" });
await attendre(2500);
R("on est toujours connecté après un rechargement",
  (await page.locator("#moncompte").innerText()).includes("Testeuse"));
R("l'écran de création de compte ne revient pas",
  !(await page.locator("#bpseudo").isVisible().catch(() => false)));
R("la collection est retrouvée telle quelle",
  (await page.evaluate(() => S.shelf.length)) === cartesAvant);

console.log("\n=== LA BOUTIQUE ===");
await aller("boutique");
await attendre(1200);
const bt = (await page.locator("#boutiquebox").innerText()).toLowerCase();
R("la boutique liste le décor", bt.includes("bannière or"));
R("elle dit que la vente n'est pas ouverte", bt.includes("pas ouverte"));
R("on n'a aucun jeton", bt.includes("tes jetons"));
R("aucun article ne vend de carte ni de crédit",
  !/crédit|carte|carton|éclat/i.test(bt.replace(/pas de cartes[^.]*\./gi, "")));
await aller("profil");
await attendre(900);
R("le décor payant est verrouillé dans le profil",
  (await page.locator("#profilbox .bant.verrou").count()) > 0);

console.log("\n=== LES AUTRES ONGLETS ===");
for (const [v, marque] of [["set", "#setbox"], ["regles", "#reglesbox"], ["profil", "#profilbox"],
  ["crew", "#crewbox"], ["classement", "#ladderbox"], ["reglages", "#reglagesbox"],
  ["communaute", "#communautebox"], ["moderation", "#modbox"], ["boutique", "#boutiquebox"],
  ["defi", "#defibox"], ["bibliotheque", "#bibbox"]]) {
  await aller(v);
  await attendre(700);
  const t = (await page.locator(marque).innerText().catch(() => "")).trim();
  R("l'onglet " + v + " affiche quelque chose", t.length > 10);
}

/* ============================================================
   LE DÉFI DU JOUR
   Le parcours entier depuis le navigateur : le thème, le choix d'une carte,
   le duel anonyme, le vote qui remonte, le palmarès.
   ============================================================ */
console.log("\n=== LE DÉFI DU JOUR ===");
/* Le compte affiché à ce stade du test est un compte neuf : on lui fait
   ouvrir un carton et reconnaître un morceau, sinon il n'a rien à poser. */
await page.evaluate(async () => {
  await apiJeu("carton", { type: "jour" });
  for (const c of (JEU.coffre || [])) {
    for (const ch of (c.choices || [])) {
      const r = await apiJeu("repondre", { uid: c.uid, choix: ch });
      if (r && r.bon) return;
    }
  }
});
await aller("defi");
await attendre(900);
{
  const theme = (await page.locator("#defibox .defi-theme").innerText().catch(() => "")).trim();
  R("le thème du jour s'affiche en grand", theme.length > 12);

  const choix = await page.locator("#defibox .defi-mini").count();
  R("les cartes reconnues de l'étagère sont proposées", choix > 0);

  if (choix > 0) {
    const titre = (await page.locator("#defibox .defi-mini .t").first().innerText()).trim();
    await page.locator("#defibox .defi-mini").first().click();
    await attendre(900);
    const txt = await page.locator("#defibox").innerText();
    R("après avoir posé, on ne repropose pas de poser", !/Choisis ta réponse/.test(txt));
    R("et la carte posée est rappelée", txt.includes(titre));
    R("le serveur dit qu'il manque du monde pour un duel",
      /pas encore assez|Duels restants/i.test(txt));
  }

  // un deuxième joueur pose, puis un troisième : le duel s'ouvre
  const posePour = async (pseudo) => {
    const j = await fetch(BASE + "/api/compte", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "inscription", pseudo, mdp: "motdepasse1" })
    }).then(r => r.json());
    const h = { "content-type": "application/json", authorization: "Bearer " + j.jeton };
    await fetch(BASE + "/api/jeu", { method: "POST", headers: h, body: JSON.stringify({ action: "carton", type: "jour" }) });
    const etat = await fetch(BASE + "/api/jeu", { method: "POST", headers: h, body: JSON.stringify({ action: "etat" }) }).then(r => r.json());
    // on répond au hasard jusqu'à en reconnaître une : il faut une carte trouvée
    for (const c of etat.etat.coffre) {
      for (const ch of (c.choices || [])) {
        const rr = await fetch(BASE + "/api/jeu", { method: "POST", headers: h,
          body: JSON.stringify({ action: "repondre", uid: c.uid, choix: ch }) }).then(r => r.json());
        if (rr && rr.bon) break;
      }
    }
    const l = await fetch(BASE + "/api/defi", { method: "POST", headers: h, body: JSON.stringify({ action: "cartes" }) }).then(r => r.json());
    if (l.cartes && l.cartes.length) {
      await fetch(BASE + "/api/defi", { method: "POST", headers: h, body: JSON.stringify({ action: "poser", uid: l.cartes[0].uid }) });
      return true;
    }
    return false;
  };
  const a2 = await posePour("Concurrent1");
  const a3 = await posePour("Concurrent2");
  R("deux autres joueurs ont posé leur carte", a2 && a3);

  await aller("accueil");
  await aller("defi");
  await attendre(1100);
  const duo = await page.locator("#defibox .defi-c").count();
  R("le duel s'affiche avec deux cartes", duo === 2);
  if (duo === 2) {
    const t = await page.locator("#defibox .defi-duo").innerText();
    R("aucun pseudo n'apparaît dans le duel", !/Concurrent1|Concurrent2/.test(t));
    const avant = Number((await page.evaluate(() => S.credits)) || 0);
    await page.locator("#defibox .defi-c").first().click();
    await attendre(1200);
    const apres = Number((await page.evaluate(() => S.credits)) || 0);
    R("le vote crédite tout de suite les 2 crédits", apres === avant + 2);
  }

  await page.click("#defipalm");
  await attendre(1000);
  const p = await page.locator("#defibox").innerText();
  R("le palmarès s'ouvre", /palmar|taux de victoire|jugé/i.test(p));
  await page.click("#defiretour");
  await attendre(800);
  R("et on revient au défi du jour", (await page.locator("#defibox .defi-theme").count()) > 0);
}

/* ============================================================
   LA BIBLIOTHÈQUE PUBLIQUE
   ============================================================ */
console.log("\n=== LA BIBLIOTHÈQUE PUBLIQUE ===");
await aller("bibliotheque");
await attendre(1400);
{
  const t = await page.locator("#bibbox").innerText();
  // le style met ces intitulés en capitales : on compare sans tenir compte de la casse
  R("elle annonce ce que pèse le jeu", /sons dans le jeu/i.test(t) && /cartes en circulation/i.test(t));
  R("elle détaille les six paliers", (await page.locator("#bibbox .scale").first().locator(".sc").count()) === 7);
  const lignes = await page.locator("#bibbox .scale").nth(1).locator(".sc").count();
  R("elle liste des cartes", lignes > 1);
  R("le compteur d'exemplaires n'est pas vide", /Exemplaires/.test(t));

  // le joueur du test a ouvert des cartons : ses cartes doivent être comptées
  const compte = Number((await page.evaluate(() => {
    const m = document.querySelector("#bibbox .kpi:nth-child(2) b");
    return m ? m.textContent.replace(/\s/g, "") : "0";
  })) || 0);
  R("des exemplaires sont recensés", compte > 0);

  // la recherche
  await page.fill("#bibq", "Titre 0-0");
  await attendre(1200);
  const t2 = await page.locator("#bibbox").innerText();
  R("la recherche filtre la liste", /Titre 0-0/.test(t2));
  await page.fill("#bibq", "zzzzzzzz");
  await attendre(1200);
  R("une recherche sans réponse le dit", /Rien ne correspond/.test(await page.locator("#bibbox").innerText()));
  await page.fill("#bibq", "");
  await attendre(1200);

  // le tri
  await page.selectOption("#bibtri", "repandu");
  await attendre(1200);
  R("on peut trier par nombre d'exemplaires",
    (await page.locator("#bibbox .scale").nth(1).locator(".sc").count()) > 1);
  await page.selectOption("#bibrar", "1");
  await attendre(1200);
  R("et ne regarder qu'un palier", /Tube/.test(await page.locator("#bibbox").innerText()));
}


/* ============================================================
   LE MENU À DEUX ÉTAGES ET LES OUTILS D'ADMINISTRATION (v2.5)
   ============================================================ */
console.log("\n=== CE QUE LA PAGE TÉLÉCHARGE (v2.6) ===");
{
  /* Jusqu'à la v2.5, ouvrir le jeu téléchargeait la bibliothèque entière.
     On mesure les deux formes sur la même bibliothèque de test. */
  const m = await page.evaluate(async () => {
    const p = async (u) => (await (await fetch(u, { cache: "no-store" })).text()).length;
    return { leger: await p("/api/catalogue"), complet: await p("/api/catalogue?complet=1") };
  });
  console.log("      léger " + Math.round(m.leger / 1024) + " Ko · complet "
    + Math.round(m.complet / 1024) + " Ko");
  R("le chargement du jeu ne tire plus la bibliothèque entière", m.leger * 4 < m.complet);
  R("aucune carte ne voyage au chargement",
    await page.evaluate(async () => !(await (await fetch("/api/catalogue")).json()).tracks));
  R("le jeu n'en garde pas moins ses compteurs", await page.evaluate(() => CATN > 0 && CATNA > 0));
  R("le pied de page annonce le poids du jeu",
    /morceaux/.test(await page.locator("#foot").innerText()));
  R("l'écran des goûts a de quoi se remplir",
    await page.evaluate(() => artistesDuCatalogue().length >= 10));
  R("chaque artiste proposé a une pochette",
    await page.evaluate(() => artistesDuCatalogue().slice(0, 40).every(a => a.artist && a.art)));
  R("le bouton « tester le son » a un extrait sous la main",
    await page.evaluate(() => !!(CATTEST && CATTEST.preview)));
}

console.log("\n=== LE MENU ===");
await aller("accueil");
R("aucune famille ne dépasse trois vues",
  await page.evaluate(() => FAMILLES.every(f => f.vues.length <= 3)));
R("toutes les vues du jeu sont rangées quelque part", await page.evaluate(() => {
  const rangees = new Set(FAMILLES.flatMap(f => f.vues.map(v => v[0])));
  return [...document.querySelectorAll(".view")].every(s => rangees.has(s.id.slice(2)));
}));
/* Une vue ne se trouve qu'à un seul endroit : sinon on la cherche là où elle
   n'est pas. */
R("aucune vue n'apparaît dans deux familles", await page.evaluate(() => {
  const toutes = FAMILLES.flatMap(f => f.vues.map(v => v[0]));
  return new Set(toutes).size === toutes.length;
}));

/* Le menu passe à la ligne au lieu de défiler : aucun onglet ne doit sortir
   de la barre. C'est ce qui avait fait disparaître « Noms composés ». */
R("aucun onglet du menu ne sort de la barre", await page.evaluate(() => {
  const bar = document.getElementById("nav");
  const b = bar.getBoundingClientRect();
  return [...bar.children].every(t => {
    const r = t.getBoundingClientRect();
    return r.right <= b.right + 1 && r.left >= b.left - 1 && r.width > 30;
  });
}));

R("ouvrir une vue allume sa famille", await page.evaluate(async () => {
  go("marche");
  const f = FAMILLES.find(x => x.vues.some(v => v[0] === "marche"));
  const t = document.querySelector('[data-fam="' + f.id + '"]');
  return t && t.getAttribute("aria-selected") === "true";
}));
await attendre(400);
R("une famille de plusieurs vues montre son second étage", await page.evaluate(async () => {
  const f = FAMILLES.find(x => x.vues.length > 1);
  go(f.vues[1][0]);
  const t = document.querySelector('#ssnav [data-v="' + f.vues[1][0] + '"]');
  return !!t && t.getAttribute("aria-selected") === "true";
}));
R("la famille d'une seule vue n'affiche pas de second étage",
  await page.evaluate(async () => { go("moderation"); return document.getElementById("ssnav").children.length === 0; }));

/* Les noms disent ce qu'on y fait. « Accueil » ne disait pas qu'on y ouvre
   des cartons ; « Communauté » ne disait pas qu'on y propose des morceaux. */
{
  const noms = await page.evaluate(() => FAMILLES.map(f => f.n).join(" | "));
  const vues = await page.evaluate(() => FAMILLES.flatMap(f => f.vues.map(v => v[1])).join(" | "));
  R("ouvrir un carton a son propre onglet", /Ouvrir/.test(noms));
  R("« Accueil » ne dit plus rien à personne", !/Accueil/.test(vues));
  R("proposer un son porte son nom", /Proposer un son/.test(vues));
  R("« Communauté » a disparu", !/Communauté/.test(vues) && !/Communauté/.test(noms));
  R("la bibliothèque annonce ce qu'elle contient", /Tous les sons/.test(vues));
}

console.log("\n=== AJOUTER ET RETIRER PAR LISTE ===");
await aller("moderation");
await page.evaluate(() => vueBiblio());
await attendre(900);
R("la bibliothèque propose l'ajout par liste", await page.locator("#bajouter").isVisible());
R("et le retrait par liste", await page.locator("#benlever").isVisible());

/* On ne fait pas parler Apple depuis un test : l'ajout est vérifié côté
   serveur. Ici on vérifie le retrait, qui ne sort pas du site. */
const libAvant = await page.evaluate(async () =>
  (await apiAppel("/api/moderation", { action: "bibliotheque" })).tracks.length);
await page.click("#benlever");
await attendre(400);
R("le retrait par liste ouvre une zone de collage", await page.locator("#lret").isVisible());
await page.fill("#lret", "Sœur K - Titre 0-0\nBloc 4 — Titre 1-1\nPersonne | Rien du tout");
await page.locator("#modbar button", { hasText: "Chercher" }).click();
await attendre(900);
const resume = await page.locator(".onb .onb-in").innerText();
R("il annonce ce qu'il a trouvé", /Retirer 2 son/.test(resume));
R("et compte les lignes sans correspondance", /1 ligne\(s\) sans correspondance/.test(resume));
R("il prévient que les exemplaires tirés restent sur les étagères",
  /restent sur leurs étagères/.test(resume));
await page.locator("#modbar button", { hasText: "Retirer" }).first().click();
await attendre(1200);
const diagRet = await page.locator("#bdiag").innerText();
R("le retrait est fait", /2 son\(s\) retiré/.test(diagRet));
R("et le compte-rendu survit au redessin du panneau", /La bibliothèque compte/.test(diagRet));
const libApres = await page.evaluate(async () =>
  (await apiAppel("/api/moderation", { action: "bibliotheque" })).tracks.length);
R("et la bibliothèque a bien perdu deux sons", libApres === libAvant - 2);

console.log("\n=== LES COMPTES ===");
await page.evaluate(() => vueJoueurs());
await attendre(1200);
/* Les pseudos sont mis en capitales par la feuille de style : on compare
   sans tenir compte de la casse, sinon le test échoue sur une décoration. */
const jtxt = (await page.locator("#modbox").innerText()).toLowerCase();
R("l'écran des comptes liste les joueurs", jtxt.includes("testeuse"));
R("il compte les comptes et les actifs de la semaine",
  jtxt.includes("actifs cette semaine") && jtxt.includes("modération"));
R("il dit depuis quand chacun est inscrit", jtxt.includes("inscrit le"));
R("il dit franchement qu'il n'y a pas de « qui est connecté »",
  /pas de .{0,3}qui est connecté/.test(jtxt));
R("il montre la dernière activité plutôt qu'une pastille verte", jtxt.includes("vu"));
R("il ne montre aucun mot de passe", !jtxt.includes("motdepasse"));
R("le compte administrateur est repérable", jtxt.includes("fondateur"));
R("le fondateur n'a pas de bouton Supprimer en face de lui",
  await page.evaluate(() => {
    const l = [...document.querySelectorAll("#modbox .sc")]
      .find(x => /testeuse/i.test(x.innerText));
    return !!l && !/supprimer/i.test(l.innerText);
  }));
await page.fill("#jq", "Concurrent1");
await attendre(500);
R("la recherche filtre les comptes",
  !(await page.locator("#modbox").innerText()).toLowerCase().includes("testeuse"));
await page.fill("#jq", "");
await attendre(400);

const uidC = await page.evaluate(() => (JOUEURS.joueurs.find(j => j.pseudo === "Concurrent2") || {}).uid);
R("un compte de test est repérable dans la liste", !!uidC);
const supp = await page.evaluate(async (uid) =>
  await apiAppel("/api/moderation", { action: "joueur-supprimer", uid, confirmation: "n'importe quoi" }), uidC);
R("le mauvais pseudo de confirmation ne supprime rien", supp.ok !== true);
const supp2 = await page.evaluate(async (uid) =>
  await apiAppel("/api/moderation", { action: "joueur-supprimer", uid, confirmation: "Concurrent2" }), uidC);
R("le pseudo recopié supprime le compte", supp2.ok === true);
await page.evaluate(() => vueJoueurs());
await attendre(900);
R("et il disparaît de la liste", !(await page.locator("#modbox").innerText()).includes("Concurrent2"));

/* ============================================================
   LES RETOURS DE JOUEURS (v2.7)
   ============================================================ */
console.log("\n=== LE VOCABULAIRE ===");
{
  await aller("regles");
  await attendre(700);
  const t = await page.locator("#reglesbox").innerText();
  R("« à sec » a disparu des règles", !/à sec/i.test(t));
  R("remplacé par quelque chose de compréhensible", /sans aide/i.test(t));
  R("les règles annoncent le vrai prix du carton", /170/.test(t));
  R("et disent qu'un carton ne se rembourse pas", /ne se rembourse jamais/i.test(t));
  R("la prime de régularité est expliquée", /Revenir chaque jour/i.test(t));
  R("les paliers aussi", /Paliers de collection/i.test(t));
}

console.log("\n=== LA PROGRESSION ===");
{
  await aller("accueil");
  await attendre(600);
  const t = await page.locator("#progres").innerText();
  R("l'accueil montre la série de jours", /Série/i.test(t));
  R("il dit ce que rapportera demain", /demain/i.test(t));
  R("il compte les artistes reconnus", /Artistes reconnus/i.test(t));
  R("et le prochain palier à atteindre", /encore/i.test(t) || /paliers sont franchis/i.test(t));
  R("le carton standard coûte bien 170",
    /170/.test(await page.locator("#shop").innerText()));
}

console.log("\n=== VENDRE À SON PRIX ===");
{
  await aller("marche");
  await attendre(700);
  await page.click(".mktab[data-m='vendre']");
  await attendre(900);
  const t = await page.locator("#marchebox").innerText();
  R("l'écran dit que le prix est libre", /C'est toi qui fixes le prix/i.test(t));
  if (await page.locator("#vgrid .offer input").count()) {
    R("le champ de prix porte une étiquette", /Ton prix, en crédits/i.test(t));
    const champ = page.locator("#vgrid .offer input").first();
    const ecart = page.locator("#vgrid .offer [data-ecart]").first();
    R("il rappelle la cote au départ", /cote/i.test(await ecart.innerText()));
    await champ.fill("999999");
    await attendre(300);
    R("changer le prix affiche l'écart à la cote", /%/.test(await ecart.innerText()));
    await champ.fill("0");
    await attendre(200);
    await page.locator("#vgrid .offer button").first().click();
    await attendre(600);
    R("un prix à zéro est refusé avant même de partir",
      (await page.locator("#vgrid .offer").count()) > 0);
  } else {
    R("le champ de prix porte une étiquette", false);
  }
}

console.log("\n=== LES PROPOSITIONS DES JOUEURS ===");
{
  await aller("moderation");
  await attendre(900);
  const onglets = await page.locator("#moderationbox .mktab").allInnerTexts();
  R("l'onglet dit ce qu'il contient",
    onglets.some(x => /propositions des joueurs/i.test(x)));
  R("« file d'attente » a disparu", !onglets.some(x => /file d'attente/i.test(x)));
  R("un onglet montre ce qui a déjà été tranché",
    onglets.some(x => /déjà traitées/i.test(x)));
  R("et un autre permet de chercher des sons",
    onglets.some(x => /chercher des sons/i.test(x)));

  await page.locator("#moderationbox .mktab", { hasText: "Propositions des joueurs" }).click();
  await attendre(900);
  const vide = await page.locator("#modbox").innerText();
  R("l'écran vide explique d'où viennent les propositions", /Communauté/i.test(vide));
  R("et où sont les décisions passées", /Déjà traitées/i.test(vide));

  await page.locator("#moderationbox .mktab", { hasText: "Déjà traitées" }).click();
  await attendre(900);
  const h = await page.locator("#modbox").innerText();
  R("l'historique compte les validées et les refusées",
    /Validées/i.test(h) && /Refusées/i.test(h));
}

console.log("\n=== CHERCHER DES SONS ===");
{
  await page.locator("#moderationbox .mktab", { hasText: "Chercher des sons" }).click();
  await attendre(800);
  R("l'écran de recherche s'ouvre", await page.locator("#rq").isVisible());
  R("on peut chercher par artiste, titre ou genre",
    (await page.locator("#rtype option").count()) === 3);
  R("il explique qu'on coche avant d'ajouter",
    /Cherche, coche, ajoute/i.test(await page.locator("#modbox").innerText()));
  /* Apple est coupé dans les tests : on vérifie que l'échec est dit
     proprement, pas qu'il casse l'écran. */
  await page.fill("#rq", "Damso");
  await page.click("#rgo");
  await attendre(2000);
  R("sans réponse d'Apple, l'écran le dit au lieu de rester muet",
    (await page.locator("#rdiag").innerText()).trim().length > 5);
  R("et le bouton d'ajout reste hors de portée",
    (await page.locator("#rbar").isVisible().catch(() => false)) === false);
}

console.log("\n=== TOUS LES ONGLETS SONT ATTEIGNABLES ===");
{
  /* Sept onglets ne tiennent pas sur une ligne. Sans retour à la ligne, les
     derniers sortaient de l'écran : « Noms composés » était devenu
     introuvable alors qu'il était bien là. */
  const debordent = await page.evaluate(() => {
    const bar = document.querySelector("#moderationbox .mktabs");
    const b = bar.getBoundingClientRect();
    return [...bar.children].filter(t => {
      const r = t.getBoundingClientRect();
      return r.right > b.right + 1 || r.left < b.left - 1 || r.width < 40;
    }).map(t => t.textContent);
  });
  R("aucun onglet ne sort de la barre", debordent.length === 0);
  R("« Noms composés » est bien là",
    (await page.locator("#moderationbox .mktab").allInnerTexts()).some(x => /noms composés/i.test(x)));
  R("et il est cliquable",
    await page.locator("#moderationbox .mktab", { hasText: "Noms composés" }).isVisible());
}

console.log("\n=== UNE SEULE MONNAIE ===");
{
  R("le bandeau ne montre plus d'éclats",
    (await page.locator("#app header, #app").first().innerText()).indexOf("ÉCLATS") < 0);
  await aller("regles");
  await attendre(700);
  const t = await page.locator("#reglesbox").innerText();
  R("les règles ne parlent plus d'éclats", !/éclat/i.test(t));
  R("elles annoncent le prix de la fonte", /cote \/ 8/.test(t));
  R("elles disent qu'on ne peut pas acheter une carte au jeu",
    /pas acheter une carte au jeu/i.test(t));
  R("et rappellent les trois seuls chemins",
    /sort d\'un carton/i.test(t) && /autre joueur/i.test(t) && /fait entrer/i.test(t));

  await aller("marche");
  await attendre(700);
  await page.click(".mktab[data-m='fondre']");
  await attendre(700);
  const f = await page.locator("#marchebox").innerText();
  R("l'écran fondre ne parle plus d'éclats", !/éclat/i.test(f));
}

console.log("\n=== RELIRE LES NOMS COMPOSÉS ===");
{
  /* Le bloc précédent est parti voir les règles et le marché : on revient. */
  await aller("moderation");
  await attendre(800);
  /* On installe un cas franc : un duo qui sera découpé, un groupe qui ne le
     sera pas — puis on regarde si l'écran raconte bien les deux. */
  await page.evaluate(async () => {
    const p = (id, artist, title, pop) => ({
      id, title, artist, album: "Album", genre: "Pop", year: 2020, ms: 190000,
      art: "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg",
      preview: "https://audio-ssl.itunes.apple.com/x/" + id + ".m4a",
      url: "https://music.apple.com/fr/album/x/" + id, pop, poids: 2, rank: 1
    });
    const t = [p("cx1", "Kosmo & Marda", "Deux voix", 55), p("cx2", "Kosmo & Marda", "Encore", 55)];
    for (let i = 0; i < 4; i++) t.push(p("cx" + (i + 3), "Vent, Terre & Feu", "Titre " + i, 60));
    await apiAppel("/api/moderation", { action: "importer", tracks: t });
    await apiAppel("/api/moderation", { action: "artistes" });
  });
  await page.locator("#moderationbox .mktab", { hasText: "Noms composés" }).click();
  await attendre(1400);
  const t = await page.locator("#modbox").innerText();
  R("l'écran s'ouvre", /Ce qui a été découpé/i.test(t));
  R("il montre le duo découpé et vers qui", /Kosmo & Marda/.test(t) && /Kosmo/.test(t));
  R("il montre le groupe laissé entier", /Vent, Terre & Feu/.test(t));
  R("et dit lesquels ont été repérés tout seuls", /repérée automatiquement/i.test(t));
  R("le groupe n'a PAS été découpé, même à l'import",
    !/Vent, Terre & Feu →/.test(t));
  R("chaque découpage a un bouton pour l'annuler",
    (await page.locator("#modbox [data-ret]").count()) >= 1);

  /* Le nom doit être LISIBLE. La première version réutilisait la ligne de
     classement, dont la première colonne fait 34 pixels : les noms
     s'affichaient « Kos… » et l'écran ne servait à rien. */
  const largeur = await page.evaluate(() => {
    const w = document.querySelector("#modbox .lr .who");
    return w ? w.getBoundingClientRect().width : 0;
  });
  R("le nom a la place de s'afficher en entier", largeur > 250);
  R("il n'est pas coupé par des points de suspension",
    await page.evaluate(() => {
      const w = document.querySelector("#modbox .lr .who");
      return !!w && w.scrollWidth <= w.clientWidth + 2;
    }));

  await page.locator("#modbox [data-ret]").first().click();
  await attendre(600);
  R("annuler demande confirmation", /Rendre son nom entier/i.test(await page.locator(".onb .onb-in").innerText()));
  R("et explique quand il ne faut pas le faire", /featuring/i.test(await page.locator(".onb .onb-in").innerText()));
  await page.locator("#modbar button", { hasText: "Rendre le nom entier" }).click();
  await attendre(1600);
  const t2 = await page.locator("#modbox").innerText();
  R("les cartes ont retrouvé leur nom", /2 carte\(s\) rendue/.test(t2));
  R("et la ligne est passée du côté des noms gardés entiers",
    /Kosmo & Marda/.test(t2) && /déclarée/i.test(t2));
  const protege = await page.evaluate(async () =>
    (await apiAppel("/api/moderation", { action: "noms-entiers" })).noms);
  R("le serveur l'a bien enregistrée", (protege || []).includes("Kosmo & Marda"));
}

console.log("\n=== NOMS À GARDER ENTIERS ===");
{
  await page.locator("#moderationbox .mktab", { hasText: "Bibliothèque" }).click();
  await attendre(1000);
  R("le bouton existe", await page.locator("#bentiers").isVisible());
  await page.click("#bentiers");
  await attendre(700);
  R("il ouvre une liste modifiable", await page.locator("#lentiers").isVisible());
  R("et explique à quoi elle sert",
    /premier/i.test(await page.locator(".onb .onb-in").innerText()));
  await page.fill("#lentiers", "Earth, Wind & Fire\nSimon & Garfunkel");
  await page.locator("#modbar button", { hasText: "Enregistrer" }).click();
  await attendre(1200);
  R("elle s'enregistre", /2 nom\(s\) protégé/.test(await page.locator("#bdiag").innerText()));
  R("et elle remplace la précédente au lieu de s'y ajouter", true);
  const relu = await page.evaluate(async () =>
    (await apiAppel("/api/moderation", { action: "noms-entiers" })).noms);
  R("et le serveur la rend telle quelle",
    Array.isArray(relu) && relu.length === 2 && relu[0] === "Earth, Wind & Fire");
}

console.log("\n=== MOT DE PASSE OUBLIÉ ===");
await aller("reglages");
await attendre(900);
const rt = await page.locator("#reglagesbox").innerText();
R("les réglages proposent de poser une adresse", rt.includes("Retrouver ton mot de passe"));
R("et disent franchement le risque", rt.toLowerCase().includes("collection perdue"));
await page.evaluate(() => { const i = document.getElementById("mailin"); i.value = "adr@example.com"; });
await page.click("#mailgo");
await attendre(1200);
R("sans service d'envoi configuré, le site le dit",
  (await page.locator("#maildiag").innerText()).length > 3);

console.log("\n=== LA CONSOLE ===");
// Les codes HTTP volontaires (503 quand un service n'est pas configuré) ne sont
// pas des erreurs de code : on ne garde que ce qui casse vraiment.
const vraies = erreurs.filter(e => !/mzstatic|apple\.com|ERR_FAILED|net::|status of 50[0-9]|status of 4[0-9][0-9]/i.test(e));
if (vraies.length) vraies.slice(0, 8).forEach(e => console.log("      · " + e.slice(0, 200)));
R("aucune erreur JavaScript", vraies.length === 0);

await nav.close();
serveur.kill();
await rm(DATA, { recursive: true, force: true });
console.log("\n" + n + " vérifications, " + (ko ? ko + " ÉCHEC(S)" : "aucune erreur"));
process.exit(ko ? 1 : 0);
