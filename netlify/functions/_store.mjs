// Couche de rangement. Trois dos possibles, essayés dans cet ordre :
//   1. le paquet @netlify/blobs, s'il est installé (déploiement Git ou CLI) ;
//   2. l'API Blobs en direct, sans aucune dépendance (déploiement par glisser-déposer) ;
//   3. des fichiers JSON en local, pour développer et tester hors ligne.
// Le reste du code ne voit pas la différence.

import { mkdir, readFile, writeFile, unlink, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

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
      list: async prefixe => ((await s.list({ prefix: prefixe || "" })).blobs || []).map(b => b.key)
    };
  }

  if (mode === "api") return clientApi(plein);

  const dossier = join(RACINE, nom);
  return {
    async get(cle) {
      try { return JSON.parse(await readFile(chemin(nom, cle), "utf8")); } catch { return null; }
    },
    async set(cle, val) {
      await mkdir(dirname(chemin(nom, cle)), { recursive: true });
      await writeFile(chemin(nom, cle), JSON.stringify(val));
    },
    async del(cle) { try { await unlink(chemin(nom, cle)); } catch {} },
    async list(prefixe) {
      try {
        return (await readdir(dossier)).filter(x => x.endsWith(".json"))
          .map(x => decodeURIComponent(x.slice(0, -5)))
          .filter(k => !prefixe || k.startsWith(prefixe));
      } catch { return []; }
    }
  };
}

export async function modeStockage() { await init(); return mode; }
