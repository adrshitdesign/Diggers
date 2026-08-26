// Serveur de développement : les mêmes fonctions qu'en production, mais en local,
// avec les données rangées dans .data/ au lieu de Netlify Blobs.
//
//   node dev-serveur.mjs        puis  http://localhost:8888
//
// Aucune dépendance à installer.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

process.env.DIGGERS_STORE ||= "fichiers";
process.env.DIGGERS_SECRET ||= "secret-de-developpement-a-ne-pas-utiliser-en-ligne";
process.env.DIGGERS_ADMIN ||= "admin-local";

const PORT = Number(process.env.PORT || 8888);
const RACINE = process.cwd();

const ROUTES = {};
for (const f of ["compte", "propositions", "moderation", "catalogue", "classement", "crews"]) {
  const m = await import("./netlify/functions/" + f + ".mjs");
  ROUTES[(m.config && m.config.path) || "/api/" + f] = m.default;
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json",
  ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8" };

createServer(async (req, res) => {
  const u = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const fn = ROUTES[u.pathname];

  if (fn) {
    const morceaux = [];
    for await (const c of req) morceaux.push(c);
    const requete = new Request(u.toString(), {
      method: req.method,
      headers: req.headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(morceaux)
    });
    let rep;
    try { rep = await fn(requete); }
    catch (e) {
      console.error(u.pathname, e);
      rep = new Response(JSON.stringify({ erreur: "Panne du serveur : " + e.message }),
        { status: 500, headers: { "content-type": "application/json" } });
    }
    res.writeHead(rep.status, Object.fromEntries(rep.headers));
    res.end(rep.body ? Buffer.from(await rep.arrayBuffer()) : null);
    return;
  }

  let p = normalize(join(RACINE, u.pathname === "/" ? "/index.html" : u.pathname));
  if (!p.startsWith(RACINE)) { res.writeHead(403); return res.end("non"); }
  try {
    await stat(p);
    res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream",
      "cache-control": "no-store" });
    res.end(await readFile(p));
  } catch { res.writeHead(404, { "content-type": "text/plain" }); res.end("introuvable"); }
}).listen(PORT, () => {
  console.log("Diggers en local  →  http://localhost:" + PORT);
  console.log("Clé d'administration : " + process.env.DIGGERS_ADMIN);
});
