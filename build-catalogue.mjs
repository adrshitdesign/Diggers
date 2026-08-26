#!/usr/bin/env node
/* ============================================================
   Diggers — construction du catalogue
   ------------------------------------------------------------
   À lancer UNE FOIS, depuis ton ordinateur :

       node build-catalogue.mjs

   Il interroge l'API iTunes, nettoie tout, et écrit catalogue.json
   à côté de lui. Tu déposes ce fichier avec index.html et le jeu
   s'en sert au lieu d'appeler Apple à chaque chargement.

   À relancer quand tu veux rafraîchir ou élargir le catalogue.
   ============================================================ */

import { writeFile } from "node:fs/promises";

/* Poids éditorial : 3 = tête d'affiche, 2 = installé, 1 = plus confidentiel.
   Il sert à ce que le titre le plus écouté d'un artiste de niche ne devienne
   pas automatiquement un « Tube » — sans lui, tous les artistes ont
   exactement la même distribution de rareté, ce qui n'a aucun sens. */
const ARTISTES = [
  // --- rap et pop urbaine FR ---
  ["Gims",3],["Ninho",3],["Jul",3],["SDM",3],["Keblack",3],["Hamza",2],["Damso",3],
  ["Aya Nakamura",3],["Tiakola",3],["Gazo",3],["Werenoi",2],["PLK",2],["Dadju",2],
  ["Booba",3],["Naps",2],["Franglish",2],["Niska",2],["Soso Maness",2],["Zola",2],
  ["Rim'K",2],["Sch",3],["Freeze Corleone",2],["Alpha Wann",1],["Nekfeu",3],
  ["Orelsan",3],["Lomepal",2],["Vald",2],["Laylow",2],["Josman",2],["Hatik",2],
  ["Tayc",2],["Dtf",1],["Leto",2],["Koba LaD",2],["Heuss L'Enfoiré",2],
  // --- pop et variété FR ---
  ["Stromae",3],["Angèle",3],["Clara Luciani",2],["Vianney",2],["Louane",2],
  ["Zaho de Sagazan",2],["Pomme",1],["Juliette Armanet",2],["Christine and the Queens",2],
  ["Eddy de Pretto",1],["Julien Doré",2],["Benjamin Biolay",1],["Camélia Jordana",1],
  ["-M-",1],["Yseult",1],["Voyou",1],["Terrenoire",1],
  // --- patrimoine FR ---
  ["Serge Gainsbourg",2],["Jacques Brel",2],["Édith Piaf",2],["Charles Aznavour",2],
  ["Francis Cabrel",2],["Jean-Jacques Goldman",2],["Michel Berger",2],["France Gall",2],
  ["Téléphone",2],["Indochine",2],["Noir Désir",2],["Alain Bashung",1],["Étienne Daho",1],
  ["Mylène Farmer",2],["Johnny Hallyday",2],["Renaud",2],["Véronique Sanson",1],
  ["Barbara",1],["Léo Ferré",1],["Georges Brassens",2],["Claude Nougaro",1],
  ["MC Solaar",2],["IAM",2],["Suprême NTM",2],["Assassin",1],["Oxmo Puccino",1],
  ["Diam's",2],["Sinik",1],["Rohff",2],["Sniper",1],["Lunatic",1],
  ["Daft Punk",3],["Justice",2],["Air",2],["Cassius",1],["Laurent Garnier",1],
  ["Gojira",1],["Superbus",1],["Louise Attaque",2],["Zebda",1],["Tryo",1],
  // --- international très écouté en France ---
  ["The Weeknd",3],["Dua Lipa",3],["Bruno Mars",3],["Ed Sheeran",3],["Billie Eilish",3],
  ["SZA",2],["Drake",3],["Rihanna",3],["Beyoncé",3],["Adele",3],["Coldplay",3],
  ["Eminem",3],["Kendrick Lamar",3],["Travis Scott",2],["Doja Cat",2],["Harry Styles",2],
  ["Taylor Swift",3],["Post Malone",2],["Miley Cyrus",2],["Lady Gaga",3],
  ["Michael Jackson",3],["Queen",3],["Nirvana",2],["Daft Punk",3],["Amy Winehouse",2],
  ["Bob Marley",3],["Stevie Wonder",2],["Prince",2],["David Bowie",2],["Pink Floyd",2],
  ["The Beatles",3],["Fleetwood Mac",2],["Radiohead",2],["Massive Attack",1],
  ["Portishead",1],["Björk",1],["Gorillaz",2],["The Strokes",1],["Arctic Monkeys",2],
  ["Lana Del Rey",2],["Tame Impala",1],["Aphex Twin",1],["Burial",1],
  ["Fela Kuti",1],["Youssou N'Dour",1],["Cesária Évora",1],["Manu Chao",2],
  ["Buena Vista Social Club",1],["Ibrahim Maalouf",1],["Nina Simone",2],
  ["Miles Davis",1],["John Coltrane",1],["Ella Fitzgerald",2],["Frank Sinatra",2],
  ["Donna Summer",2],["ABBA",3],["Bee Gees",2],["Earth, Wind & Fire",2],
  ["Charlotte Cardin",2],["Rosalía",2],["Bad Bunny",3],["Shakira",3],["Rosé",2]
];

const PAR_ARTISTE = 40;          /* on demande large, on jette beaucoup */
const GARDE_MAX   = 22;          /* et on garde au plus ça, une fois nettoyé */
const PAUSE_MS    = 350;         /* Apple limite à ~20 requêtes/minute */

/* Tout ce qui n'est pas l'enregistrement original du morceau. */
const REJET = /\b(karaoke|karaok[ée]|tribute|made famous|in the style of|originally performed|instrumental|backing track|cover version|hommage|sound-alike|as made popular)\b/i;
const REJET_TITRE = /\b(live|en concert|remix|edit|version|mix|acoustique|acoustic|d[ée]mo|interlude|intro|outro|skit|a cappella|sped up|slowed|reprise)\b/i;

const norm = s => (s||"")
  .toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g,"")
  .replace(/[’']/g,"'")
  .replace(/&/g," and ")
  .replace(/[^a-z0-9' ]+/g," ")
  .replace(/\s+/g," ").trim();

const titrePropre = t => (t||"")
  .replace(/\s*[\(\[][^)\]]*[\)\]]\s*$/,"")   /* (Remastered 2011), [Radio Edit]… */
  .replace(/\s*-\s*(remaster(ed)?|single version|radio edit).*$/i,"")
  .trim();

async function chercher(artiste){
  const url = "https://itunes.apple.com/search?term=" + encodeURIComponent(artiste)
    + "&entity=song&limit=" + PAR_ARTISTE + "&country=FR&lang=fr_fr";
  const r = await fetch(url, {headers:{"User-Agent":"Diggers/0.9 (build script)"}});
  if(!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.json();
  return d.results || [];
}

function nettoyer(artiste, poids, rows){
  const cible = norm(artiste);
  const vus = new Set();
  const gardes = [];

  for(const r of rows){
    if(!r.previewUrl || !r.artworkUrl100 || !r.trackName || !r.artistName) continue;

    /* 1. l'artiste renvoyé doit bien être celui qu'on cherchait.
          Sans ce test, des karaokés et des reprises entrent dans le jeu
          avec la bonne réponse absente des propositions. */
    const a = norm(r.artistName);
    if(a !== cible && !a.startsWith(cible + " ") && !a.includes(" " + cible + " ")
       && !(a.includes(cible) && a.length <= cible.length + 14)) continue;

    /* 2. ni karaoké, ni tribute, ni sound-alike */
    if(REJET.test(r.artistName) || REJET.test(r.trackName)
       || REJET.test(r.collectionName||"")) continue;

    /* 3. ni live, ni remix, ni version alternative */
    if(REJET_TITRE.test(r.trackName)) continue;

    const titre = titrePropre(r.trackName);
    if(!titre) continue;

    /* 4. déduplication interne à l'artiste */
    const cle = norm(titre);
    if(vus.has(cle)) continue;
    vus.add(cle);

    gardes.push({
      id: r.trackId,
      title: titre,
      artist: r.artistName,
      album: r.collectionName || "Sortie hors album",
      genre: r.primaryGenreName || "Non classé",
      year: r.releaseDate ? +r.releaseDate.slice(0,4) : null,
      ms: r.trackTimeMillis || 0,
      art: r.artworkUrl100.replace("100x100","400x400"),
      preview: r.previewUrl,
      /* Exigé par les conditions d'usage de l'API : un lien retour vers le morceau. */
      url: r.trackViewUrl || null,
      poids
    });
    if(gardes.length >= GARDE_MAX) break;
  }
  return gardes;
}

/* La popularité mêle le rang du titre chez son artiste et le poids de l'artiste.
   Sans le second terme, le titre le plus écouté d'un artiste confidentiel serait
   un « Tube » au même titre que celui de Gims, et chaque artiste produirait
   exactement la même distribution de rareté. */
function popularite(rang, total, poids){
  const rel = Math.pow(1 - rang/Math.max(total,2), 1.55);   /* 1 → 0 */
  const facteur = poids === 3 ? 1 : poids === 2 ? 0.82 : 0.62;
  return Math.max(2, Math.round(99 * rel * facteur));
}

const dodo = ms => new Promise(r => setTimeout(r, ms));

async function main(){
  const uniques = [...new Map(ARTISTES.map(a=>[a[0],a])).values()];
  console.log("Catalogue Diggers — " + uniques.length + " artistes à interroger\n");

  const global = new Set();
  const catalogue = [];
  let ko = 0;

  for(let i=0;i<uniques.length;i++){
    const [artiste, poids] = uniques[i];
    process.stdout.write(String(i+1).padStart(3," ") + "/" + uniques.length + "  " + artiste.padEnd(28," "));
    let rows = [];
    try{ rows = await chercher(artiste); }
    catch(e){ console.log("échec (" + e.message + ")"); ko++; await dodo(PAUSE_MS*3); continue; }

    const propres = nettoyer(artiste, poids, rows);
    let ajoutes = 0;
    propres.forEach((t, rang) => {
      /* 5. déduplication GLOBALE : sans elle, un même morceau récupéré sous
            deux artistes différents entre deux fois avec deux raretés. */
      const cle = norm(t.artist) + "|" + norm(t.title);
      if(global.has(cle)) return;
      global.add(cle);
      t.pop = popularite(rang, propres.length, poids);
      t.rank = rang + 1;
      catalogue.push(t);
      ajoutes++;
    });
    console.log(rows.length + " reçus → " + ajoutes + " gardés");
    await dodo(PAUSE_MS);
  }

  catalogue.sort((a,b)=>b.pop-a.pop);
  const meta = {
    version: 1,
    genere: new Date().toISOString().slice(0,10),
    source: "iTunes Search API, boutique FR",
    artistes: new Set(catalogue.map(c=>c.artist)).size,
    titres: catalogue.length
  };
  await writeFile("catalogue.json", JSON.stringify({meta, tracks:catalogue}), "utf8");

  const paliers = [88,72,55,35,15,0], noms = ["Tube","Classique","Titre d'album","Face B","Rareté","Pépite"];
  const compte = noms.map(()=>0);
  catalogue.forEach(c=>{ for(let i=0;i<paliers.length;i++) if(c.pop>=paliers[i]){ compte[i]++; break; } });

  console.log("\n──────────────────────────────────────────");
  console.log("catalogue.json écrit");
  console.log("  " + meta.titres + " titres · " + meta.artistes + " artistes"
    + (ko ? " · " + ko + " artiste(s) en échec" : ""));
  noms.forEach((n,i)=>console.log("  " + n.padEnd(15," ") + String(compte[i]).padStart(5," ") + " titres"));
  console.log("──────────────────────────────────────────");
  console.log("\ncatalogue.json est prêt, à côté de index.html.");
  console.log("Une fois le site en ligne : Modération → Bibliothèque → « Importer catalogue.json ».");
}

main().catch(e=>{ console.error("\nÉchec :", e); process.exit(1); });
