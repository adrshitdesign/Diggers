// /api/propositions — un joueur propose un son absent de la plateforme.

import { store } from "./_store.mjs";
import {
  ok, ko, preflight, corps, authentifier, validerTrack, nettoyerTrack,
  signature, uuid, jour, norm
} from "./_lib.mjs";
import { lire as lireBiblio, signatures as signaturesBiblio } from "./_biblio.mjs";

export const config = { path: "/api/propositions" };

export const MAX_EN_ATTENTE = 5;
export const MAX_PAR_JOUR = 10;

export default async function (req) {
  if (req.method === "OPTIONS") return preflight();

  /* Le fil public des dernières entrées validées : pas besoin de compte. */
  if (req.method === "GET") {
    const p = await store("propositions");
    const cles = await p.list("");
    const tout = (await Promise.all(cles.map(k => p.get(k)))).filter(Boolean);
    const validees = tout.filter(x => x.statut === "validee")
      .sort((a, b) => b.tranche - a.tranche).slice(0, 30)
      .map(x => ({ id: x.id, track: x.track, pop: x.pop, par: x.par.pseudo, le: x.tranche }));
    return ok({ recentes: validees, enAttente: tout.filter(x => x.statut === "en_attente").length });
  }

  if (req.method !== "POST") return ko(405, "méthode non autorisée");

  const b = await corps(req);
  const u = await authentifier(req);
  if (!u) return ko(401, "Il faut un compte pour proposer un son.");

  const P = await store("propositions");

  /* ---------------- mes propositions ---------------- */
  if (b.action === "miennes") {
    const ids = (u.mesProps || []).slice(-60).reverse();
    const l = (await Promise.all(ids.map(i => P.get(i)))).filter(Boolean);
    return ok({ propositions: l.map(x => ({
      id: x.id, statut: x.statut, track: x.track, motif: x.motif,
      cree: x.cree, tranche: x.tranche || null, pop: x.pop ?? null, note: x.note || ""
    })) , recompenses: (u.recompenses || []).filter(r => !r.pris) });
  }

  /* ---------------- réclamer les cartes gagnées ---------------- */
  if (b.action === "reclamer") {
    const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    let n = 0;
    (u.recompenses || []).forEach(r => { if (ids.includes(r.id) && !r.pris) { r.pris = true; n++; } });
    if (n) { const { ecrireUtilisateur } = await import("./_lib.mjs"); await ecrireUtilisateur(u); }
    return ok({ reclamees: n });
  }

  /* ---------------- proposer ---------------- */
  if (b.action === "creer") {
    const faute = validerTrack(b.track);
    if (faute) return ko(400, faute);

    const t = nettoyerTrack(b.track);
    const motif = String(b.motif || "").trim().slice(0, 240);
    if (motif.length < 10) return ko(400, "Dis en une phrase pourquoi ce son mérite une carte (10 signes minimum).");

    // quotas
    const j = jour();
    const q = u.quota || { jour: "", n: 0 };
    if (q.jour !== j) { q.jour = j; q.n = 0; }
    if (q.n >= MAX_PAR_JOUR) return ko(429, "Tu as atteint les " + MAX_PAR_JOUR + " propositions du jour. Reviens demain.");

    const miennes = (await Promise.all((u.mesProps || []).slice(-40).map(i => P.get(i)))).filter(Boolean);
    const attente = miennes.filter(x => x.statut === "en_attente").length;
    if (attente >= MAX_EN_ATTENTE)
      return ko(429, "Tu as déjà " + MAX_EN_ATTENTE + " propositions en attente. Laisse-nous les traiter d'abord.");

    // doublons : dans le catalogue communautaire, dans la file, et dans le noyau (signalé par le client)
    const SIG = await store("signatures");
    const sig = signature(t);
    if (signaturesBiblio(await lireBiblio()).has(sig))
      return ko(409, "Ce son est déjà dans la bibliothèque du jeu.", { statut: "validee" });
    const deja = await SIG.get(sig);
    if (deja) return ko(409, "Ce son est déjà sur la plateforme (ou déjà proposé).", { statut: deja.statut });

    const p = {
      id: uuid(), statut: "en_attente",
      par: { uid: u.uid, pseudo: u.pseudo },
      track: t, motif, cree: Date.now(),
      pop: null, tranche: null, note: "",
      indice: String(b.indice || "").trim().slice(0, 120)   // ce que le joueur propose comme indice
    };
    await P.set(p.id, p);
    await SIG.set(sig, { statut: "en_attente", prop: p.id });
    await (await store("file")).set("attente/" + p.cree + "-" + p.id, { id: p.id });

    u.mesProps = (u.mesProps || []).concat(p.id).slice(-200);
    u.quota = { jour: j, n: q.n + 1 };
    u.stats = u.stats || { propositions: 0, validees: 0, refusees: 0 };
    u.stats.propositions++;
    const { ecrireUtilisateur } = await import("./_lib.mjs");
    await ecrireUtilisateur(u);

    return ok({ id: p.id, statut: p.statut, restantes: MAX_PAR_JOUR - u.quota.n });
  }

  /* ---------------- le client signale un doublon du noyau ---------------- */
  if (b.action === "verifier") {
    const t = b.track || {};
    const sig = norm(t.artist) + "|" + norm(t.title);
    if (signaturesBiblio(await lireBiblio()).has(sig)) return ok({ connu: true, statut: "validee" });
    const deja = await (await store("signatures")).get(sig);
    return ok({ connu: !!deja, statut: deja ? deja.statut : null });
  }

  return ko(400, "Action inconnue.");
}
