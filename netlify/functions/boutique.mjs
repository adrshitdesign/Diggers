// /api/boutique — la seule chose qui s'achète avec de l'argent réel : du décor.
//
// Règle de cadrage, décidée avant d'écrire une ligne : les Jetons n'achètent
// que de l'apparence. Ils ne se convertissent pas en crédits, ils n'ouvrent pas
// de carton, ils n'entrent pas au marché, ils ne touchent pas au classement —
// qui note l'oreille, pas la collection. Personne ne peut acheter une place.
//
// Conséquence directe : il n'y a rien d'aléatoire à vendre. Pas de carton
// payant, donc pas de loot box, donc pas de régime JONUM à porter.
//
// Deux variables d'environnement ouvrent la caisse. Tant qu'elles sont vides,
// la boutique s'affiche mais ne vend rien :
//   STRIPE_SECRET          la clé secrète Stripe (sk_live_… ou sk_test_…)
//   STRIPE_WEBHOOK_SECRET  le secret de l'endpoint /api/stripe (whsec_…)

import { store } from "./_store.mjs";
import {
  ok, ko, preflight, corps, authentifier, ecrireUtilisateur, ipDe, verrouActif, echec, attends,
  majJoueur
} from "./_lib.mjs";
import { adresseDuSite } from "./_mail.mjs";
import { COULEURS, BANNIERES } from "./_lib.mjs";

export const config = { path: "/api/boutique" };

/* ---------------- ce qui se vend ---------------- */

// Les packs de Jetons. Les prix sont en centimes d'euro, TVA comprise.
export const PACKS = [
  { id: "poignee", n: "Une poignée", jetons: 120,  cents: 199 },
  { id: "sacoche", n: "Une sacoche", jetons: 650,  cents: 999,  bonus: "+8 %" },
  { id: "caisse",  n: "Une caisse",  jetons: 1500, cents: 1999, bonus: "+25 %" }
];

// Le décor. Rien ici ne change une règle du jeu.
export const COSMETIQUES = [
  { id: "ban-or",       type: "banniere", val: "or",       n: "Bannière Or",        prix: 250, d: "Un bandeau doré sur ton profil." },
  { id: "ban-chrome",   type: "banniere", val: "chrome",   n: "Bannière Chrome",    prix: 250, d: "Métal brossé, reflets froids." },
  { id: "ban-beton",    type: "banniere", val: "beton",    n: "Bannière Béton",     prix: 180, d: "Le mur du fond d'un sous-sol." },
  { id: "ban-velours",  type: "banniere", val: "velours",  n: "Bannière Velours",   prix: 180, d: "Le tapis d'une platine haut de gamme." },
  { id: "coul-nuit",    type: "couleur",  val: "nuit",     n: "Accent Nuit",        prix: 150, d: "Un bleu presque noir." },
  { id: "coul-cuivre",  type: "couleur",  val: "cuivre",   n: "Accent Cuivre",      prix: 150, d: "Chaud, mat, un peu vieilli." },
  { id: "coul-menthe",  type: "couleur",  val: "menthe",   n: "Accent Menthe",      prix: 150, d: "Vert pâle, très années 90." }
];

export const COULEURS_PAYANTES = COSMETIQUES.filter(c => c.type === "couleur").map(c => c.val);
export const BANNIERES_PAYANTES = COSMETIQUES.filter(c => c.type === "banniere").map(c => c.val);

/* Ce qu'un joueur a le droit de porter : le décor libre, plus ce qu'il a acheté. */
export function cosmetiquesDe(u) {
  const possede = Array.isArray(u.cosmetiques) ? u.cosmetiques : [];
  const objets = COSMETIQUES.filter(c => possede.includes(c.id));
  return {
    ids: possede,
    couleurs: COULEURS.concat(objets.filter(c => c.type === "couleur").map(c => c.val)),
    bannieres: BANNIERES.concat(objets.filter(c => c.type === "banniere").map(c => c.val))
  };
}

export const jetonsDe = u => Math.max(0, Number(u.jetons) || 0);

export const caisseOuverte = () => !!(process.env.STRIPE_SECRET && process.env.STRIPE_WEBHOOK_SECRET);

/* On ne vend rien tant que les mentions légales ne sont pas remplies : c'est
   obligatoire en France dès qu'il y a une transaction, et ça évite d'encaisser
   avant d'avoir un éditeur identifiable. */
/* Attention au point de bascule : tant que le site est gratuit, son éditeur
   peut rester un particulier anonyme (voir moderation.mjs). Dès qu'il encaisse
   un euro il devient un professionnel, et l'anonymat tombe — nom, adresse et
   directeur de publication doivent être affichés. C'est pour ça que ce test-ci
   est plus exigeant que celui des mentions. */
async function mentionsCompletes() {
  const e = await (await store("config")).get("editeur");
  return !!(e && e.nom && e.contact && e.adresse && e.directeur);
}

export default async function (req) {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return ko(405, "méthode non autorisée");

  const u = await authentifier(req);
  if (!u) return ko(401, "Connexion expirée.");
  const b = await corps(req);

  const vitrine = async () => {
    const legal = await mentionsCompletes();
    return {
      jetons: jetonsDe(u),
      possede: cosmetiquesDe(u).ids,
      cosmetiques: COSMETIQUES,
      packs: PACKS,
      ouverte: caisseOuverte() && legal,
      raison: !caisseOuverte() ? "La caisse n'est pas configurée sur ce site."
        : !legal ? "Les mentions légales du site doivent être remplies avant toute vente." : ""
    };
  };

  switch (b.action) {

    case "vitrine":
      return ok(await vitrine());

    /* ---------- dépenser des jetons en décor ---------- */
    case "acheter": {
      const c = COSMETIQUES.find(x => x.id === String(b.id || ""));
      if (!c) return ko(404, "Cet article n'existe pas.");
      /* Deux achats lancés en même temps lisaient le même solde et
         n'en débitaient qu'un : on repayait une seule fois deux objets.
         Le contrôle du solde et le débit sont maintenant la même opération. */
      let raison = "";
      const r = await majJoueur(u.uid, (f) => {
        const possede = Array.isArray(f.cosmetiques) ? f.cosmetiques : [];
        if (possede.includes(c.id)) { raison = "Tu l'as déjà."; return null; }
        if (jetonsDe(f) < c.prix) { raison = "Pas assez de jetons."; return null; }
        f.jetons = jetonsDe(f) - c.prix;
        f.cosmetiques = possede.concat([c.id]);
        return f;
      });
      if (!r.ecrit) return ko(raison === "Tu l'as déjà." ? 409 : raison ? 402 : 409,
        raison || "Achat non enregistré, réessaie.");
      u.jetons = r.val.jetons; u.cosmetiques = r.val.cosmetiques;
      return ok({ achete: c.id, ...(await vitrine()) });
    }

    /* ---------- payer en euros : on ne fait qu'ouvrir la page de Stripe ----------
       Aucun numéro de carte ne passe par ce serveur ni par le jeu : le joueur
       paie chez Stripe, qui nous prévient ensuite par /api/stripe. */
    case "payer": {
      const p = PACKS.find(x => x.id === String(b.pack || ""));
      if (!p) return ko(404, "Ce pack n'existe pas.");
      if (!caisseOuverte()) return ko(503, "La caisse n'est pas configurée sur ce site.");
      if (!await mentionsCompletes())
        return ko(503, "Les mentions légales du site doivent être remplies avant toute vente.");

      const lim = "pay:" + ipDe(req);
      const bloque = await verrouActif(lim);
      if (bloque) return ko(429, "Trop de tentatives de paiement. " + attends(bloque));
      await echec(lim, { max: 12, fenetre: 3600000, verrou: 1800000 });

      const site = adresseDuSite(req);
      const params = new URLSearchParams();
      params.set("mode", "payment");
      params.set("success_url", site + "/?paiement=ok");
      params.set("cancel_url", site + "/?paiement=annule");
      params.set("client_reference_id", u.uid);
      params.set("metadata[uid]", u.uid);
      params.set("metadata[pack]", p.id);
      params.set("metadata[jetons]", String(p.jetons));
      params.set("line_items[0][quantity]", "1");
      params.set("line_items[0][price_data][currency]", "eur");
      params.set("line_items[0][price_data][unit_amount]", String(p.cents));
      params.set("line_items[0][price_data][product_data][name]", p.jetons + " jetons Diggers");
      params.set("line_items[0][price_data][product_data][description]",
        "Monnaie de décor. N'achète que de l'apparence : ni cartes, ni crédits, ni classement.");
      // Contenu numérique livré tout de suite : le joueur renonce expressément
      // à son droit de rétractation, et Stripe garde la trace de son accord.
      params.set("consent_collection[terms_of_service]", "required");
      params.set("custom_text[terms_of_service_acceptance][message]",
        "Les jetons sont crédités immédiatement. En validant, tu demandes leur livraison tout de suite et tu renonces à ton droit de rétractation de 14 jours.");

      try {
        const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: {
            authorization: "Bearer " + process.env.STRIPE_SECRET,
            "content-type": "application/x-www-form-urlencoded"
          },
          body: params.toString(),
          signal: AbortSignal.timeout(9000)
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.url) return ko(502, "La caisse a refusé : " + ((d.error && d.error.message) || r.status));
        return ok({ url: d.url });
      } catch (e) {
        return ko(504, "La caisse est injoignable.");
      }
    }

    default:
      return ko(400, "Action inconnue.");
  }
}
