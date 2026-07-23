/**
 * Nettoyage du pseudo lu — partage par le pipeline navigateur et le pipeline
 * serveur (pur string, aucune dependance DOM/Node).
 *
 * CODM accole au pseudo, EN GRIS-BLEU et entre parentheses, le surnom local
 * donne au joueur dans la liste d'amis : "AZ-Alk_pc(Paul)", "AZ-hawwaw(Hawa)".
 * Ce n'est PAS une partie du pseudo en jeu : c'est un libelle prive, propre au
 * compte qui a pris la capture. On le retire.
 *
 * Attention a la frontiere de la spec (§10) : on ne "corrige" JAMAIS un pseudo
 * (pas d'auto-correction, pas de rapprochement — c'est le job de The Circle).
 * Ici on retire un element d'INTERFACE qui n'appartient pas au pseudo, au meme
 * titre que l'embleme de clan exclu par le decoupage. La casse, les accents et
 * les caracteres exotiques ("∧V∧`Silence") sont conserves tels quels.
 */

// Caracteres pouvant tenir lieu de parenthese OUVRANTE : le jeu l'affiche "(",
// mais Tesseract la rend souvent "!", "|" ou "[". On ne peut PAS les chercher
// naivement : le "l" de "AZ-Alk_pc" serait pris pour une ouvrante et couperait
// le pseudo a "AZ-A". D'ou la regle : on prend la DERNIERE ouvrante plausible,
// et seulement quand la chaine se termine bien par une fermante.
const OPENERS = "([{!|";
const CLOSERS = ")]}";
// Variante sans fermante : "...(Pau", pseudo tronque a droite. La, seules les
// vraies parentheses comptent — aucune ambiguite possible.
const TRAILING_OPEN_NICKNAME = /\s*[([{][^)\]}]*$/;
// Rebut de fin : jeton isole de 1-2 caracteres, souvent l'icone "ajouter en ami"
// ou le badge de niveau que Tesseract interprete ("Scusix |", "sonika r", "... 2").
const TRAILING_JUNK = /\s+[^\s]{1,2}$/;

/**
 * Nettoie un pseudo lu : retire le surnom entre parentheses et le rebut de fin,
 * normalise les espaces.
 *
 * Ne retire jamais au point de vider la chaine : si le nettoyage ne laisse rien
 * (ou moins de 2 caracteres), on rend le texte brut et on laisse l'humain
 * trancher — mieux vaut un pseudo bruite qu'une case vide (§9).
 */
export function cleanPseudo(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return trimmed;

  let out = trimmed;

  // Surnom complet "(Paul)" / "! Hawa)" : on coupe a la DERNIERE ouvrante.
  if (CLOSERS.includes(trimmed[trimmed.length - 1])) {
    let cut = -1;
    for (let i = trimmed.length - 2; i >= 2; i--) {
      if (OPENERS.includes(trimmed[i])) {
        cut = i;
        break;
      }
    }
    if (cut >= 2) {
      const candidate = trimmed.slice(0, cut).trim();
      if (candidate.length >= 2) out = candidate;
    }
  } else {
    // Surnom ouvert et tronque : "AZ-Alk_pc(Pau".
    const open = trimmed.replace(TRAILING_OPEN_NICKNAME, "").trim();
    if (open.length >= 2) out = open;
  }

  // Le rebut de fin ne se retire que s'il reste un pseudo consistant derriere.
  const dejunked = out.replace(TRAILING_JUNK, "").trim();
  if (dejunked.length >= 3) out = dejunked;

  return out.length >= 2 ? out : trimmed;
}
