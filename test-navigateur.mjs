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
R("le premier compte ouvre la modération", await page.locator('[data-v="moderation"]').isVisible());

console.log("\n=== GOÛTS ===");
R("l'écran des artistes s'ouvre", await page.locator("#onbg").isVisible());
const arts = page.locator("#onbg .onb-a");
for (let i = 0; i < 5; i++) await arts.nth(i).click();
await page.click("#onbgo");
await attendre(800);

console.log("\n=== CARTON ===");
R("les crédits de départ sont là", (await page.locator("#cred").innerText()) === "400");
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
await page.click('[data-v="etagere"]');
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
await page.click('[data-v="marche"]');
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
await page.click(".mktab[data-m='presser']");
await attendre(500);
R("l'onglet Presser demande une recherche",
  (await page.locator("#marchebox").innerText()).includes("Cherche un morceau"));

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
await page.click('[data-v="boutique"]');
await attendre(1200);
const bt = (await page.locator("#boutiquebox").innerText()).toLowerCase();
R("la boutique liste le décor", bt.includes("bannière or"));
R("elle dit que la vente n'est pas ouverte", bt.includes("pas ouverte"));
R("on n'a aucun jeton", bt.includes("tes jetons"));
R("aucun article ne vend de carte ni de crédit",
  !/crédit|carte|carton|éclat/i.test(bt.replace(/pas de cartes[^.]*\./gi, "")));
await page.click('[data-v="profil"]');
await attendre(900);
R("le décor payant est verrouillé dans le profil",
  (await page.locator("#profilbox .bant.verrou").count()) > 0);

console.log("\n=== LES AUTRES ONGLETS ===");
for (const [v, marque] of [["set", "#setbox"], ["regles", "#reglesbox"], ["profil", "#profilbox"],
  ["crew", "#crewbox"], ["classement", "#ladderbox"], ["reglages", "#reglagesbox"],
  ["communaute", "#communautebox"], ["moderation", "#modbox"], ["boutique", "#boutiquebox"],
  ["defi", "#defibox"], ["bibliotheque", "#bibbox"]]) {
  await page.click('[data-v="' + v + '"]');
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
await page.click('[data-v="defi"]');
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

  await page.click('[data-v="accueil"]');
  await page.click('[data-v="defi"]');
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
await page.click('[data-v="bibliotheque"]');
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

console.log("\n=== MOT DE PASSE OUBLIÉ ===");
await page.click('[data-v="reglages"]');
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
