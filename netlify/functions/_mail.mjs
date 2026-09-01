// L'envoi d'e-mail — uniquement pour retrouver un mot de passe perdu.
//
// Diggers n'a jamais demandé d'adresse et continue de ne pas en demander :
// l'adresse est facultative, elle ne sert qu'à ça, elle n'est jamais utilisée
// pour écrire au joueur autrement, et elle part avec le compte.
//
// Deux variables d'environnement suffisent, et tant qu'elles sont vides le
// reste du jeu fonctionne exactement pareil — le formulaire dit simplement que
// la récupération n'est pas ouverte sur ce site :
//
//   RESEND_KEY   la clé API d'un compte Resend (3 000 envois par mois offerts)
//   MAIL_FROM    l'expéditeur, par exemple  Diggers <bonjour@mon-domaine.fr>
//                (il faut un vrai nom de domaine vérifié chez Resend)

export const envoiConfigure = () => !!(process.env.RESEND_KEY && process.env.MAIL_FROM);

export async function envoyer({ a, sujet, texte, html }) {
  if (!envoiConfigure()) return { ok: false, raison: "non configuré" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: "Bearer " + process.env.RESEND_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [a],
        subject: sujet,
        text: texte,
        html: html || undefined
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) {
      const d = await r.text().catch(() => "");
      return { ok: false, raison: "refus du service d'envoi (" + r.status + ")", details: d.slice(0, 200) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, raison: "service d'envoi injoignable" };
  }
}

/* L'adresse du site, pour fabriquer les liens. Netlify la fournit ; sinon on
   se rabat sur celle de la requête. */
export function adresseDuSite(req) {
  const env = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.SITE_URL;
  if (env) return String(env).replace(/\/+$/, "");
  try { return new URL(req.url).origin; } catch { return ""; }
}

const echapper = s => String(s).replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

/* Une seule mise en page, sobre, sans image ni pixel de suivi. */
export function lettre({ titre, phrases, bouton, lien, pied }) {
  const corps = phrases.map(p => "<p style=\"margin:0 0 14px;line-height:1.6\">" + p + "</p>").join("");
  return {
    texte: [titre, "", ...phrases.map(p => p.replace(/<[^>]+>/g, "")), "", lien, "", pied].join("\n"),
    html: '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;'
      + 'padding:28px;color:#1a1a22;background:#fff">'
      + '<p style="font-weight:800;letter-spacing:.08em;font-size:13px;color:#FF3D7F;margin:0 0 18px">DIGGERS</p>'
      + '<h1 style="font-size:22px;margin:0 0 16px">' + echapper(titre) + '</h1>'
      + corps
      + '<p style="margin:22px 0"><a href="' + echapper(lien) + '" style="background:#FF3D7F;color:#fff;'
      + 'text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;display:inline-block">'
      + echapper(bouton) + '</a></p>'
      + '<p style="margin:0 0 14px;font-size:13px;color:#6F7183">Si le bouton ne marche pas, copie ce lien :<br>'
      + '<span style="word-break:break-all">' + echapper(lien) + '</span></p>'
      + '<hr style="border:0;border-top:1px solid #e6e6ee;margin:22px 0">'
      + '<p style="margin:0;font-size:12px;color:#6F7183">' + echapper(pied) + '</p></div>'
  };
}
