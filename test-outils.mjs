// Les trois outils d'administration ajoutés en v2.5 : l'import par liste,
// le retrait par liste, et l'écran des comptes.
//   node test-outils.mjs

import { rm } from "node:fs/promises";

process.env.DIGGERS_STORE = "fichiers";
process.env.DIGGERS_DATA = ".data-outils";
process.env.DIGGERS_SECRET = "test";
process.env.DIGGERS_ADMIN = "cle-admin-test";
await rm(".data-outils", { recursive: true, force: true });

const compte = (await import("./netlify/functions/compte.mjs")).default;
const moder  = (await import("./netlify/functions/moderation.mjs")).default;
const jeu    = (await import("./netlify/functions/jeu.mjs")).default;
const crews  = (await import("./netlify/functions/crews.mjs")).default;
const { decouperLigne } = await import("./netlify/functions/moderation.mjs");
const { store } = await import("./netlify/functions/_store.mjs");

let ko = 0, n = 0;
const R = (nom, v) => { n++; if (!v) ko++; console.log((v ? "  ok    " : "  ÉCHEC ") + nom); };
async function post(fn, corps, jeton) {
  const h = { "content-type": "application/json" };
  if (jeton) h.authorization = "Bearer " + jeton;
  const r = await fn(new Request("http://x/api", { method: "POST", headers: h, body: JSON.stringify(corps) }));
  // même forme que apiAppel côté navigateur : ok vient du code HTTP.
  return { code: r.status, ok: r.ok, ...(await r.json().catch(() => ({}))) };
}
const carte = (id, artist, title) => ({
  id: String(id), title, artist, album: "Album", genre: "Pop", year: 2020, ms: 180000,
  art: "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg",
  preview: "https://audio-ssl.itunes.apple.com/x/x.m4a",
  url: "https://music.apple.com/fr/album/x/" + id, poids: 2, rank: 0, pop: 50
});

console.log("\nLire une ligne de document");

R("« Artiste — Titre » se coupe au tiret cadratin",
  String(decouperLigne("Jean-Jacques Goldman — Je te donne")) === "Jean-Jacques Goldman,Je te donne");
R("le tiret demi-cadratin marche aussi",
  String(decouperLigne("Alain Bashung – Osez Joséphine")) === "Alain Bashung,Osez Joséphine");
R("le tiret simple entouré d'espaces marche aussi",
  String(decouperLigne("Booba - Kalash")) === "Booba,Kalash");
R("la barre verticale marche aussi",
  String(decouperLigne("Orelsan | Basique")) === "Orelsan,Basique");
R("la tabulation marche aussi — c'est ce que colle un tableur",
  String(decouperLigne("Aya Nakamura\tDjadja")) === "Aya Nakamura,Djadja");
R("un tiret dans le nom de l'artiste ne coupe pas au mauvais endroit",
  decouperLigne("Jean-Jacques Goldman — Je te donne")[0] === "Jean-Jacques Goldman");
R("un tiret dans le titre reste dans le titre",
  decouperLigne("Jul - Tchikita - remix")[1] === "Tchikita - remix");
R("une ligne sans séparateur est refusée plutôt que devinée",
  decouperLigne("Booba") === null);
R("une ligne vide est refusée", decouperLigne("") === null);
R("un séparateur sans titre est refusé", decouperLigne("Booba — ") === null);

console.log("\nRetirer des sons par liste");

let r = await post(compte, { action: "inscription", pseudo: "Chef", mdp: "motdepasse1" });
const jChef = r.jeton;
R("le premier compte est administrateur", r.moi.role === "admin");

r = await post(moder, { action: "importer", tracks: [["Booba","Kalash"],["Booba","DKR"],
  ["Nekfeu","On verra"],["Aya Nakamura","Djadja"]].map(([a, t], i) => carte(7000 + i, a, t)) }, jChef);
R("l'import de quatre sons passe", r.ok === true && r.ajoutes === 4);
let lib = await post(moder, { action: "bibliotheque" }, jChef);
R("quatre sons sont en bibliothèque", lib.tracks.length === 4);

r = await post(moder, { action: "retirer-liste",
  lignes: ["Booba — Kalash", "Nekfeu — On verra"] }, jChef);
R("le retrait par liste rend un compte-rendu", r.ok === true);
R("deux sons ont été retirés", r.retires === 2);
R("et il annonce ce qui reste", r.total === 2);
lib = await post(moder, { action: "bibliotheque" }, jChef);
R("il en reste deux", lib.tracks.length === 2);
R("et ce sont les bons", lib.tracks.every(t => t.title === "DKR" || t.title === "Djadja"));

r = await post(moder, { action: "retirer-liste", lignes: ["Booba — Kalash"] }, jChef);
R("redemander le même retrait ne casse rien", r.ok === true && r.retires === 0);
R("et le son manquant est compté comme absent", r.absents === 1);

r = await post(moder, { action: "retirer-liste", lignes: ["ceci n'est pas une ligne"] }, jChef);
R("une ligne illisible ne retire rien", r.ok === true && r.retires === 0 && r.absents === 1);

r = await post(moder, { action: "retirer-liste", lignes: ["Djadja — Aya Nakamura"], apercu: true }, jChef);
R("l'ordre inverse est retrouvé quand même", r.trouves === 1);
R("l'aperçu ne retire rien", (await post(moder, { action: "bibliotheque" }, jChef)).tracks.length === 2);
r = await post(moder, { action: "retirer-liste", lignes: ["Inconnu — Rien"], apercu: true }, jChef);
R("l'aperçu nomme les lignes sans correspondance", (r.introuvables || [])[0] === "Inconnu — Rien");

r = await post(moder, { action: "retirer-liste", lignes: ["Booba — DKR"] });
R("sans jeton, on ne retire rien", r.code === 401);
lib = await post(moder, { action: "bibliotheque" }, jChef);
R("la bibliothèque est intacte", lib.tracks.length === 2);

r = await post(compte, { action: "inscription", pseudo: "Passante", mdp: "motdepasse1" });
const jPassante = r.jeton, uidPassante = r.uid || null;
r = await post(moder, { action: "retirer-liste", lignes: ["Booba — DKR"] }, jPassante);
R("un joueur ordinaire non plus", r.code === 403);

const sansPop = { ...carte(7099, "Damso", "Macarena") };
delete sansPop.pop; delete sansPop.poids; delete sansPop.rank; delete sansPop.year;
r = await post(moder, { action: "importer", tracks: [sansPop] }, jChef);
R("un son collé à la main, sans popularité ni année, entre quand même", r.ajoutes === 1);

console.log("\nL'écran des comptes");

r = await post(moder, { action: "joueurs" }, jChef);
R("la liste des comptes se lit", r.ok === true && Array.isArray(r.joueurs));
R("elle contient les deux comptes", r.joueurs.length === 2);
const fiche = r.joueurs.find(j => j.pseudo === "Passante");
R("chaque ligne porte le pseudo", !!fiche);
R("et le rôle", fiche.role === "joueur");
R("et la date d'inscription", typeof fiche.cree === "number" && fiche.cree > 0);
R("et la dernière activité — pas une pastille « en ligne »", typeof fiche.vu === "number");
R("et le nombre de cartes", fiche.cartes === 0);
R("elle ne laisse pas fuiter le mot de passe",
  JSON.stringify(r.joueurs).indexOf("hash") < 0 && JSON.stringify(r.joueurs).indexOf("sel") < 0);
R("l'e-mail n'est pas recopié, seulement sa présence", fiche.email === false);
R("la liste dit qui est le fondateur", r.fondateur === (r.joueurs.find(j => j.pseudo === "Chef") || {}).uid);

r = await post(moder, { action: "joueurs" }, jPassante);
R("un joueur ordinaire ne voit pas la liste", r.code === 403);

const cible = (await post(moder, { action: "joueurs" }, jChef)).joueurs.find(j => j.pseudo === "Passante");
r = await post(moder, { action: "joueur-role", uid: cible.uid, role: "moderateur" }, jChef);
R("le fondateur peut promouvoir", r.ok === true && r.role === "moderateur");
r = await post(moder, { action: "joueurs" }, jPassante);
R("la promue voit maintenant la liste", r.ok === true);
r = await post(moder, { action: "joueur-role", uid: cible.uid, role: "joueur" }, jChef);
R("et il peut rétrograder", r.ok === true && r.role === "joueur");

r = await post(moder, { action: "joueur-role", uid: cible.uid, role: "patron" }, jChef);
R("un rôle inventé est refusé", r.code === 400);
const soi = (await post(moder, { action: "joueurs" }, jChef)).joueurs.find(j => j.pseudo === "Chef");
r = await post(moder, { action: "joueur-role", uid: soi.uid, role: "joueur" }, jChef);
R("on ne se rétrograde pas soi-même — sinon plus personne n'administre", r.code === 409);

r = await post(moder, { action: "joueur-supprimer", uid: soi.uid, confirmation: "Chef" }, jChef);
R("on ne peut pas supprimer son propre compte depuis l'écran", r.code === 409);

r = await post(moder, { action: "joueur-supprimer", uid: cible.uid, confirmation: "n'importe quoi" }, jChef);
R("sans le bon pseudo, rien n'est supprimé", r.code === 400);
r = await post(moder, { action: "joueurs" }, jChef);
R("le compte est toujours là", r.joueurs.length === 2);

r = await post(moder, { action: "joueur-supprimer", uid: cible.uid, confirmation: "Passante" }, jChef);
R("avec le pseudo recopié, la suppression passe", r.ok === true);
r = await post(moder, { action: "joueurs" }, jChef);
R("il ne reste qu'un compte", r.joueurs.length === 1);

r = await post(jeu, { action: "etat" }, jPassante);
R("le jeton du compte supprimé ne vaut plus rien", r.code === 401);

const P = await store("pseudos");
R("le pseudo est libéré", !(await P.get("passante")));

r = await post(compte, { action: "inscription", pseudo: "Passante", mdp: "motdepasse1" });
R("quelqu'un peut reprendre le pseudo", r.ok === true);

console.log("\n" + n + " vérifications, " + (ko ? ko + " ERREUR(S)" : "aucune erreur"));
await rm(".data-outils", { recursive: true, force: true });
process.exit(ko ? 1 : 0);
