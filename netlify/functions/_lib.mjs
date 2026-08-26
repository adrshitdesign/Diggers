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

export async function signer(uid) {
  const charge = b64u(JSON.stringify({ u: uid, x: Date.now() + DUREE }));
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
  return d.u;
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

export async function utilisateur(uid) {
  if (!uid) return null;
  return await (await store("utilisateurs")).get(uid);
}

export async function ecrireUtilisateur(u) {
  u.maj = Date.now();
  await (await store("utilisateurs")).set(u.uid, u);
  return u;
}

export async function parPseudo(pseudo) {
  const idx = await (await store("pseudos")).get(norm(pseudo));
  return idx ? await utilisateur(idx.uid) : null;
}

export async function authentifier(req) {
  const h = req.headers.get("authorization") || "";
  const jeton = h.startsWith("Bearer ") ? h.slice(7) : "";
  const uid = await verifier(jeton);
  return uid ? await utilisateur(uid) : null;
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
    vitrine: (u.profil && u.profil.vitrine) || []
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
    album: t.album ? coupe(t.album, 160) : "",
    genre: t.genre ? coupe(t.genre, 60) : "Autre",
    year: Number(t.year),
    ms: Number(t.ms),
    art: String(t.art),
    preview: String(t.preview),
    url: String(t.url)
  };
}

export const signature = t => norm(t.artist) + "|" + norm(t.title);

export const uuid = () => randomUUID().replace(/-/g, "").slice(0, 16);

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
