// La moissonneuse, toute seule, toutes les minutes.
//
// C'est ce qui change tout par rapport à l'ancien constructeur : personne n'a
// besoin d'être devant l'écran. Netlify réveille cette fonction, elle fait
// trois appels à Apple, range ce qu'elle trouve et se rendort. Une minute plus
// tard elle reprend là où elle en était.
//
// Trois requêtes par minute, c'est volontairement lent : Apple limite le
// débit, et une moisson qui se fait jeter perd plus de temps qu'elle n'en
// gagne. À ce rythme, cent quatre-vingts artistes par heure — deux mille
// discographies en une nuit, sans rien surveiller.
//
// Elle ne fait RIEN tant que l'administrateur ne l'a pas lancée depuis
// l'écran : l'état « actif » est le seul interrupteur.

import * as M from "./_moisson.mjs";

export default async function () {
  const e = await M.lireEtat();
  if (!e.actif) return new Response("en pause", { status: 200 });
  const r = await M.unTour(3);
  return new Response(JSON.stringify({
    phase: r.phase, fait: r.fait, recoltes: r.recoltes, ajoutes: r.ajoutes
  }), { status: 200, headers: { "content-type": "application/json" } });
}

export const config = { schedule: "* * * * *" };
