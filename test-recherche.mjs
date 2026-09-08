// Comment le jeu retrouve un morceau chez Apple.
// Le retour qui a motivé cette suite : « 12 sons trouvés sur 53, et c'est
// vraiment super long ». Les fonctions vivent dans index.html : on les en
// extrait et on les fait tourner sur de fausses réponses d'Apple, sans réseau.
//   node test-recherche.mjs

import { readFile } from "node:fs/promises";
import vm from "node:vm";

let ko = 0, n = 0;
const R = (nom, v) => { n++; if (!v) ko++; console.log((v ? "  ok    " : "  ÉCHEC ") + nom); };

const html = await readFile("index.html", "utf8");
const src = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));

/* On ne prend que ce dont on a besoin : les fonctions de recherche et leurs
   dépendances directes. Le reste du jeu a besoin d'un navigateur. */
function extraire(nom) {
  const i = src.indexOf(nom);
  if (i < 0) throw new Error("introuvable : " + nom);
  let j = src.indexOf("{", i), p = 0;
  for (; j < src.length; j++) {
    if (src[j] === "{") p++;
    else if (src[j] === "}") { p--; if (!p) return src.slice(i, j + 1); }
  }
  throw new Error("accolade non fermée : " + nom);
}
const morceaux = [
  "const SEP_ARTISTES=", "const SEP_ARTISTES_G=", "const REJET=", "const REJET_TITRE=",
].map(d => { const i = src.indexOf(d); return src.slice(i, src.indexOf("\n", i)); });

const code = morceaux.join("\n") + "\n"
  + extraire("function norm(") + "\n"
  + extraire("function titrePropre(") + "\n"
  + extraire("function unSeulArtiste(") + "\n"
  + extraire("function fabriquerPiste(") + "\n"
  + extraire("function trouverDansCatalogue(") + "\n";

const bac = {};
vm.createContext(bac);
vm.runInContext(code + "\nglobalThis.API={norm,titrePropre,unSeulArtiste,fabriquerPiste,trouverDansCatalogue};", bac);
const { fabriquerPiste, trouverDansCatalogue, norm } = bac.API;

/* Une réponse Apple crédible. */
const rep = (artistName, trackName, extra) => ({
  trackId: Math.floor(Math.random() * 1e9), trackName, artistName,
  collectionName: "Un album", primaryGenreName: "Hip-Hop/Rap",
  releaseDate: "2023-05-01T07:00:00Z", trackTimeMillis: 187000,
  artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg",
  previewUrl: "https://audio-ssl.itunes.apple.com/x/x.m4a",
  trackViewUrl: "https://music.apple.com/fr/album/x/1?i=2", ...(extra || {})
});

console.log("\nCe qui fait une carte jouable");

R("un résultat complet passe", !!fabriquerPiste(rep("Damso", "Macarena"), "Damso", "Macarena"));
R("sans extrait, on écarte", !fabriquerPiste(rep("Damso", "Macarena", { previewUrl: null }), "Damso", "Macarena"));
R("sans pochette non plus", !fabriquerPiste(rep("Damso", "Macarena", { artworkUrl100: null }), "Damso", "Macarena"));
R("un karaoké est écarté", !fabriquerPiste(rep("Karaoke Band", "Macarena"), "Karaoke Band", "Macarena"));
R("un homonyme est écarté", !fabriquerPiste(rep("Quelqu'un d'autre", "Macarena"), "Damso", "Macarena"));

const feat = fabriquerPiste(rep("GIMS & Damso", "Macarena"), "Damso", "Macarena");
R("un featuring passe si l'artiste demandé y est", !!feat);
R("et la carte va au premier crédité", feat.artist === "GIMS");
R("la ligne complète part en crédits", feat.credits === "GIMS & Damso");

console.log("\nLe filtre des versions alternatives, et sa limite");

R("un remix non demandé est écarté",
  !fabriquerPiste(rep("Jul", "Tchikita (Remix)"), "Jul", "Tchikita"));
/* Le vrai piège : un titre légitime qui contient un mot du filtre. Avant, il
   était écarté et le joueur ne comprenait pas pourquoi son morceau manquait. */
R("mais un titre demandé exactement passe, même s'il contient « live »",
  !!fabriquerPiste(rep("Un Artiste", "Live Ta Vie"), "Un Artiste", "Live Ta Vie"));
R("et même s'il contient « version »",
  !!fabriquerPiste(rep("Un Artiste", "Version Originale"), "Un Artiste", "Version Originale"));
R("l'exception ne vaut que pour le titre exact",
  !fabriquerPiste(rep("Un Artiste", "Live Ta Vie (Live)"), "Un Artiste", "Live Ta Vie"));

console.log("\nRetrouver un titre dans le catalogue d'un artiste");

const cat = [
  rep("winnterzuko", "Salieri"),
  rep("winnterzuko", "Langmore"),
  rep("winnterzuko", "Dolores"),
  rep("winnterzuko", "Monstre (feat. Quelqu'un)"),
  rep("Autre Artiste", "Langmore")
];
R("le titre exact est retrouvé",
  trouverDansCatalogue(cat, "winnterzuko", "Langmore").title === "Langmore");
R("la casse ne compte pas",
  trouverDansCatalogue(cat, "winnterzuko", "LANGMORE").title === "Langmore");
R("les accents et la ponctuation non plus",
  trouverDansCatalogue(cat, "winnterzuko", "dolorès").title === "Dolores");
R("un titre avec un featuring entre parenthèses est retrouvé sans",
  trouverDansCatalogue(cat, "winnterzuko", "Monstre").title === "Monstre");
R("un titre absent rend null",
  trouverDansCatalogue(cat, "winnterzuko", "Ce titre n'existe pas") === null);
R("le catalogue d'un autre artiste n'est pas pris par erreur",
  trouverDansCatalogue([rep("Autre Artiste", "Langmore")], "winnterzuko", "Langmore") === null);

console.log("\nLes rattrapages, du plus sûr au plus permissif");

R("un titre plus long qui contient celui demandé est accepté en second choix",
  trouverDansCatalogue([rep("X", "Tchikita (Bonus)")], "X", "Tchikita").title === "Tchikita");
R("un titre plus court contenu dans celui demandé aussi",
  trouverDansCatalogue([rep("X", "Macarena")], "X", "Macarena Deluxe").title === "Macarena");
R("mais pas un titre trop court pour vouloir dire quelque chose",
  trouverDansCatalogue([rep("X", "Oh")], "X", "Oh la la les enfants") === null);
R("l'exact l'emporte toujours sur l'approchant", (() => {
  const r = trouverDansCatalogue([rep("X", "Tchikita (Bonus)"), rep("X", "Tchikita")], "X", "Tchikita");
  return r.title === "Tchikita";
})());

console.log("\nCe que la carte porte");
{
  const t = fabriquerPiste(rep("Damso", "Macarena"), "Damso", "Macarena");
  R("un identifiant", !!t.id);
  R("une pochette en 400 px", /400x400/.test(t.art));
  R("un extrait chez Apple", /audio-ssl\.itunes\.apple\.com/.test(t.preview));
  R("une année", t.year === 2023);
  R("une durée", t.ms === 187000);
  R("une popularité par défaut", t.pop === 50);
}

console.log("\n" + n + " vérifications, " + (ko ? ko + " ERREUR(S)" : "aucune erreur"));
process.exit(ko ? 1 : 0);
