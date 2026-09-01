// Couche de rangement. Trois dos possibles, essayés dans cet ordre :
//   1. le paquet @netlify/blobs, s'il est installé (déploiement Git ou CLI) ;
//   2. l'API Blobs en direct, sans aucune dépendance (déploiement par glisser-déposer) ;
//   3. des fichiers JSON en local, pour développer et tester hors ligne.
// Le reste du code ne voit pas la différence.

import { mkdir, readFile, writeFile, unlink, readdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const empreinte = t => '"' + createHash("sha1").update(t).digest("hex") + '"';

let mode = null;          // "sdk" | "api" | "fichiers"
let getStoreFn = null;
let ctx = null;

function contexte() {
  const brut = globalThis.netlifyBlobsContext || process.env.NETLIFY_BLOBS_CONTEXT;
  if (!brut) return null;
  try {
    const o = typeof brut === "string" ? JSON.parse(Buffer.from(brut, "base64").toString("utf8")) : brut;
    return (o && o.siteID && o.token) ? o : null;
  } catch { return null; }
}

async function init() {
  if (mode) return;
  if (process.env.DIGGERS_STORE === "fichiers") { mode = "fichiers"; return; }
  if (process.env.DIGGERS_STORE !== "api") {
    try {
      const m = await import("@netlify/blobs");
      m.getStore({ name: "diggers-sonde", consistency: "strong" });   // lève si le contexte manque
      getStoreFn = m.getStore; mode = "sdk"; return;
    } catch { /* on continue */ }
  }
  ctx = contexte();
  mode = ctx ? "api" : "fichiers";
}

const RACINE = process.env.DIGGERS_DATA || ".data";

/* En local, un seul processus : une file d'attente par clé suffit à rendre
   le lire-comparer-écrire réellement indivisible. En ligne, c'est l'etag
   de Netlify qui joue ce rôle. */
/* On écrit à côté, puis on renomme : le renommage est indivisible, donc un
   lecteur ne voit jamais un fichier à moitié écrit. Sans ça, deux requêtes
   qui se croisent peuvent faire lire du vide. */
async function poser(nom, cle, texte) {
  const cible = chemin(nom, cle);
  const temporaire = cible + "." + Math.random().toString(36).slice(2, 10) + ".tmp";
  await mkdir(dirname(cible), { recursive: true });
  await writeFile(temporaire, texte);
  await rename(temporaire, cible);
}

const files = new Map();
function enFile(cle, travail) {
  const precedent = files.get(cle) || Promise.resolve();
  const suivant = precedent.then(travail, travail);
  files.set(cle, suivant.catch(() => {}));
  return suivant;
}
const chemin = (nom, cle) => join(RACINE, nom, encodeURIComponent(cle) + ".json");

/* ---------- client Blobs minimal, sans dépendance ---------- */

function clientApi(nomStore) {
  const base = ctx.uncachedEdgeURL || ctx.edgeURL;
  if (!base) throw new Error("Contexte Blobs sans edgeURL");
  const store = "site:" + nomStore;
  const url = cle => new URL("/" + ctx.siteID + "/" + encodeURIComponent(store) +
    (cle ? "/" + cle.split("/").map(encodeURIComponent).join("/") : ""), base);
  const entetes = { authorization: "Bearer " + ctx.token };

  async function appel(u, opts, essais) {
    let derniere;
    for (let i = 0; i <= (essais ?? 3); i++) {
      try {
        const r = await fetch(u, opts);
        if (r.status !== 429 && r.status < 500) return r;
        derniere = new Error("HTTP " + r.status);
      } catch (e) { derniere = e; }
      await new Promise(res => setTimeout(res, 120 * Math.pow(2, i)));
    }
    throw derniere;
  }

  return {
    async get(cle) {
      const r = await appel(url(cle).toString(), { headers: entetes });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("Blobs get " + r.status);
      const t = await r.text();
      if (!t) return null;
      try { return JSON.parse(t); } catch { return null; }
    },
    async lire(cle) {
      const r = await appel(url(cle).toString(), { headers: entetes });
      if (r.status === 404) return { val: null, etag: null };
      if (!r.ok) throw new Error("Blobs lire " + r.status);
      const t = await r.text();
      let val = null; try { val = t ? JSON.parse(t) : null; } catch {}
      return { val, etag: r.headers.get("etag") || null };
    },
    async ecrireSi(cle, val, etag) {
      const h = { ...entetes, "content-type": "application/json" };
      h["if-match"] = etag || '"__inexistant__"';
      if (!etag) { delete h["if-match"]; h["if-none-match"] = "*"; }
      const r = await appel(url(cle).toString(), { method: "PUT", headers: h, body: JSON.stringify(val) }, 0);
      if (r.status === 412) return { ok: false, etag: null };
      if (!r.ok) throw new Error("Blobs ecrireSi " + r.status);
      return { ok: true, etag: r.headers.get("etag") || null };
    },
    async set(cle, val) {
      const r = await appel(url(cle).toString(),
        { method: "PUT", headers: { ...entetes, "content-type": "application/json" }, body: JSON.stringify(val) });
      if (!r.ok) throw new Error("Blobs set " + r.status);
    },
    async del(cle) {
      const r = await appel(url(cle).toString(), { method: "DELETE", headers: entetes });
      if (!r.ok && r.status !== 404) throw new Error("Blobs del " + r.status);
    },
    async list(prefixe) {
      const cles = []; let curseur = null;
      for (let garde = 0; garde < 200; garde++) {
        const u = url("");
        if (prefixe) u.searchParams.set("prefix", prefixe);
        if (curseur) u.searchParams.set("cursor", curseur);
        const r = await appel(u.toString(), { headers: entetes });
        if (r.status === 404) break;
        if (!r.ok) throw new Error("Blobs list " + r.status);
        const p = await r.json();
        (p.blobs || []).forEach(b => { if (b && b.key) cles.push(b.key); });
        if (!p.next_cursor) break;
        curseur = p.next_cursor;
      }
      return cles;
    }
  };
}

/* ---------- l'interface commune ---------- */

export async function store(nom) {
  await init();
  const plein = "diggers-" + nom;

  if (mode === "sdk") {
    const s = getStoreFn({ name: plein, consistency: "strong" });
    return {
      get: cle => s.get(cle, { type: "json" }),
      set: (cle, val) => s.setJSON(cle, val).then(() => undefined),
      del: cle => s.delete(cle).then(() => undefined),
      list: async prefixe => ((await s.list({ prefix: prefixe || "" })).blobs || []).map(b => b.key),
      async lire(cle) {
        const r = await s.getWithMetadata(cle, { type: "json" });
        return r ? { val: r.data, etag: r.etag || null } : { val: null, etag: null };
      },
      async ecrireSi(cle, val, etag) {
        const o = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
        const r = await s.setJSON(cle, val, o);
        return { ok: r.modified !== false, etag: r.etag || null };
      }
    };
  }

  if (mode === "api") return clientApi(plein);

  const dossier = join(RACINE, nom);
  return {
    async get(cle) {
      try { return JSON.parse(await readFile(chemin(nom, cle), "utf8")); } catch { return null; }
    },
    async set(cle, val) { await poser(nom, cle, JSON.stringify(val)); },
    async del(cle) { try { await unlink(chemin(nom, cle)); } catch {} },
    async list(prefixe) {
      try {
        return (await readdir(dossier)).filter(x => x.endsWith(".json"))
          .map(x => decodeURIComponent(x.slice(0, -5)))
          .filter(k => !prefixe || k.startsWith(prefixe));
      } catch { return []; }
    },
    async lire(cle) {
      try {
        const t = await readFile(chemin(nom, cle), "utf8");
        return { val: JSON.parse(t), etag: empreinte(t) };
      } catch { return { val: null, etag: null }; }
    },
    ecrireSi(cle, val, etag) {
      return enFile(nom + "/" + cle, async () => {
        let actuel = null;
        try { actuel = empreinte(await readFile(chemin(nom, cle), "utf8")); } catch {}
        if ((etag || null) !== actuel) return { ok: false, etag: null };
        const t = JSON.stringify(val);
        await poser(nom, cle, t);
        return { ok: true, etag: empreinte(t) };
      });
    }
  };
}

/* ============================================================
   LA MISE À JOUR ATOMIQUE
   Le trou qu'elle bouche : lire une fiche, la modifier, la réécrire n'est
   pas une opération indivisible. Deux requêtes lancées à la même
   milliseconde lisent toutes les deux « 400 crédits » et écrivent toutes
   les deux « 300 » — deux cartons pour le prix d'un.
   Ici on relit, on transforme, et on n'écrit QUE si personne n'a bougé
   entre-temps. Sinon on recommence.

   À utiliser partout où l'on débite des crédits, ajoute une carte,
   vend une annonce ou crédite des jetons.
   ============================================================ */
export async function majAtomique(nomStore, cle, transformer, essais = 6) {
  const s = await store(nomStore);
  if (!s.lire || !s.ecrireSi) throw new Error("Ce rangement ne sait pas écrire sous condition.");
  for (let i = 0; i < essais; i++) {
    const { val, etag } = await s.lire(cle);
    const sortie = await transformer(val);
    if (sortie === undefined || sortie === null) return { ecrit: false, val, raison: "abandon" };
    const r = await s.ecrireSi(cle, sortie, etag);
    if (r.ok) return { ecrit: true, val: sortie, essais: i + 1 };
    await new Promise(r2 => setTimeout(r2, 20 + Math.floor(Math.random() * 60) * (i + 1)));
  }
  return { ecrit: false, raison: "trop de collisions" };
}

export async function modeStockage() { await init(); return mode; }
