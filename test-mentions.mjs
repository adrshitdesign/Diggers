// Les mentions légales, et le seul point qui compte vraiment : un particulier
// qui édite un site gratuit n'est pas obligé d'afficher son adresse personnelle,
// mais il le redevient à la seconde où le site encaisse.
//   node test-mentions.mjs

import { rm } from "node:fs/promises";

process.env.DIGGERS_STORE = "fichiers";
process.env.DIGGERS_DATA = ".data-mentions";
process.env.DIGGERS_SECRET = "test";
process.env.DIGGERS_ADMIN = "cle-admin-de-test";
await rm(".data-mentions", { recursive: true, force: true });

const compte = (await import("./netlify/functions/compte.mjs")).default;
const moderation = (await import("./netlify/functions/moderation.mjs")).default;
const boutique = (await import("./netlify/functions/boutique.mjs")).default;
const { store } = await import("./netlify/functions/_store.mjs");

let ko = 0, n = 0;
const R = (nom, v) => { n++; if (!v) ko++; console.log((v ? "  ok    " : "  ÉCHEC ") + nom); };
let nIp = 0;
async function post(fn, corps, jeton) {
  const h = { "content-type": "application/json", "x-nf-client-connection-ip": "10.0." + (++nIp) + ".1" };
  if (jeton) h.authorization = "Bearer " + jeton;
  const r = await fn(new Request("http://x/api", { method: "POST", headers: h, body: JSON.stringify(corps) }));
  return { code: r.status, ...(await r.json().catch(() => ({}))) };
}

const j = (await post(compte, { action: "inscription", pseudo: "Patron", mdp: "motdepasse1" })).jeton;
await post(compte, { action: "admin", cle: process.env.DIGGERS_ADMIN }, j);
const C = await store("config");

console.log("\n=== CE QUI EST REFUSÉ ===");
let r = await post(moderation, { action: "mentions", editeur: { nom: "adr" } }, j);
R("sans adresse de contact, c'est refusé", r.code === 400);
r = await post(moderation, { action: "mentions", editeur: { contact: "contact@exemple.fr" } }, j);
R("un professionnel sans nom ni adresse est refusé", r.code === 400);

console.log("\n=== LE RÉGIME DU PARTICULIER ===");
r = await post(moderation, { action: "mentions", editeur: {
  contact: "contact@exemple.fr", particulier: true } }, j);
R("un particulier peut s'enregistrer avec le seul contact", r.code === 200);
R("le drapeau est bien gardé", r.editeur.particulier === true);
R("l'hébergeur est rempli d'office", /Netlify/.test(r.editeur.hebergeur));
R("et aucune adresse personnelle n'a été enregistrée", !r.editeur.adresse);

const enBase = await C.get("editeur");
R("rien d'autre n'est stocké non plus", !enBase.adresse && !enBase.nom);

console.log("\n=== MAIS LA CAISSE, ELLE, EXIGE TOUT ===");
process.env.STRIPE_SECRET = "sk_test";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
r = await post(boutique, { action: "vitrine" }, j);
R("la boutique reste fermée sous le régime du particulier", r.ouverte === false);
R("et elle dit pourquoi", /mentions légales/i.test(r.raison || ""));
r = await post(boutique, { action: "payer", pack: "poignee" }, j);
R("payer est refusé tant que l'éditeur est anonyme", r.code === 503);

r = await post(moderation, { action: "mentions", editeur: {
  nom: "adr", statut: "entrepreneur individuel", adresse: "12 rue de l'Exemple, 75000 Paris",
  contact: "contact@exemple.fr", directeur: "adr", particulier: false } }, j);
R("le régime professionnel s'enregistre", r.code === 200 && r.editeur.particulier === false);
r = await post(boutique, { action: "vitrine" }, j);
R("et là seulement la caisse s'ouvre", r.ouverte === true);

delete process.env.STRIPE_SECRET;
delete process.env.STRIPE_WEBHOOK_SECRET;

console.log("\n=== QUI A LE DROIT ===");
const j2 = (await post(compte, { action: "inscription", pseudo: "Passant", mdp: "motdepasse1" })).jeton;
r = await post(moderation, { action: "mentions", editeur: { contact: "x@y.fr", particulier: true } }, j2);
R("un joueur ordinaire ne change pas les mentions", r.code === 403);
/* La lecture publique ne passe pas par /api/moderation, qui est réservé à la
   modération : elle vient du catalogue, que tout le monde peut ouvrir. */
const catalogue = (await import("./netlify/functions/catalogue.mjs")).default;
const rep = await catalogue(new Request("http://x/api/catalogue", { method: "GET" }));
const cat = await rep.json();
R("les mentions sont publiées à tout le monde par le catalogue",
  rep.status === 200 && cat.meta && cat.meta.editeur && cat.meta.editeur.contact === "contact@exemple.fr");
R("et le régime en cours voyage avec", cat.meta.editeur.particulier === false);

console.log("\n" + (ko ? ko + " ÉCHEC(S) sur " + n : n + " vérifications, aucune erreur"));
await rm(".data-mentions", { recursive: true, force: true });
process.exit(ko ? 1 : 0);
