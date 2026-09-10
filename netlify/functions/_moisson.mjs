// LA MOISSONNEUSE — remplir la bibliothèque sans laisser un onglet ouvert.
//
// Le problème qu'elle résout : jusqu'ici, tout ce qui entrait dans la
// bibliothèque passait par le NAVIGATEUR de l'administrateur. Apple n'envoie
// pas d'en-têtes CORS, il fallait donc du JSONP, une page ouverte, et la
// patience de quelqu'un devant l'écran. Résultat : quinze mille morceaux au
// bout de plusieurs semaines, et chaque ajout coûtait une session.
//
// Depuis le serveur, rien de tout ça : un `fetch` normal, pas de CORS, pas
// d'onglet. La moissonneuse avance par petits tours, garde sa place, et peut
// être réveillée aussi bien par une tâche planifiée que par un écran d'admin.
//
// DEUX SOURCES, DANS CET ORDRE — et l'ordre n'est pas anodin :
//
//   1. LES DISCOGRAPHIES. Chaque morceau du jeu porte l'identifiant Apple de
//      son artiste (v2.7.4). On peut donc demander à Apple TOUS les titres de
//      cet artiste : « lookup?id=<artiste>&entity=song ». C'est la source la
//      plus rentable et la plus sûre — deux mille artistes déjà présents, deux
//      cents titres possibles chacun. Et c'est propre par construction : ce
//      sont les vrais morceaux du vrai artiste, pas le résultat d'une
//      recherche floue sur un nom.
//
//   2. LES GRAINES. Une fois les discographies épuisées, on élargit : des
//      recherches « genre + année » qui font entrer des noms que personne
//      n'avait encore. C'est moins sûr — une recherche par mots rend ce
//      qu'elle veut — donc ça passe par les mêmes garde-fous que le reste, et
//      ça vient APRÈS.
//
// Elle ne se presse jamais : Apple limite le débit, et se faire jeter coûte
// plus cher que d'attendre.

import { store } from "./_store.mjs";
import * as biblio from "./_biblio.mjs";

const CLE = "etat";
const PANIER = "panier";
/* ON N'ÉCRIT PAS LA BIBLIOTHÈQUE À CHAQUE TOUR.
   Elle vit dans un seul objet : la réécrire, c'est réécrire vingt-sept méga-
   octets. Une fois par minute pendant une nuit, ça fait des gigaoctets pour
   quelques centaines de morceaux. La récolte s'accumule donc dans un panier —
   petit, écrit vite — et ne rejoint la bibliothèque que lorsqu'il est plein,
   ou quand la moisson s'arrête. */
export let SEUIL_PANIER = 2500;
export const reglerSeuil = n => { SEUIL_PANIER = Math.max(1, n | 0); };
const PAUSE = 1200;             // entre deux appels à Apple, dans un même tour
const PAR_ARTISTE = 200;        // le maximum qu'Apple accepte de rendre

/* Les graines : ce qu'on cherche quand les discographies sont épuisées. Le
   croisement genre × période donne des milliers de requêtes distinctes, et
   c'est ce qui permet d'aller chercher autre chose que les têtes d'affiche. */
const GENRES_GRAINES = [
  "rap français", "rap", "hip-hop", "trap", "drill", "afrobeats", "afro",
  "rnb", "soul", "funk", "disco", "house", "techno", "électro", "ambient",
  "jazz", "blues", "reggae", "dancehall", "rock", "punk", "métal", "indie",
  "pop", "variété française", "chanson française", "zouk", "raï", "salsa",
  "cumbia", "bossa nova", "gospel", "country", "folk", "classique", "musique de film",
  "kompa", "coupé-décalé", "dub", "garage", "jungle", "drum and bass",
  "lo-fi", "shoegaze", "new wave", "synthpop", "cold wave", "italo disco"
];
const PERIODES = ["1970", "1975", "1980", "1985", "1990", "1995",
  "2000", "2005", "2010", "2015", "2018", "2020", "2022", "2024"];

export function grainesToutes() {
  const out = [];
  for (const g of GENRES_GRAINES) for (const p of PERIODES) out.push(g + " " + p);
  return out;
}

const neuf = () => ({
  actif: false, phase: "artistes",
  file: [], curseur: 0,
  graine: 0,
  ajoutes: 0, vus: 0, requetes: 0, refuses: 0, enAttente: 0,
  erreurs: 0, dernierEchec: "",
  demarre: 0, dernier: 0, message: "Jamais lancée."
});

export async function lireEtat() {
  const s = await store("moisson");
  const e = await s.get(CLE);
  return e && typeof e === "object" ? { ...neuf(), ...e } : neuf();
}

export async function ecrireEtat(e) {
  await (await store("moisson")).set(CLE, e);
  return e;
}

/* La file de départ : tous les identifiants d'artistes présents dans la
   bibliothèque, chacun une fois. Un artiste sans identifiant ne peut pas être
   moissonné — c'est exactement ce que la vérification chez Apple répare. */
export async function construireFile() {
  const lib = await biblio.lire();
  const vus = new Set();
  for (const t of lib.tracks) {
    const a = t.artistId ? String(t.artistId) : null;
    if (a && !vus.has(a)) vus.add(a);
  }
  return [...vus];
}

const dodo = ms => new Promise(r => setTimeout(r, ms));

async function apple(url) {
  const r = await fetch(url, {
    headers: { "user-agent": "Diggers/1.0 (jeu de cartes musical)" },
    signal: AbortSignal.timeout(8000)
  });
  if (r.status === 403 || r.status === 429) throw new Error("debit");
  if (!r.ok) throw new Error("http " + r.status);
  return await r.json();
}

/* Ce qu'Apple rend n'entre jamais tel quel : on ne garde que ce qui est
   jouable — un extrait, une pochette, un titre, un artiste — et la
   bibliothèque applique ensuite ses propres règles (premier crédité,
   doublons, plafond). */
const REJET = /(karaok|tribute|made famous|instrumental version|cover version|as made popular)/i;

export function fabriquer(r) {
  if (!r || r.wrapperType !== "track" || r.kind !== "song") return null;
  if (!r.previewUrl || !r.artworkUrl100 || !r.trackName || !r.artistName) return null;
  if (REJET.test(r.artistName) || REJET.test(r.trackName) || REJET.test(r.collectionName || "")) return null;
  return {
    id: r.trackId,
    title: String(r.trackName).slice(0, 160),
    artist: String(r.artistName).slice(0, 120),
    artistId: r.artistId || null,
    album: r.collectionName || "Sortie hors album",
    genre: r.primaryGenreName || "Non classé",
    year: r.releaseDate ? +String(r.releaseDate).slice(0, 4) : null,
    ms: r.trackTimeMillis || 0,
    art: String(r.artworkUrl100).replace("100x100", "400x400"),
    preview: r.previewUrl,
    url: r.trackViewUrl || null,
    /* La popularité décide du palier de rareté. Apple ne la donne pas : on
       part du rang dans la discographie de l'artiste, ce qui approche bien
       « ce que tout le monde connaît de lui ». Le vrai chiffre d'écoutes se
       relève ensuite, artiste par artiste, avec l'outil dédié. */
    pop: 50
  };
}

/* Le rang dans la discographie donne une popularité plausible : le premier
   titre rendu par Apple est le plus écouté, le dernier le plus confidentiel.
   Sans ça, tout entrerait au même palier et les cartons n'auraient plus de
   raretés. */
function popParRang(i, n) {
  if (n <= 1) return 70;
  const p = 1 - i / (n - 1);
  return Math.round(8 + p * 88);
}

/* ---------------------------------------------------------------- un tour */
/* Un tour fait quelques requêtes, puis rend la main. Court exprès : une
   fonction Netlify a dix secondes, et une moisson qui dépasse est une moisson
   qui perd tout son lot. On revient aussi souvent qu'on veut. */
export async function unTour(n = 3) {
  const e = await lireEtat();
  if (!e.actif) return { ...e, fait: 0, note: "en pause" };

  const lib = await biblio.lire();
  if (lib.tracks.length >= biblio.PLAFOND) {
    e.actif = false;
    e.message = "Bibliothèque pleine (" + biblio.PLAFOND + ") — moisson arrêtée.";
    return await ecrireEtat(e);
  }

  let fait = 0;
  const recolte = [];

  for (let i = 0; i < n; i++) {
    if (e.phase === "artistes" && e.curseur >= e.file.length) e.phase = "graines";
    if (e.phase === "graines" && e.graine >= grainesToutes().length) {
      e.actif = false;
      e.message = "Tout a été moissonné. Relance pour repartir des discographies.";
      break;
    }

    let url, quoi;
    if (e.phase === "artistes") {
      const aid = e.file[e.curseur];
      quoi = "artiste " + aid;
      url = "https://itunes.apple.com/lookup?country=FR&lang=fr_fr&id=" + encodeURIComponent(aid)
        + "&entity=song&limit=" + PAR_ARTISTE;
    } else {
      const g = grainesToutes()[e.graine];
      quoi = "graine « " + g + " »";
      url = "https://itunes.apple.com/search?country=FR&lang=fr_fr&entity=song&limit=200&term="
        + encodeURIComponent(g);
    }

    let d = null;
    try {
      d = await apple(url);
      e.erreurs = 0;
    } catch (err) {
      e.erreurs++;
      e.dernierEchec = String(err.message || err) + " sur " + quoi;
      /* Apple nous freine : on s'arrête là pour ce tour. Le curseur ne bouge
         pas, on refera le même au prochain réveil. Après plusieurs tours
         infructueux, on se met en pause pour ne pas cogner dans le mur. */
      if (e.erreurs >= 8) {
        e.actif = false;
        e.message = "Apple refuse depuis " + e.erreurs + " tours — mise en pause. Relance plus tard.";
      } else {
        e.message = "Apple n'a pas répondu (" + e.erreurs + ") — on réessaiera.";
      }
      break;
    }

    const rows = (d && d.results) || [];
    const pistes = rows.filter(r => r.wrapperType === "track");
    pistes.forEach((r, k) => {
      const t = fabriquer(r);
      if (!t) return;
      if (e.phase === "artistes") t.pop = popParRang(k, pistes.length);
      recolte.push(t);
    });

    e.vus += pistes.length;
    e.requetes++;
    fait++;
    if (e.phase === "artistes") e.curseur++; else e.graine++;

    if (i < n - 1) await dodo(PAUSE);
  }

  if (recolte.length) {
    const s = await store("moisson");
    const panier = (await s.get(PANIER)) || { tracks: [] };
    panier.tracks = panier.tracks.concat(recolte);
    await s.set(PANIER, panier);
    e.enAttente = panier.tracks.length;
    if (e.actif) {
      e.message = e.phase === "artistes"
        ? "Discographies : " + e.curseur + " / " + e.file.length + " artistes."
        : "Élargissement : " + e.graine + " / " + grainesToutes().length + " graines.";
    }
  }
  /* On verse le panier quand il est plein, ou dès que la moisson s'arrête —
     sinon la récolte de la dernière heure resterait en rade. */
  if ((e.enAttente || 0) >= SEUIL_PANIER || !e.actif) Object.assign(e, await verser(e));
  e.dernier = Date.now();
  await ecrireEtat(e);
  return { ...e, fait, recoltes: recolte.length };
}

/* Verser le panier dans la bibliothèque. C'est le seul moment où l'on paie
   une écriture complète. */
export async function verser(e) {
  const s = await store("moisson");
  const panier = (await s.get(PANIER)) || { tracks: [] };
  if (!panier.tracks.length) return { enAttente: 0 };
  const r = await biblio.importer(panier.tracks);
  await s.set(PANIER, { tracks: [] });
  return {
    enAttente: 0,
    ajoutes: (e.ajoutes || 0) + r.ajoutes,
    refuses: (e.refuses || 0) + r.refuses
  };
}

export async function demarrer(refaire) {
  const e = await lireEtat();
  const file = await construireFile();
  const suite = {
    ...neuf(),
    actif: true,
    file,
    phase: file.length ? "artistes" : "graines",
    demarre: Date.now(),
    message: file.length
      ? file.length + " artistes à moissonner."
      : "Aucun artiste identifié : on commence par élargir. Lance d'abord « Vérifier les artistes chez Apple » pour de meilleurs résultats."
  };
  /* Reprendre garde les compteurs et la place ; refaire repart de zéro. */
  if (!refaire && e.file.length && e.curseur < e.file.length) {
    return await ecrireEtat({ ...e, actif: true, message: "Reprise là où on s'était arrêté." });
  }
  return await ecrireEtat(suite);
}

export async function arreter() {
  const e = await lireEtat();
  const verse = await verser(e);
  return await ecrireEtat({ ...e, ...verse, actif: false,
    message: "En pause." + (verse.ajoutes != null ? " Récolte en attente versée." : "") });
}
