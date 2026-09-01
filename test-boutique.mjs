// La boutique : ce qui s'achète en euros, ce qui s'achète en jetons, et
// surtout ce que le navigateur ne peut pas s'offrir tout seul.
//   node test-boutique.mjs

import { rm } from "node:fs/promises";
import { createHmac } from "node:crypto";

process.env.DIGGERS_STORE = "fichiers";
process.env.DIGGERS_DATA = ".data-boutique";
process.env.DIGGERS_SECRET = "test";
await rm(".data-boutique", { recursive: true, force: true });

const compte = (await import("./netlify/functions/compte.mjs")).default;
const boutique = (await import("./netlify/functions/boutique.mjs")).default;
const stripe = (await import("./netlify/functions/stripe.mjs")).default;
const B = await import("./netlify/functions/boutique.mjs");
const { store } = await import("./netlify/functions/_store.mjs");

let ko = 0, n = 0;
const R = (nom, v) => { n++; if (!v) ko++; console.log((v ? "  ok    " : "  ÉCHEC ") + nom); };

async function post(fn, corps, jeton) {
  const h = { "content-type": "application/json" };
  if (jeton) h.authorization = "Bearer " + jeton;
  const r = await fn(new Request("http://x/api", { method: "POST", headers: h, body: JSON.stringify(corps) }));
  return { code: r.status, ...(await r.json().catch(() => ({}))) };
}
/* Un message signé comme Stripe le signe. */
async function webhook(objet, { secret = process.env.STRIPE_WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000) } = {}) {
  const brut = JSON.stringify(objet);
  const sig = createHmac("sha256", secret).update(t + "." + brut).digest("hex");
  const r = await stripe(new Request("http://x/api/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=" + t + ",v1=" + sig },
    body: brut
  }));
  return { code: r.status, ...(await r.json().catch(() => ({}))) };
}
const evenement = (id, uid, jetons) => ({
  id, type: "checkout.session.completed",
  data: { object: { payment_status: "paid", amount_total: 999, currency: "eur",
    client_reference_id: uid, metadata: { uid, pack: "sacoche", jetons: String(jetons) } } }
});

let r = await post(compte, { action: "inscription", pseudo: "Mila", mdp: "motdepasse1" });
const jMila = r.jeton, uidMila = r.moi.uid;

console.log("\n=== LA VITRINE ===");
r = await post(boutique, { action: "vitrine" }, jMila);
R("la vitrine s'affiche même caisse fermée", r.code === 200 && r.cosmetiques.length > 0);
R("elle dit pourquoi elle ne vend pas", r.ouverte === false && /configur/.test(r.raison));
R("on part sans jetons", r.jetons === 0 && r.possede.length === 0);
r = await post(boutique, { action: "vitrine" });
R("il faut un compte pour entrer", r.code === 401);

console.log("\n=== ON NE PEUT PAS SE SERVIR ===");
r = await post(boutique, { action: "acheter", id: "ban-or" }, jMila);
R("acheter sans jetons est refusé", r.code === 402);
r = await post(boutique, { action: "acheter", id: "banniere-inventee" }, jMila);
R("un article inventé n'existe pas", r.code === 404);
r = await post(boutique, { action: "payer", pack: "sacoche" }, jMila);
R("payer sans caisse configurée est refusé", r.code === 503);

console.log("\n=== LA CAISSE ===");
process.env.STRIPE_SECRET = "sk_test_faux";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
r = await post(boutique, { action: "payer", pack: "sacoche" }, jMila);
R("sans mentions légales, on ne vend toujours rien", r.code === 503 && /mentions/i.test(r.erreur));
await (await store("config")).set("editeur", {
  nom: "Diggers", contact: "a@b.fr", adresse: "1 rue du Bac", directeur: "adr", statut: "asso"
});
r = await post(boutique, { action: "vitrine" }, jMila);
R("mentions remplies, la vitrine s'ouvre", r.ouverte === true);
r = await post(boutique, { action: "payer", pack: "pack-invente" }, jMila);
R("un pack inventé est refusé", r.code === 404);

console.log("\n=== LE MESSAGE DE LA BANQUE ===");
let mauvais = await stripe(new Request("http://x/api/stripe", {
  method: "POST", headers: { "content-type": "application/json" }, body: "{}"
}));
R("un message sans signature est refusé", mauvais.status === 400 || mauvais.code === 400);
r = await webhook(evenement("ev_1", uidMila, 650), { secret: "whsec_pas_le_bon" });
R("une signature qui ne colle pas est refusée", r.code === 400);
r = await webhook(evenement("ev_1", uidMila, 650), { t: Math.floor(Date.now() / 1000) - 4000 });
R("un message trop vieux est refusé", r.code === 400 && /horodatage/.test(r.erreur));

r = await webhook(evenement("ev_1", uidMila, 650));
R("un vrai message crédite les jetons", r.code === 200 && r.credite === 650);
r = await webhook(evenement("ev_1", uidMila, 650));
R("le même message ne crédite pas deux fois", r.code === 200 && r.deja === true);
r = await post(boutique, { action: "vitrine" }, jMila);
R("les jetons sont bien là", r.jetons === 650);

r = await webhook({ id: "ev_2", type: "payment_intent.created", data: { object: {} } });
R("les autres événements sont acquittés sans rien faire", r.code === 200 && !!r.ignore);
r = await webhook({ id: "ev_3", type: "checkout.session.completed",
  data: { object: { payment_status: "unpaid", metadata: { uid: uidMila, jetons: "9999" } } } });
R("une session non payée ne crédite rien", r.code === 200 && !!r.ignore);
r = await post(boutique, { action: "vitrine" }, jMila);
R("le solde n'a pas bougé", r.jetons === 650);

console.log("\n=== DÉPENSER ===");
r = await post(boutique, { action: "acheter", id: "ban-or" }, jMila);
R("on achète une bannière", r.code === 200 && r.jetons === 400 && r.possede.includes("ban-or"));
r = await post(boutique, { action: "acheter", id: "ban-or" }, jMila);
R("on ne l'achète pas deux fois", r.code === 409);
r = await post(compte, { action: "profil", profil: { banniere: "or" } }, jMila);
R("et on peut enfin la porter", r.code === 200 && r.moi.profil.banniere === "or");
r = await post(compte, { action: "profil", profil: { banniere: "chrome" } }, jMila);
R("mais pas celle du voisin", r.code === 403);

console.log("\n=== LES JETONS NE SONT QUE DU DÉCOR ===");
const dossier = await (await store("utilisateurs")).get(uidMila);
R("ils ne touchent pas aux crédits du jeu",
  !dossier.jeu || dossier.jeu.credits === undefined || dossier.jeu.credits === 400);
R("aucune action de la boutique ne rend de crédits ni de cartes",
  !JSON.stringify(B.COSMETIQUES).match(/credit|carte|carton|eclat/i));

console.log("\n" + n + " vérifications, " + (ko ? ko + " ÉCHEC(S)" : "aucune erreur"));
await rm(".data-boutique", { recursive: true, force: true });
process.exit(ko ? 1 : 0);
