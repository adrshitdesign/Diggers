// Vérifie le client Blobs sans dépendance (le chemin utilisé quand on déploie
// par glisser-déposer, sans npm install) contre un faux serveur Netlify.
//   node test-blobs.mjs

import { createServer } from "node:http";

const DONNEES = new Map();     // "site:diggers-x/cle" -> corps
let vus = [];

const faux = createServer(async (req, res) => {
  if (req.headers.authorization !== "Bearer jeton-test") { res.writeHead(401); return res.end(); }
  const u = new URL(req.url, "http://x");
  const seg = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const site = seg.shift();
  if (site !== "site-42") { res.writeHead(404); return res.end(); }
  const store = seg.shift();
  const cle = seg.join("/");
  vus.push(req.method + " " + u.pathname + (u.search || ""));

  if (req.method === "GET" && !cle) {
    const prefixe = u.searchParams.get("prefix") || "";
    const curseur = Number(u.searchParams.get("cursor") || 0);
    const toutes = [...DONNEES.keys()].filter(k => k.startsWith(store + "/"))
      .map(k => k.slice(store.length + 1)).filter(k => k.startsWith(prefixe)).sort();
    const page = toutes.slice(curseur, curseur + 2);           // pagination serrée exprès
    const suite = curseur + 2 < toutes.length ? String(curseur + 2) : undefined;
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ blobs: page.map(k => ({ key: k, size: 1 })), ...(suite ? { next_cursor: suite } : {}) }));
  }
  if (req.method === "GET") {
    const v = DONNEES.get(store + "/" + cle);
    if (v === undefined) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": "application/json" }); return res.end(v);
  }
  if (req.method === "PUT") {
    const m = []; for await (const c of req) m.push(c);
    DONNEES.set(store + "/" + cle, Buffer.concat(m).toString("utf8"));
    res.writeHead(200); return res.end();
  }
  if (req.method === "DELETE") { DONNEES.delete(store + "/" + cle); res.writeHead(200); return res.end(); }
  res.writeHead(405); res.end();
});
await new Promise(r => faux.listen(0, r));
const base = "http://127.0.0.1:" + faux.address().port;

process.env.DIGGERS_STORE = "api";
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({
  siteID: "site-42", token: "jeton-test", edgeURL: base, uncachedEdgeURL: base
})).toString("base64");

const { store, modeStockage } = await import("./netlify/functions/_store.mjs");
let ko = 0, n = 0;
const R = (nom, v) => { n++; if (!v) ko++; console.log((v ? "  ok    " : "  ÉCHEC ") + nom); };

R("le mode API est bien choisi", (await modeStockage()) === "api");
const s = await store("essai");
R("une clé absente rend null", (await s.get("rien")) === null);
await s.set("a", { x: 1, txt: "Sœur K — Nuit blanche" });
R("ce qui est écrit se relit", JSON.stringify(await s.get("a")) === JSON.stringify({ x: 1, txt: "Sœur K — Nuit blanche" }));
await s.set("attente/1700-aaa", { id: "aaa" });
await s.set("attente/1701-bbb", { id: "bbb" });
await s.set("attente/1702-ccc", { id: "ccc" });
await s.set("autre/zzz", { id: "zzz" });
const l = await s.list("attente/");
R("la liste par préfixe traverse les pages", l.length === 3 && l.join(",") === "attente/1700-aaa,attente/1701-bbb,attente/1702-ccc");
R("les clés hors préfixe sont écartées", !l.includes("autre/zzz"));
await s.del("attente/1701-bbb");
R("la suppression prend effet", (await s.list("attente/")).length === 2);
R("le nom du magasin est préfixé site:", vus.some(v => v.includes("site%3Adiggers-essai")));
await s.set("clé accentuée/é&?", { ok: true });
R("une clé avec accents et signes passe", (await s.get("clé accentuée/é&?")).ok === true);

console.log("\n" + (ko ? ko + " ÉCHEC(S) sur " + n : n + " vérifications, aucune erreur"));
faux.close();
process.exit(ko ? 1 : 0);
