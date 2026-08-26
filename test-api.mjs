// Tests bout en bout de l'API. On appelle les vraies fonctions, sur un rangement
// fichier jetable. Aucun réseau, aucune dépendance.
//   node test-api.mjs

import { rm } from "node:fs/promises";

process.env.DIGGERS_STORE = "fichiers";
process.env.DIGGERS_DATA = ".data-test";
process.env.DIGGERS_SECRET = "test";
process.env.DIGGERS_ADMIN = "cle-admin-test";
await rm(".data-test", { recursive: true, force: true });

const compte = (await import("./netlify/functions/compte.mjs")).default;
const props = (await import("./netlify/functions/propositions.mjs")).default;
const moder = (await import("./netlify/functions/moderation.mjs")).default;
const catal = (await import("./netlify/functions/catalogue.mjs")).default;
const class_ = (await import("./netlify/functions/classement.mjs")).default;
const crews = (await import("./netlify/functions/crews.mjs")).default;

let ko = 0, n = 0;
const R = (nom, v) => { n++; if (!v) ko++; console.log((v ? "  ok    " : "  ÉCHEC ") + nom); };

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

const TRACK = {
  id: "1712345678", title: "Nuit blanche", artist: "Sœur K", album: "Sous-sol",
  genre: "Hip-Hop/Rap", year: 2021, ms: 187000,
  art: "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg",
  preview: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/x.m4a",
  url: "https://music.apple.com/fr/album/nuit-blanche/1712345678"
};

console.log("\n=== COMPTES ===");
let r = await post(compte, { action: "inscription", pseudo: "a", mdp: "motdepasse1" });
R("un pseudo d'un signe est refusé", r.code === 400);
r = await post(compte, { action: "inscription", pseudo: "Admin", mdp: "motdepasse1" });
R("un pseudo réservé est refusé", r.code === 400);
r = await post(compte, { action: "inscription", pseudo: "Mila", mdp: "court" });
R("un mot de passe trop court est refusé", r.code === 400);

r = await post(compte, { action: "inscription", pseudo: "Mila", mdp: "motdepasse1" });
R("inscription acceptée", r.code === 200 && !!r.jeton && r.moi.pseudo === "Mila");
const jMila = r.jeton;
R("le profil neuf a une couleur et un titre", r.moi.profil.couleur === "ambre" && r.moi.profil.titre === "curieux");
R("les titres non gagnés sont marqués comme tels",
  r.titres.find(t => t.id === "defricheur").acquis === false);

r = await post(compte, { action: "inscription", pseudo: "  mila ", mdp: "motdepasse1" });
R("un pseudo déjà pris est refusé même écrit autrement", r.code === 409);

r = await post(compte, { action: "connexion", pseudo: "Mila", mdp: "pasbon12345" });
R("un mauvais mot de passe est refusé", r.code === 401);
r = await post(compte, { action: "connexion", pseudo: "PersonneIci", mdp: "motdepasse1" });
R("un compte inexistant renvoie la même erreur", r.code === 401 && /incorrect/.test(r.erreur));
r = await post(compte, { action: "connexion", pseudo: "MILA", mdp: "motdepasse1" });
R("connexion acceptée", r.code === 200 && !!r.jeton);

r = await post(compte, { action: "moi" }, "jeton.bidon");
R("un jeton bidon est rejeté", r.code === 401);
r = await post(compte, { action: "moi" }, jMila);
R("le jeton donne accès au compte", r.code === 200 && r.moi.pseudo === "Mila");

console.log("\n=== SAUVEGARDE SERVEUR ===");
const code = "eyJ2IjoxfQ==".repeat(20);
r = await post(compte, { action: "sauver", code, resume: { cartes: 24, taux: 71, meilleurSet: 83, serie: 4 } }, jMila);
R("la partie est enregistrée", r.code === 200 && !!r.maj);
r = await post(compte, { action: "charger" }, jMila);
R("la partie revient à l'identique", r.partie.code === code);
r = await post(compte, { action: "sauver", code: "x".repeat(200001) }, jMila);
R("une sauvegarde démesurée est refusée", r.code === 400);

console.log("\n=== PROFIL PERSONNALISABLE ===");
r = await post(compte, { action: "profil", profil: { couleur: "fluo" } }, jMila);
R("une couleur inconnue est refusée", r.code === 400);
r = await post(compte, { action: "profil", profil: { titre: "archiviste" } }, jMila);
R("un titre non débloqué est refusé", r.code === 403);
r = await post(compte, { action: "profil", profil: {
  couleur: "violet", banniere: "vinyle", bio: "x".repeat(300),
  avatar: { id: "1", art: "https://is1-ssl.mzstatic.com/i.jpg" },
  vitrine: [{ id: "1", title: "T", artist: "A", art: "https://is1-ssl.mzstatic.com/i.jpg", rarity: 6, press: "Or ✦" },
            { id: "2", title: "T2", artist: "A2", art: "http://ailleurs.example/i.jpg", rarity: 2, press: "Standard" }]
} }, jMila);
R("la personnalisation est acceptée", r.code === 200 && r.moi.profil.couleur === "violet");
R("la bio est coupée à 140 signes", r.moi.profil.bio.length === 140);
R("une pochette qui ne vient pas d'Apple est écartée de la vitrine", r.moi.profil.vitrine.length === 1);
r = await post(compte, { action: "profil", profil: { avatar: { art: "https://mechant.example/i.jpg" } } }, jMila);
R("un avatar hors Apple est refusé", r.code === 400);

r = await post(compte, { action: "inscription", pseudo: "Théo", mdp: "motdepasse1" });
const jTheo = r.jeton;
R("un deuxième joueur s'inscrit", r.code === 200);
r = await post(compte, { action: "profil", profil: { pseudo: "Mila" } }, jTheo);
R("on ne peut pas prendre le pseudo d'un autre", r.code === 409);
r = await post(compte, { action: "profil", profil: { pseudo: "Théo B" } }, jTheo);
R("on peut changer son propre pseudo", r.code === 200 && r.moi.pseudo === "Théo B");
r = await post(compte, { action: "connexion", pseudo: "Théo B", mdp: "motdepasse1" });
R("le nouveau pseudo sert à se connecter", r.code === 200);
r = await post(compte, { action: "connexion", pseudo: "Théo", mdp: "motdepasse1" });
R("l'ancien pseudo est libéré", r.code === 401);

console.log("\n=== PROPOSER UN SON ===");
r = await post(props, { action: "creer", track: TRACK, motif: "Un morceau que personne ne connaît." });
R("proposer sans compte est refusé", r.code === 401);
r = await post(props, { action: "creer", motif: "Un morceau que personne ne connaît.",
  track: { ...TRACK, preview: "https://mon-serveur.example/vol.mp3" } }, jMila);
R("un extrait qui ne vient pas d'Apple est refusé", r.code === 400 && /Apple/.test(r.erreur));
r = await post(props, { action: "creer", motif: "Un morceau que personne ne connaît.",
  track: { ...TRACK, url: "https://ailleurs.example/x" } }, jMila);
R("un lien qui ne pointe pas vers Apple est refusé", r.code === 400);
r = await post(props, { action: "creer", motif: "Un morceau que personne ne connaît.",
  track: { ...TRACK, artist: "Karaoke Hits" } }, jMila);
R("un karaoké est refusé", r.code === 400 && /karaok/i.test(r.erreur));
r = await post(props, { action: "creer", track: TRACK, motif: "court" }, jMila);
R("un motif trop court est refusé", r.code === 400);
r = await post(props, { action: "creer", track: { ...TRACK, year: 1750 }, motif: "Un morceau introuvable ailleurs." }, jMila);
R("une année absurde est refusée", r.code === 400);

r = await post(props, { action: "creer", track: TRACK, motif: "Pépite de 2021, 900 écoutes en tout.",
  indice: "Rap français, sorti en 2021" }, jMila);
R("la proposition est enregistrée", r.code === 200 && r.statut2 === undefined && !!r.id);
const idProp = r.id;
R("il reste des propositions pour aujourd'hui", r.restantes === 9);

r = await post(props, { action: "creer", track: TRACK, motif: "Je la repropose pour voir." }, jTheo);
R("le même son ne peut pas être proposé deux fois", r.code === 409);
r = await post(props, { action: "creer", track: { ...TRACK, id: "999", title: "NUIT  Blanche" },
  motif: "Même son écrit autrement." }, jTheo);
R("un doublon écrit autrement est aussi bloqué", r.code === 409);

r = await post(props, { action: "miennes" }, jMila);
R("le joueur voit sa proposition en attente",
  r.propositions.length === 1 && r.propositions[0].statut === "en_attente");

for (let i = 0; i < 5; i++)
  await post(props, { action: "creer", motif: "Encore une trouvaille de sous-sol.",
    track: { ...TRACK, id: "70" + i, title: "Titre numéro " + i } }, jTheo);
r = await post(props, { action: "creer", motif: "Encore une trouvaille de sous-sol.",
  track: { ...TRACK, id: "799", title: "Titre de trop" } }, jTheo);
R("on ne peut pas empiler plus de 5 propositions en attente", r.code === 429);

console.log("\n=== MODÉRATION ===");
r = await post(moder, { action: "file" }, jMila);
R("un joueur ordinaire n'accède pas à la modération", r.code === 403);
r = await post(compte, { action: "promouvoir", cle: "mauvaise" }, jMila);
R("une mauvaise clé d'administration est refusée", r.code === 403);
r = await post(compte, { action: "promouvoir", cle: "cle-admin-test" }, jMila);
R("la bonne clé donne le rôle d'administrateur", r.code === 200 && r.moi.role === "admin");

r = await post(moder, { action: "file" }, jMila);
R("la file contient les propositions en attente", r.code === 200 && r.file.length === 6);
R("la plus ancienne est en tête", r.file[0].id === idProp);

r = await post(moder, { action: "trancher", id: idProp, verdict: "valider", pop: 9,
  corrections: { genre: "Rap français" }, note: "Bien vu." }, jMila);
R("la validation passe", r.code === 200 && r.track.pop === 9 && r.track.genre === "Rap français");
R("le son est marqué comme venant de la communauté",
  r.track.source === "communaute" && r.track.proposePar === "Mila");

r = await post(moder, { action: "trancher", id: idProp, verdict: "valider", pop: 9 }, jMila);
R("on ne tranche pas deux fois la même", r.code === 409);

let c = await get(catal);
R("le catalogue public contient le son validé",
  c.code === 200 && c.tracks.length === 1 && c.tracks[0].title === "Nuit blanche");

r = await post(props, { action: "miennes" }, jMila);
R("le joueur voit sa proposition validée", r.propositions[0].statut === "validee");
R("une carte l'attend en récompense",
  r.recompenses.length === 1 && r.recompenses[0].carte.origine === true
  && r.recompenses[0].carte.press === "Vinyle");
const idRec = r.recompenses[0].id;

r = await post(compte, { action: "moi" }, jMila);
R("le compteur de sons validés a bougé", r.moi.stats.validees === 1);
R("le titre Défricheur est débloqué", r.titres.find(t => t.id === "defricheur").acquis === true);
r = await post(compte, { action: "profil", profil: { titre: "defricheur" } }, jMila);
R("le titre débloqué peut être porté", r.code === 200 && r.moi.profil.titre === "defricheur");

r = await post(props, { action: "reclamer", ids: [idRec] }, jMila);
R("la récompense est réclamée une fois", r.reclamees === 1);
r = await post(props, { action: "reclamer", ids: [idRec] }, jMila);
R("elle ne peut pas être réclamée deux fois", r.reclamees === 0);

const file2 = await post(moder, { action: "file" }, jMila);
const idRefus = file2.file[0].id;
r = await post(moder, { action: "trancher", id: idRefus, verdict: "refuser", note: "Déjà une reprise." }, jMila);
R("le refus passe", r.code === 200 && r.statut === "refusee");
r = await post(moder, { action: "file" }, jMila);
R("la file a diminué", r.file.length === 4);
r = await post(props, { action: "miennes" }, jTheo);
R("le joueur voit le motif du refus",
  r.propositions.some(p => p.statut === "refusee" && /reprise/i.test(p.note)));

console.log("\n=== FIL PUBLIC ET CLASSEMENT ===");
r = await get(props);
R("le fil public montre les entrées validées", r.code === 200 && r.recentes.length === 1);
R("le fil public ne donne pas les refusées", !r.recentes.some(x => x.statut === "refusee"));

await post(compte, { action: "sauver", code: "abc", resume: { cartes: 40, taux: 62, meilleurSet: 91, serie: 2 } }, jTheo);
r = await get(class_);
R("le classement liste les joueurs", r.code === 200 && r.joueurs === 2);
R("les petites collections ne sont pas classées à l'oreille",
  r.oreille.length === 2 && r.oreille[0].taux === 71);
R("le classement de collection est trié", r.collection[0].cartes === 40);
R("les défricheurs sont comptés", r.defricheurs.length === 1 && r.defricheurs[0].validees === 1);

r = await post(moder, { action: "nommer", pseudo: "Théo B" }, jMila);
R("l'administrateur nomme un modérateur", r.code === 200 && r.role === "moderateur");
r = await post(moder, { action: "file" }, jTheo);
R("le modérateur accède à la file", r.code === 200);
r = await post(moder, { action: "nommer", pseudo: "Mila" }, jTheo);
R("un modérateur ne nomme pas d'autres modérateurs", r.code === 403);

r = await post(moder, { action: "retirer", track: "c1712345678" }, jMila);
R("un son publié peut être retiré", r.code === 200);
c = await get(catal);
R("le catalogue public est à jour après retrait", c.tracks.length === 0);

console.log("\n=== CREWS ===");
r = await post(crews, { action: "mien" }, jMila);
R("sans crew, on n'a pas de crew", r.code === 200 && r.crew === null);
r = await post(crews, { action: "creer", nom: "ok" }, jMila);
R("un nom de crew trop court est refusé", r.code === 400);
r = await post(crews, { action: "creer", nom: "Les Bacs du 93" }, jMila);
R("le crew est créé", r.code === 200 && r.crew.nom === "Les Bacs du 93" && r.chef === true);
const codeCrew = r.crew.code;
R("le code fait six signes lisibles", /^[A-HJ-NP-Z2-9]{6}$/.test(codeCrew));
r = await post(crews, { action: "creer", nom: "Un autre" }, jMila);
R("on n'est pas dans deux crews", r.code === 409);
r = await post(crews, { action: "rejoindre", code: "ZZZZZZ" }, jTheo);
R("un code inconnu est refusé", r.code === 404);
r = await post(crews, { action: "rejoindre", code: codeCrew.toLowerCase() }, jTheo);
R("on rejoint avec le code, casse indifférente", r.code === 200 && r.crew.membres.length === 2);
R("le total du crew additionne les collections", r.crew.total.cartes === 64);
r = await post(crews, { action: "renommer", nom: "Sillon Sud" }, jTheo);
R("un membre ne renomme pas le crew", r.code === 403);
r = await post(crews, { action: "renommer", nom: "Sillon Sud" }, jMila);
R("le chef renomme le crew", r.code === 200 && r.crew.nom === "Sillon Sud");
r = await post(crews, { action: "palmares" }, jTheo);
R("le palmarès des crews sort", r.code === 200 && r.crews.length === 1 && r.crews[0].membres === 2);
const uidTheo = (await post(crews, { action: "mien" }, jMila)).crew.membres.find(m => m.pseudo === "Théo B").uid;
r = await post(crews, { action: "exclure", uid: uidTheo }, jMila);
R("le chef peut exclure", r.code === 200 && r.crew.membres.length === 1);
r = await post(crews, { action: "mien" }, jTheo);
R("l'exclu n'a plus de crew", r.crew === null);
r = await post(crews, { action: "quitter" }, jMila);
R("le dernier membre qui part dissout le crew", r.code === 200 && r.crew === null);
r = await post(crews, { action: "rejoindre", code: codeCrew }, jTheo);
R("le code d'un crew dissous ne marche plus", r.code === 404);

console.log("\n=== LA BIBLIOTHÈQUE ===");
const NOYAU = [1, 2, 3].map(i => ({
  id: 90000 + i, title: "Morceau " + i, artist: "Artiste " + i, album: "Album",
  genre: "Pop", year: 1999 + i, ms: 200000, pop: 90 - i * 30,
  art: TRACK.art, preview: TRACK.preview, url: TRACK.url, poids: 2, rank: i
}));

r = await post(moder, { action: "importer", tracks: NOYAU, remplacer: true }, jTheo);
R("un modérateur ne peut pas importer un catalogue", r.code === 403);
r = await post(moder, { action: "importer", tracks: NOYAU, remplacer: true }, jMila);
R("l'import passe", r.code === 200 && r.ajoutes === 3 && r.total === 3);
r = await post(moder, { action: "importer", tracks: NOYAU }, jMila);
R("réimporter les mêmes sons ne les duplique pas", r.ajoutes === 0 && r.ignores === 3 && r.total === 3);
r = await post(moder, { action: "importer", tracks: [{ ...NOYAU[0], id: 95000, preview: "https://ailleurs.example/x.mp3" }] }, jMila);
R("un son dont l'extrait n'est pas chez Apple est écarté à l'import", r.refuses === 1 && r.total === 3);
r = await post(moder, { action: "importer", tracks: new Array(401).fill(NOYAU[0]) }, jMila);
R("un paquet trop gros est refusé", r.code === 413);

c = await get(catal);
R("le catalogue public sert la bibliothèque entière", c.tracks.length === 3);
R("les identifiants d'origine sont conservés", c.tracks.some(t => t.id === 90001));
R("la source est marquée", c.tracks.every(t => t.source === "noyau"));

r = await post(moder, { action: "modifier", track: "90001", patch: { pop: 4, genre: "Rap français" } }, jMila);
R("un son de la bibliothèque se corrige", r.code === 200 && r.track.pop === 4 && r.track.genre === "Rap français");
r = await post(moder, { action: "modifier", track: "90001", patch: { pop: 500 } }, jMila);
R("une popularité hors bornes est ramenée dans l'échelle", r.track.pop === 99);
r = await post(moder, { action: "modifier", track: "nexistepas", patch: { pop: 4 } }, jMila);
R("corriger un son absent renvoie une erreur claire", r.code === 404);

r = await post(props, { action: "creer", motif: "Je retente un son du noyau, pour voir.",
  track: { ...TRACK, id: "90002", title: "Morceau 2", artist: "Artiste 2" } }, jTheo);
R("un son déjà dans la bibliothèque ne peut plus être proposé",
  r.code === 409 && /bibliothèque/.test(r.erreur));

// une validation communautaire vient s'ajouter à la même bibliothèque
r = await post(props, { action: "creer", motif: "Une trouvaille de fond de bac, vraiment.",
  track: { ...TRACK, id: "42424", title: "Sous la dalle", artist: "Kombo" } }, jTheo);
const idAjout = r.id;
R("une nouvelle proposition passe", r.code === 200 && !!idAjout);
r = await post(moder, { action: "trancher", id: idAjout, verdict: "valider", pop: 3 }, jMila);
R("elle est validée", r.code === 200);
c = await get(catal);
R("elle rejoint la même bibliothèque", c.tracks.length === 4);
R("noyau et communauté cohabitent",
  c.meta.noyau === 3 && c.meta.communaute === 1);

r = await post(moder, { action: "importer", tracks: NOYAU, remplacer: true }, jMila);
R("réimporter le noyau ne détruit pas les apports de la communauté",
  r.total === 4 && r.ajoutes === 3);

r = await post(moder, { action: "retirer", track: "90003" }, jMila);
R("un son se retire", r.code === 200);
c = await get(catal);
R("il a bien disparu", c.tracks.length === 3 && !c.tracks.some(t => String(t.id) === "90003"));

r = await post(moder, { action: "vider", source: "noyau" }, jMila);
R("on peut vider le noyau seul", r.code === 200 && r.total === 1);
c = await get(catal);
R("il ne reste que la communauté", c.tracks.length === 1 && c.tracks[0].source === "communaute");

console.log("\n=== VERROU CONTRE L'ESSAI EN MASSE ===");
r = await post(compte, { action: "inscription", pseudo: "Cible", mdp: "motdepasse1" }, null, "10.0.0.9");
R("un compte de test est créé", r.code === 200);

let dernier = null;
for (let i = 0; i < 5; i++)
  dernier = await post(compte, { action: "connexion", pseudo: "Cible", mdp: "faux" + i }, null, "10.0.0.1");
R("les cinq premières erreurs restent des erreurs de mot de passe",
  dernier.code === 401 && /incorrect/.test(dernier.erreur));
r = await post(compte, { action: "connexion", pseudo: "Cible", mdp: "encorefaux" }, null, "10.0.0.1");
R("la sixième ferme la porte", r.code === 429 && /Réessaie/.test(r.erreur));
r = await post(compte, { action: "connexion", pseudo: "Cible", mdp: "motdepasse1" }, null, "10.0.0.1");
R("même le bon mot de passe est refusé pendant le verrou", r.code === 429);
r = await post(compte, { action: "connexion", pseudo: "Mila", mdp: "motdepasse1" }, null, "10.0.0.1");
R("le verrou vise ce compte, pas tout le site", r.code === 200);

for (let i = 0; i < 6; i++)
  await post(compte, { action: "inscription", pseudo: "Bot" + i, mdp: "motdepasse1" }, null, "10.0.0.2");
r = await post(compte, { action: "inscription", pseudo: "BotDeTrop", mdp: "motdepasse1" }, null, "10.0.0.2");
R("on ne crée pas des comptes en rafale depuis la même connexion",
  r.code === 429 && /Réessaie/.test(r.erreur));
r = await post(compte, { action: "inscription", pseudo: "Ailleurs", mdp: "motdepasse1" }, null, "10.0.0.3");
R("une autre connexion n'est pas pénalisée", r.code === 200);
const jVictime = r.jeton;
for (let i = 0; i < 4; i++)
  r = await post(compte, { action: "promouvoir", cle: "essai" + i }, jVictime, "10.0.0.4");
R("les premiers essais de clé sont juste refusés", r.code === 403);
r = await post(compte, { action: "promouvoir", cle: "encore" }, jVictime, "10.0.0.4");
R("la clé d'administration se verrouille aussi", r.code === 403 && /Réessaie/.test(r.erreur));
r = await post(compte, { action: "promouvoir", cle: "cle-admin-test" }, jVictime, "10.0.0.4");
R("la bonne clé ne passe plus pendant le verrou", r.code === 429);
r = await post(compte, { action: "promouvoir", cle: "cle-admin-test" }, jVictime, "10.0.0.5");
R("depuis une autre connexion, la bonne clé passe", r.code === 200 && r.moi.role === "admin");

console.log("\n=== MENTIONS LÉGALES ===");
r = await post(moder, { action: "mentions" }, jMila);
R("au départ il n'y a pas de mentions", r.code === 200 && r.editeur === null);
r = await post(moder, { action: "mentions", editeur: { nom: "adr" } }, jMila);
R("des mentions incomplètes sont refusées", r.code === 400 && /obligatoires/.test(r.erreur));
r = await post(moder, { action: "mentions", editeur: {
  nom: "adr", statut: "entrepreneur individuel", adresse: "12 rue de la Paix, 75002 Paris",
  contact: "adr@exemple.fr", directeur: "adr" } }, jTheo);
R("un modérateur ne change pas les mentions", r.code === 403);
r = await post(moder, { action: "mentions", editeur: {
  nom: "adr", statut: "entrepreneur individuel", adresse: "12 rue de la Paix, 75002 Paris",
  contact: "adr@exemple.fr", directeur: "adr" } }, jMila);
R("l'administrateur les enregistre", r.code === 200 && r.editeur.nom === "adr");
R("l'hébergeur est rempli par défaut", /Netlify/.test(r.editeur.hebergeur));
c = await get(catal);
R("elles voyagent avec le catalogue public", c.meta.editeur && c.meta.editeur.contact === "adr@exemple.fr");
R("le secret de signature ne fuite pas par là", !JSON.stringify(c).includes("secret"));

console.log("\n=== EFFACER SON COMPTE ===");
r = await post(compte, { action: "inscription", pseudo: "Partant", mdp: "motdepasse1" }, null, "10.0.0.7");
const jPartant = r.jeton;
await post(crews, { action: "creer", nom: "Le crew du départ" }, jPartant);
await post(compte, { action: "sauver", code: "abc", resume: { cartes: 12, taux: 50 } }, jPartant);
r = await post(props, { action: "creer", motif: "Un son que je laisse derrière moi.",
  track: { ...TRACK, id: "55555", title: "Dernier tour", artist: "Partant" } }, jPartant);
const idProp2 = r.id;
await post(moder, { action: "trancher", id: idProp2, verdict: "valider", pop: 5 }, jMila);

r = await post(compte, { action: "supprimer", mdp: "pasbon" }, jPartant);
R("il faut son mot de passe pour effacer son compte", r.code === 401);
r = await post(compte, { action: "supprimer", mdp: "motdepasse1" }, jPartant);
R("le compte est effacé", r.code === 200 && r.supprime === true);
r = await post(compte, { action: "moi" }, jPartant);
R("le jeton ne vaut plus rien", r.code === 401);
r = await post(compte, { action: "connexion", pseudo: "Partant", mdp: "motdepasse1" }, null, "10.0.0.7");
R("on ne peut plus s'y connecter", r.code === 401);
r = await post(compte, { action: "inscription", pseudo: "Partant", mdp: "motdepasse1" }, null, "10.0.0.7");
R("le pseudo est libéré", r.code === 200);
const cl = await get(class_);
R("il sort du classement", !cl.collection.some(x => x.pseudo === "Partant"));
c = await get(catal);
const laisse = c.tracks.find(t => String(t.id) === "c55555");
R("le son qu'il a fait entrer reste dans la bibliothèque", !!laisse);
R("mais il n'est plus signé de son nom", laisse.proposePar === "un digger");

console.log("\n" + (ko ? ko + " ÉCHEC(S) sur " + n : n + " vérifications, aucune erreur"));
await rm(".data-test", { recursive: true, force: true });
process.exit(ko ? 1 : 0);
