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
  ["Gims", 3],["Ninho", 3],["Jul", 3],["SDM", 3],["Keblack", 3],["Hamza", 2],["Damso", 3],
  ["Aya Nakamura", 3],["Tiakola", 3],["Gazo", 3],["Werenoi", 2],["PLK", 2],["Dadju", 2],
  ["Booba", 3],["Naps", 2],["Franglish", 2],["Niska", 2],["Soso Maness", 2],["Zola", 2],
  ["Rim'K", 2],["Sch", 3],["Freeze Corleone", 2],["Alpha Wann", 1],["Nekfeu", 3],["Orelsan", 3],
  ["Lomepal", 2],["Vald", 2],["Laylow", 2],["Josman", 2],["Hatik", 2],["Tayc", 2],["Dtf", 1],
  ["Leto", 2],["Koba LaD", 2],["Heuss L'Enfoiré", 2],["Stromae", 3],["Angèle", 3],
  ["Clara Luciani", 2],["Vianney", 2],["Louane", 2],["Zaho de Sagazan", 2],["Pomme", 1],
  ["Juliette Armanet", 2],["Christine and the Queens", 2],["Eddy de Pretto", 1],
  ["Julien Doré", 2],["Benjamin Biolay", 1],["Camélia Jordana", 1],["-M-", 1],["Yseult", 1],
  ["Voyou", 1],["Terrenoire", 1],["Serge Gainsbourg", 2],["Jacques Brel", 2],["Édith Piaf", 2],
  ["Charles Aznavour", 2],["Francis Cabrel", 2],["Jean-Jacques Goldman", 2],
  ["Michel Berger", 2],["France Gall", 2],["Téléphone", 2],["Indochine", 2],["Noir Désir", 2],
  ["Alain Bashung", 1],["Étienne Daho", 1],["Mylène Farmer", 2],["Johnny Hallyday", 2],
  ["Renaud", 2],["Véronique Sanson", 1],["Barbara", 1],["Léo Ferré", 1],["Georges Brassens", 2],
  ["Claude Nougaro", 1],["MC Solaar", 2],["IAM", 2],["Suprême NTM", 2],["Assassin", 1],
  ["Oxmo Puccino", 1],["Diam's", 2],["Sinik", 1],["Rohff", 2],["Sniper", 1],["Lunatic", 1],
  ["Daft Punk", 3],["Justice", 2],["Air", 2],["Cassius", 1],["Laurent Garnier", 1],
  ["Gojira", 1],["Superbus", 1],["Louise Attaque", 2],["Zebda", 1],["Tryo", 1],
  ["The Weeknd", 3],["Dua Lipa", 3],["Bruno Mars", 3],["Ed Sheeran", 3],["Billie Eilish", 3],
  ["SZA", 2],["Drake", 3],["Rihanna", 3],["Beyoncé", 3],["Adele", 3],["Coldplay", 3],
  ["Eminem", 3],["Kendrick Lamar", 3],["Travis Scott", 2],["Doja Cat", 2],["Harry Styles", 2],
  ["Taylor Swift", 3],["Post Malone", 2],["Miley Cyrus", 2],["Lady Gaga", 3],
  ["Michael Jackson", 3],["Queen", 3],["Nirvana", 2],["Amy Winehouse", 2],["Bob Marley", 3],
  ["Stevie Wonder", 2],["Prince", 2],["David Bowie", 2],["Pink Floyd", 2],["The Beatles", 3],
  ["Fleetwood Mac", 2],["Radiohead", 2],["Massive Attack", 1],["Portishead", 1],["Björk", 1],
  ["Gorillaz", 2],["The Strokes", 1],["Arctic Monkeys", 2],["Lana Del Rey", 2],
  ["Tame Impala", 1],["Aphex Twin", 1],["Burial", 1],["Fela Kuti", 1],["Youssou N'Dour", 1],
  ["Cesária Évora", 1],["Manu Chao", 2],["Buena Vista Social Club", 1],["Ibrahim Maalouf", 1],
  ["Nina Simone", 2],["Miles Davis", 1],["John Coltrane", 1],["Ella Fitzgerald", 2],
  ["Frank Sinatra", 2],["Donna Summer", 2],["ABBA", 3],["Bee Gees", 2],
  ["Earth, Wind & Fire", 2],["Charlotte Cardin", 2],["Rosalía", 2],["Bad Bunny", 3],
  ["Shakira", 3],["Rosé", 2],["Lacrim", 2],["Kaaris", 2],["Maes", 2],["Timal", 2],["Da Uzi", 1],
  ["Guy2Bezbar", 1],["Bosh", 2],["Lartiste", 2],["Sofiane", 2],["Kalash Criminel", 2],
  ["Youssoupha", 2],["Disiz", 1],["Kery James", 2],["Médine", 1],["L'Algérino", 2],["Dinos", 2],
  ["Népal", 1],["Isha", 1],["Roméo Elvis", 2],["Lous and the Yakuza", 1],["Shay", 1],
  ["Chilla", 1],["Meryl", 2],["Ronisia", 2],["Wejdene", 2],["Eva", 2],["Marwa Loud", 2],
  ["Imen Es", 2],["Naza", 2],["Landy", 1],["Kekra", 1],["Deen Burbigo", 1],["S.Pri Noir", 1],
  ["Sneazzy", 1],["Lujipeka", 1],["Luidji", 1],["Prince Waly", 1],["Jazzy Bazz", 1],
  ["Squidji", 1],["Winnterzuko", 1],["Ashe 22", 1],["Zuukou Mayzie", 1],["Slimka", 1],
  ["Di-Meh", 1],["Makala", 1],["La Fève", 1],["Zamdane", 1],["Green Montana", 1],["Bolémvn", 1],
  ["Hornet La Frappe", 1],["Ziak", 2],["Gambi", 1],["Sadek", 1],["Lefa", 1],["Alonzo", 2],
  ["Elams", 1],["Le Rat Luciano", 1],["Fonky Family", 1],["Akhenaton", 1],["Shurik'n", 1],
  ["Psy 4 de la Rime", 1],["Soprano", 2],["Keny Arkana", 1],["Bigflo & Oli", 2],
  ["Columbine", 1],["Georgio", 1],["Lorenzo", 2],["Vegedream", 2],["Black M", 2],
  ["Sexion d'Assaut", 2],["Mac Tyer", 1],["Hugo TSR", 1],["Rilès", 1],["Bekar", 1],
  ["Jorrdee", 1],["Ichon", 1],["Muddy Monk", 1],["Myth Syzer", 1],["Alpha 5.20", 1],["Ali", 1],
  ["Casey", 1],["La Rumeur", 1],["Scylla", 1],["Caballero & JeanJass", 1],["Krisy", 1],
  ["Tsew The Kid", 1],["Doums", 1],["Nemir", 1],["Fixpen Sill", 1],["Loveni", 1],["Zinée", 1],
  ["Le Motif", 1],["Tif", 1],["Rounhaa", 1],["Khali", 1],["J9ueve", 1],["Nahir", 1],
  ["So La Lune", 1],["Zeg P", 1],["Favé", 2],["Jolagreen23", 1],["Kerchak", 1],["Hoshi", 2],
  ["Aloïse Sauvage", 1],["Suzane", 1],["Feu! Chatterton", 1],["La Femme", 1],["Fishbach", 1],
  ["Odezenne", 1],["Thérapie Taxi", 1],["Videoclub", 1],["Malik Djoudi", 1],
  ["Flavien Berger", 1],["Bagarre", 1],["Structures", 1],["November Ultra", 1],
  ["Léonie Pernet", 1],["Adé", 1],["Vendredi sur Mer", 1],["Petit Biscuit", 1],["Fakear", 1],
  ["Rone", 1],["Superpoze", 1],["Møme", 1],["Kavinsky", 1],["Breakbot", 1],["Yuksek", 1],
  ["Étienne de Crécy", 1],["Vitalic", 1],["Agar Agar", 1],["Polo & Pan", 2],
  ["L'Impératrice", 2],["Parcels", 1],["Phoenix", 2],["Sébastien Tellier", 1],
  ["Alex Gopher", 1],["Modjo", 2],["Stardust", 1],["Bob Sinclar", 2],["David Guetta", 3],
  ["Martin Solveig", 2],["DJ Snake", 3],["Gesaffelstein", 1],["The Blaze", 1],
  ["Vanessa Paradis", 2],["Alain Souchon", 2],["Laurent Voulzy", 1],["Michel Polnareff", 2],
  ["Serge Reggiani", 1],["Jacques Dutronc", 2],["Françoise Hardy", 2],["Nino Ferrer", 1],
  ["Michel Jonasz", 1],["Julien Clerc", 2],["Maxime Le Forestier", 1],["Yves Montand", 1],
  ["Charles Trenet", 1],["Jacques Higelin", 1],["Bernard Lavilliers", 1],["Alain Chamfort", 1],
  ["Christophe", 2],["Daniel Balavoine", 2],["Jean Ferrat", 1],["Anne Sylvestre", 1],
  ["Juliette Gréco", 1],["Dalida", 2],["Sylvie Vartan", 1],["Claude François", 2],
  ["Serge Lama", 1],["Michel Sardou", 2],["Eddy Mitchell", 2],["Trust", 1],["Bérurier Noir", 1],
  ["Mano Negra", 2],["Les Négresses Vertes", 1],["Les Rita Mitsouko", 2],["Dionysos", 1],
  ["Saez", 1],["Cali", 1],["Miossec", 1],["Dominique A", 1],["Arthur H", 1],["Camille", 1],
  ["Emily Loizeau", 1],["Keren Ann", 1],["Carla Bruni", 1],["Vincent Delerm", 1],["Bénabar", 1],
  ["Grand Corps Malade", 2],["Fauve", 1],["Salut c'est cool", 1],["J. Cole", 2],
  ["Tyler, The Creator", 2],["Frank Ocean", 2],["A$AP Rocky", 2],["Playboi Carti", 2],
  ["21 Savage", 2],["Metro Boomin", 2],["Future", 2],["Lil Baby", 2],["Gunna", 2],
  ["Cardi B", 2],["Nicki Minaj", 3],["Megan Thee Stallion", 2],["Ice Spice", 1],
  ["Central Cee", 2],["Dave", 2],["Stormzy", 2],["Skepta", 1],["Little Simz", 1],
  ["Burna Boy", 2],["Wizkid", 2],["Davido", 2],["Rema", 2],["Tems", 1],["Asake", 1],
  ["Fally Ipupa", 2],["Koffi Olomidé", 1],["Karol G", 2],["J Balvin", 2],["Peso Pluma", 2],
  ["Feid", 2],["Anitta", 2],["Sfera Ebbasta", 1],["Ghali", 1],["Måneskin", 2],["Mahmood", 1],
  ["Olivia Rodrigo", 3],["Sabrina Carpenter", 2],["Chappell Roan", 2],["Charli XCX", 2],
  ["FKA twigs", 1],["James Blake", 1],["Bon Iver", 2],["Sufjan Stevens", 1],["The National", 1],
  ["Fontaines D.C.", 1],["Idles", 1],["Wet Leg", 1],["Alvvays", 1],["Beach House", 1],
  ["Mac DeMarco", 1],["King Krule", 1],["Sampha", 1],["Kaytranada", 2],["Thundercat", 1],
  ["Anderson .Paak", 2],["Kali Uchis", 2],["Steve Lacy", 2],["Solange", 1],["Erykah Badu", 1],
  ["D'Angelo", 1],["Marvin Gaye", 2],["Curtis Mayfield", 1],["Otis Redding", 2],
  ["Aretha Franklin", 2],["Sam Cooke", 2],["Ray Charles", 2],["James Brown", 2],
  ["Sly and the Family Stone", 1],["Funkadelic", 1],["Parliament", 1],["Chic", 2],
  ["Kool & The Gang", 2],["The Isley Brothers", 1],["Al Green", 1],["Bill Withers", 2],
  ["Roy Ayers", 1],["Herbie Hancock", 1],["Alice Coltrane", 1],["Sun Ra", 1],
  ["Pharoah Sanders", 1],["Charles Mingus", 1],["Thelonious Monk", 1],["Bill Evans", 1],
  ["Chet Baker", 1],["Billie Holiday", 2],["Sarah Vaughan", 1],["Tony Allen", 1],
  ["Ali Farka Touré", 1],["Amadou & Mariam", 1],["Tinariwen", 1],["Rachid Taha", 1],
  ["Souad Massi", 1],["Idir", 1],["Khaled", 2],["Cheb Mami", 1],["Warda", 1],["Fairuz", 1],
  ["Oum Kalthoum", 1],["Alpha Blondy", 1],["Tiken Jah Fakoly", 1],["Magic System", 2],
  ["Angélique Kidjo", 1],["Caetano Veloso", 1],["Gilberto Gil", 1],["João Gilberto", 1],
  ["Tom Jobim", 1],["Jorge Ben Jor", 1],["Seu Jorge", 1],["Astrud Gilberto", 1],
  ["Stan Getz", 1],["Compay Segundo", 1],["Celia Cruz", 1],["Héctor Lavoe", 1],
  ["Willie Colón", 1]
];

const PAR_ARTISTE = 200;         /* le maximum qu'Apple accepte par appel */
const GARDE_MAX   = 35;          /* et on garde au plus ça, une fois nettoyé */
/* Apple tolère une vingtaine d'appels par minute. Le commentaire le disait
   déjà, mais la pause était de 350 ms — soit 171 appels par minute. La
   plupart des artistes étaient donc recalés en silence, et la bibliothèque
   plafonnait à 6 titres par artiste au lieu des 22 espérés. */
const PAUSE_MS    = 3400;

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

/* ============ UN SEUL ARTISTE PAR CARTE ============
   Le jeu demande « c'est qui ? » et propose quatre noms. Si la carte est
   signée « GIMS & Dadju », aucune des quatre réponses n'est juste : la bonne
   réponse n'existe pas. Une carte porte donc UN artiste, et la ligne complète
   part dans les crédits, affichée une fois la carte retournée.

   L'ancien test laissait passer deux choses :
   · « GIMS & Dadju » — il commençait par « gims » ;
   · « Hamza Namira » — il contenait « hamza » et n'était pas beaucoup plus long.
   Le second est pire que le premier : ce n'est pas un featuring, c'est
   quelqu'un d'autre. */
export const SEP_ARTISTES=/\s*(?:,|&|\/|\bfeat\.?|\bft\.?|\bfeaturing\b|\bavec\b|\bwith\b|\bvs\.?|\bx\b|\+)\s*/i;
export const SEP_ARTISTES_G=new RegExp(SEP_ARTISTES.source,"gi");

export function unSeulArtiste(cherche,rendu){
  const cible=norm(cherche), plein=norm(rendu);
  if(plein===cible) return {ok:true,credits:""};
  /* Un nom qui contient déjà un séparateur (« Earth, Wind & Fire ») ne se
     découpe pas : pour lui, c'est exact ou rien. */
  if(SEP_ARTISTES.test(cherche)) return {ok:false};
  const parts=String(rendu).split(SEP_ARTISTES_G).map(x=>x.trim()).filter(Boolean);
  if(parts.length<2) return {ok:false};
  if(parts.some(p=>norm(p)===cible)) return {ok:true,credits:rendu};
  return {ok:false};
}

function nettoyer(artiste, poids, rows){
  const vus = new Set();
  const gardes = [];

  for(const r of rows){
    if(!r.previewUrl || !r.artworkUrl100 || !r.trackName || !r.artistName) continue;

    /* 1. l'artiste renvoyé doit bien être celui qu'on cherchait, seul ou nommé
          dans un featuring. Sans ce test, des karaokés, des homonymes et des
          duos entrent dans le jeu avec la bonne réponse absente. */
    const v = unSeulArtiste(artiste, r.artistName);
    if(!v.ok) continue;

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
      // l'artiste est celui qu'on a interrogé ; le crédit complet part à côté
      artist: artiste,
      credits: v.credits,
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
