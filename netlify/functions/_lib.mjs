// Briques communes à toutes les fonctions : réponses, jetons, comptes, garde-fous.

import { randomBytes, scryptSync, timingSafeEqual, createHmac, randomUUID } from "node:crypto";
import { store } from "./_store.mjs";

/* ---------- réponses ---------- */

const ENTETES = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "cache-control": "no-store"
};

export const ok = (data, entetes) =>
  new Response(JSON.stringify(data ?? { ok: true }), { status: 200, headers: { ...ENTETES, ...(entetes || {}) } });

export const ko = (code, raison, details) =>
  new Response(JSON.stringify({ erreur: raison, ...(details || {}) }), { status: code, headers: ENTETES });

export const preflight = () => new Response(null, { status: 204, headers: ENTETES });

export async function corps(req) {
  try { return await req.json(); } catch { return {}; }
}

/* ---------- secret de signature ---------- */

let SECRET = null;
async function secret() {
  if (SECRET) return SECRET;
  if (process.env.DIGGERS_SECRET) { SECRET = process.env.DIGGERS_SECRET; return SECRET; }
  // Rangement séparé de tout ce qui est lu publiquement.
  const s = await store("secrets");
  let v = await s.get("secret");
  if (!v) { v = { k: randomBytes(32).toString("hex") }; await s.set("secret", v); }
  SECRET = v.k;
  return SECRET;
}

/* ---------- jetons ---------- */

const b64u = b => Buffer.from(b).toString("base64url");
const DUREE = 1000 * 60 * 60 * 24 * 180;   // six mois

export async function signer(uid, v) {
  // `v` est la génération de session du compte : elle augmente quand le mot de
  // passe change, ce qui invalide d'un coup tous les jetons déjà distribués.
  const charge = b64u(JSON.stringify({ u: uid, x: Date.now() + DUREE, v: v || 0 }));
  const sig = createHmac("sha256", await secret()).update(charge).digest("base64url");
  return charge + "." + sig;
}

export async function verifier(jeton) {
  if (!jeton || typeof jeton !== "string" || jeton.indexOf(".") < 0) return null;
  const [charge, sig] = jeton.split(".");
  const attendu = createHmac("sha256", await secret()).update(charge).digest("base64url");
  if (sig.length !== attendu.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(attendu))) return null;
  let d; try { d = JSON.parse(Buffer.from(charge, "base64url").toString("utf8")); } catch { return null; }
  if (!d || !d.u || !d.x || d.x < Date.now()) return null;
  return d;
}

/* ---------- mots de passe ---------- */

export function hacher(mdp) {
  const sel = randomBytes(16).toString("hex");
  return { sel, hash: scryptSync(mdp, sel, 64).toString("hex") };
}
export function verifierMdp(mdp, sel, hash) {
  const a = Buffer.from(scryptSync(mdp, sel, 64).toString("hex"));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------- comptes ---------- */

export const norm = s => (s || "").toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "");

export const PSEUDO_OK = /^[\p{L}\p{N}][\p{L}\p{N} _.'\-]{1,17}$/u;

export const RESERVES = new Set(["admin", "moderateur", "moderation", "diggers", "systeme", "system",
  "root", "support", "equipe", "staff", "null", "undefined", "anonyme"]);

/* ============================================================
   RÉÉCRIRE UNE FICHE SANS EFFACER CE QUE D'AUTRES Y ONT MIS
   ------------------------------------------------------------
   Le trou : une douzaine d'endroits lisaient la fiche entière, la
   modifiaient, puis la réécrivaient telle quelle. Pendant ce temps, une
   vente au marché avait pu créditer le vendeur, Stripe ajouter des jetons,
   un autre joueur envoyer une carte. La réécriture repartait de la photo
   d'avant, et tout ça disparaissait sans bruit.

   Maintenant, chaque fiche lue garde une copie de ce qu'elle était au moment
   de la lecture. À l'écriture, on compare trois versions — celle qu'on a lue,
   celle qu'on a modifiée, celle qui est en base à cet instant — et on
   n'applique QUE ce qu'on a changé, par-dessus ce que les autres ont changé :
     · un nombre modifié des deux côtés additionne les deux écarts (le
       vendeur a gagné 250 pendant qu'il en dépensait 100 : +150) ;
     · une liste de cartes se fusionne carte par carte (par uid) ;
     · le reste suit la dernière écriture, comme avant.
   L'écriture elle-même est conditionnelle (majAtomique) : si la base bouge
   encore entre-temps, on refusionne.
   ============================================================ */
const LUES = new WeakMap();   // fiche -> son texte au moment de la lecture

export async function utilisateur(uid) {
  if (!uid) return null;
  const u = await (await store("utilisateurs")).get(uid);
  if (u && typeof u === "object") LUES.set(u, JSON.stringify(u));
  return u;
}

const pareil = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const objetSimple = v => !!v && typeof v === "object" && !Array.isArray(v);
const cleDe = x => objetSimple(x) ? (x.uid ?? x.id) : undefined;
const HORODATAGE = 1e12;      // au-delà, un nombre est une date, pas un compteur

export function fusionner(base, mien, leur) {
  if (pareil(mien, base)) return leur;       // je n'y ai pas touché
  if (pareil(leur, base)) return mien;       // personne d'autre n'y a touché
  if (typeof mien === "number" && typeof leur === "number" && typeof base === "number") {
    if (Math.abs(mien) >= HORODATAGE || Math.abs(leur) >= HORODATAGE) return Math.max(mien, leur);
    return leur + (mien - base);
  }
  if (objetSimple(mien) && objetSimple(leur)) {
    const b = objetSimple(base) ? base : {};
    const r = {};
    for (const k of new Set([...Object.keys(leur), ...Object.keys(mien), ...Object.keys(b)])) {
      const v = fusionner(b[k], mien[k], leur[k]);
      if (v !== undefined) r[k] = v;
    }
    return r;
  }
  if (Array.isArray(mien) && Array.isArray(leur)) {
    const b = Array.isArray(base) ? base : [];
    const tous = [...b, ...mien, ...leur];
    // Liste d'objets identifiés (cartes, récompenses) : fusion élément par élément.
    if (tous.length && tous.every(x => cleDe(x) !== undefined)) {
      const parCle = l => new Map(l.map(x => [String(cleDe(x)), x]));
      const B = parCle(b), M = parCle(mien);
      const r = [];
      for (const x of leur) {
        const k = String(cleDe(x));
        if (B.has(k) && !M.has(k)) continue;              // je l'ai retiré
        r.push(M.has(k) ? fusionner(B.get(k), M.get(k), x) : x);
      }
      const L = parCle(leur);
      for (const x of mien) {
        const k = String(cleDe(x));
        if (!B.has(k) && !L.has(k)) r.push(x);            // je l'ai ajouté
      }
      return r;
    }
    // Liste de valeurs simples (décors achetés…) : ajouts et retraits de chacun.
    if (tous.every(x => x === null || typeof x !== "object")) {
      const r = leur.filter(x => !(b.includes(x) && !mien.includes(x)));
      for (const x of mien) if (!b.includes(x) && !r.includes(x)) r.push(x);
      return r;
    }
  }
  return mien;
}

export async function ecrireUtilisateur(u) {
  const lue = LUES.get(u);
  // Sans copie de lecture (une création, en pratique), on fusionne quand
  // même : si la fiche existe déjà, rien de ce qu'elle contient ne se perd.
  const base = lue ? JSON.parse(lue) : undefined;
  const r = await majAtomique("utilisateurs", u.uid, (leur) => {
    if (!leur) return lue ? null : { ...u, maj: Date.now() };   // effacée entre-temps : pas de résurrection
    const f = fusionner(base, u, leur);
    f.maj = Date.now();
    return f;
  });
  if (r.ecrit) {
    // La fiche de l'appelant reflète ce qui est réellement en base.
    for (const k of Object.keys(u)) if (!(k in r.val)) delete u[k];
    Object.assign(u, r.val);
    LUES.set(u, JSON.stringify(r.val));
  } else if (r.raison !== "abandon") {
    throw new Error("Fiche joueur trop disputée, écriture abandonnée.");
  }
  return u;
}

export async function parPseudo(pseudo) {
  const idx = await (await store("pseudos")).get(norm(pseudo));
  return idx ? await utilisateur(idx.uid) : null;
}

export async function authentifier(req) {
  const h = req.headers.get("authorization") || "";
  const jeton = h.startsWith("Bearer ") ? h.slice(7) : "";
  const d = await verifier(jeton);
  if (!d) return null;
  const u = await utilisateur(d.u);
  if (!u) return null;
  // Un jeton d'avant le dernier changement de mot de passe ne vaut plus rien.
  if ((d.v || 0) !== (u.sessionV || 0)) return null;
  return u;
}

export const estModerateur = u => !!u && (u.role === "admin" || u.role === "moderateur");

/* ---------- ce que le client a le droit de voir ---------- */

export function profilPublic(u) {
  if (!u) return null;
  return {
    uid: u.uid, pseudo: u.pseudo, role: u.role || "joueur",
    cree: u.cree,
    profil: u.profil || {},
    stats: u.stats || { propositions: 0, validees: 0, refusees: 0 },
    vitrine: (u.profil && u.profil.vitrine) || [],
    // l'adresse, si le joueur en a posé une : elle n'apparaît que dans sa
    // propre réponse, jamais dans un classement ou un crew
    email: u.email ? { adresse: u.email.adresse, verifie: !!u.email.verifie } : null,
    jetons: Math.max(0, Number(u.jetons) || 0),
    cosmetiques: Array.isArray(u.cosmetiques) ? u.cosmetiques : []
  };
}

/* ---------- garde-fous sur les sons proposés ---------- */
// La règle : on n'accepte jamais un fichier audio envoyé par un joueur.
// On n'accepte qu'un morceau trouvé dans le catalogue d'Apple, dont l'extrait
// reste hébergé chez Apple. Ça évite l'hébergement d'audio sous droits,
// et ça garde l'attribution qu'impose l'API iTunes.

const HOTES_EXTRAIT = [/\.mzstatic\.com$/i, /\.apple\.com$/i];
const HOTES_IMAGE   = [/\.mzstatic\.com$/i, /\.apple\.com$/i];
const HOTES_PAGE    = [/^music\.apple\.com$/i, /^itunes\.apple\.com$/i];

function hoteOk(url, liste) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return liste.some(r => r.test(u.hostname));
  } catch { return false; }
}

const REJET_ARTISTE = /\b(karaoke|karaok[ée]|tribute|made famous|in the style of|originally performed|instrumental|backing track|cover version|hommage|sound-alike|as made popular)\b/i;

export function validerTrack(t) {
  if (!t || typeof t !== "object") return "morceau manquant";
  const chaine = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
  if (!chaine(t.title, 160)) return "titre invalide";
  if (!chaine(t.artist, 120)) return "artiste invalide";
  if (REJET_ARTISTE.test(t.artist) || REJET_ARTISTE.test(t.title)) return "reprise ou karaoké";
  if (!hoteOk(t.preview, HOTES_EXTRAIT)) return "l'extrait doit venir du catalogue Apple";
  if (!hoteOk(t.art, HOTES_IMAGE)) return "la pochette doit venir du catalogue Apple";
  if (!hoteOk(t.url, HOTES_PAGE)) return "le lien doit pointer vers Apple Music";
  const an = Number(t.year);
  if (!an || an < 1900 || an > new Date().getFullYear() + 1) return "année invalide";
  const ms = Number(t.ms);
  if (!ms || ms < 20000 || ms > 3600000) return "durée invalide";
  return null;
}

export function nettoyerTrack(t) {
  const coupe = (v, n) => String(v).trim().slice(0, n);
  return {
    id: "c" + (String(t.id || "").replace(/[^0-9a-zA-Z]/g, "").slice(0, 24) || randomUUID().slice(0, 8)),
    title: coupe(t.title, 160),
    artist: coupe(t.artist, 120),
    // la ligne de crédits complète (featurings) quand elle diffère de l'artiste
    credits: t.credits ? coupe(t.credits, 160) : "",
    album: t.album ? coupe(t.album, 160) : "",
    genre: t.genre ? coupe(t.genre, 60) : "Autre",
    year: Number(t.year),
    ms: Number(t.ms),
    art: urlPropre(t.art),
    preview: urlPropre(t.preview),
    url: urlPropre(t.url)
  };
}

/* Une adresse relue par le parseur d'URL, jamais recopiée telle quelle.
   `new URL()` accepte « https://a.mzstatic.com/x"onerror="… » et vérifie
   bien l'hôte, mais la chaîne brute garde son guillemet : posée dans un
   <img src="…">, elle sortait de l'attribut et exécutait du code chez le
   modérateur qui ouvrait la file. `.href` rend la forme normalisée, où
   guillemets, chevrons et espaces sont encodés. */
export function urlPropre(v) {
  try { return new URL(String(v)).href; } catch { return ""; }
}

export const signature = t => norm(t.artist) + "|" + norm(t.title);

export const uuid = () => randomUUID().replace(/-/g, "").slice(0, 16);

/* ---------- adresses e-mail ----------
   L'adresse est facultative : elle ne sert qu'à retrouver un mot de passe
   perdu. Elle est stockée en clair (il faut bien pouvoir écrire dessus) et
   part avec le compte quand le joueur l'efface. */
/* Le décor offert à tout le monde. Le décor payant vit dans boutique.mjs. */
export const COULEURS = ["ambre", "vert", "violet", "rouge", "bleu", "rose", "or"];
export const BANNIERES = ["nuit", "cassette", "vinyle", "neon", "papier", "sable"];

export const EMAIL_OK = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
export const normEmail = e => String(e || "").trim().toLowerCase().slice(0, 160);

/* Un secret à usage unique : on n'en garde que l'empreinte, jamais la valeur. */
export function secretUsageUnique(octets) {
  const clair = randomBytes(octets || 24).toString("base64url");
  return { clair, empreinte: empreinteDe(clair) };
}
export const empreinteDe = v => createHmac("sha256", "diggers-empreinte").update(String(v)).digest("hex");
export function empreinteEgale(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export const jour = () => {
  const d = new Date();
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
};

/* ---------- verrou contre l'essai en masse de mots de passe ---------- */
// Un compteur par clé (pseudo, adresse IP). Au-delà du seuil, on ferme la
// porte pour un moment. Les tentatives réussies effacent le compteur.

export function ipDe(req) {
  return req.headers.get("x-nf-client-connection-ip")
    || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || req.headers.get("client-ip")
    || "inconnue";
}

export async function verrouActif(cle) {
  const v = await (await store("limites")).get(cle);
  if (v && v.jusqu > Date.now()) return Math.ceil((v.jusqu - Date.now()) / 1000);
  return 0;
}

export async function echec(cle, opts) {
  const { max = 6, fenetre = 900000, verrou = 900000 } = opts || {};
  const s = await store("limites");
  const now = Date.now();
  const v = (await s.get(cle)) || { n: 0, debut: now, jusqu: 0 };
  if (now - v.debut > fenetre) { v.n = 0; v.debut = now; }
  v.n++;
  if (v.n >= max) { v.jusqu = now + verrou; v.n = 0; v.debut = now; }
  await s.set(cle, v);
  return v.jusqu > now ? Math.ceil((v.jusqu - now) / 1000) : 0;
}

export async function relacher(cle) { await (await store("limites")).del(cle); }

export function attends(secondes) {
  const m = Math.ceil(secondes / 60);
  return m <= 1 ? "Réessaie dans une minute." : "Réessaie dans " + m + " minutes.";
}

/* ============================================================
   ÉCRIRE À PLUSIEURS SANS SE MARCHER DESSUS
   ------------------------------------------------------------
   Deux outils, et une règle : toute écriture qui touche à des crédits,
   des jetons ou des cartes passe par l'un des deux.

   · majJoueur   — modifier la fiche d'un joueur, y compris quand ce joueur
                   est en train de jouer ailleurs. On relit, on transforme, et
                   on n'écrit que si personne n'a bougé entre-temps.
   · sousVerrou  — empêcher deux requêtes du MÊME joueur de se croiser.
                   Un double-clic ouvrait deux cartons et n'en payait qu'un.
   ============================================================ */

import { majAtomique } from "./_store.mjs";
export { majAtomique };

export async function majJoueur(uid, transformer) {
  const r = await majAtomique("utilisateurs", uid, (u) => {
    if (!u) return null;
    const sortie = transformer(u);
    if (sortie === null || sortie === undefined) return null;
    sortie.maj = Date.now();
    return sortie;
  });
  if (r.ecrit && r.val) LUES.set(r.val, JSON.stringify(r.val));
  return r;
}

/* Un bail court, posé par écriture conditionnelle : celui qui l'obtient
   travaille, les autres attendent leur tour. Le bail expire tout seul, donc
   une fonction qui plante ne bloque personne plus de quelques secondes. */
export async function sousVerrou(cle, travail, opts) {
  const { attente = 5000, bail = 12000 } = opts || {};
  const s = await store("verrous");
  if (!s.lire || !s.ecrireSi) return await travail();   // rangement sans condition : on ne bloque pas le jeu
  const moi = uuid();
  const limite = Date.now() + attente;
  let pris = false;

  while (Date.now() < limite) {
    const { val, etag } = await s.lire(cle);
    if (val && val.jusqu > Date.now()) {
      await new Promise(r => setTimeout(r, 25 + Math.floor(Math.random() * 70)));
      continue;
    }
    const r = await s.ecrireSi(cle, { par: moi, jusqu: Date.now() + bail }, etag);
    if (r.ok) { pris = true; break; }
  }
  if (!pris) { const e = new Error("occupé"); e.occupe = true; throw e; }

  try {
    return await travail();
  } finally {
    try {
      const { val, etag } = await s.lire(cle);
      if (val && val.par === moi) await s.ecrireSi(cle, { par: null, jusqu: 0 }, etag);
    } catch { /* le bail expirera tout seul */ }
  }
}

/* Le même bail, mais qui répond poliment au lieu de lever. */
export async function sousVerrouOuKo(cle, travail) {
  try { return await sousVerrou(cle, travail); }
  catch (e) {
    if (e && e.occupe) return ko(429, "Une autre action est en cours sur ton compte. Réessaie dans un instant.");
    throw e;
  }
}

/* La bonne façon de traiter une action qui modifie le joueur.
   Le détail qui compte : la fiche est RELUE une fois le bail obtenu.
   Sans cette relecture, les requêtes attendaient bien leur tour mais
   travaillaient toutes sur la photo prise avant la file d'attente — le
   verrou ne servait à rien. */
export async function avecJoueur(u, travail) {
  return await sousVerrouOuKo("joueur:" + u.uid, async () => {
    const frais = await utilisateur(u.uid);
    return await travail(frais || u);
  });
}

/* Une graine reproductible à partir d'un texte : sert au thème du jour. */
export function seedOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
