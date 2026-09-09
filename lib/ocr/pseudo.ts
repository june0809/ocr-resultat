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
// Rebut de DEBUT : le bord du cadre d'avatar ou la barre de rang, que Tesseract
// rend comme un trait isole devant le pseudo ("| AZ-Angelos", "I AZ-Tyrreny").
// Seuls les glyphes verticaux comptent, et seulement detaches du pseudo — sinon
// on rognerait la premiere lettre d'un vrai pseudo commencant par I ou l.
const LEADING_JUNK = /^[|Il!\[\]]{1,2}\s+/;
// Taille plausible d'un surnom d'ami, fermante comprise ("Hawa)", "Ghost)").
const MAX_NICKNAME = 9;

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

  // Le rebut de DEBUT se retire en premier : tout le decoupage qui suit raisonne
  // sur des index, un trait parasite en tete les decalerait tous.
  const deheaded = trimmed.replace(LEADING_JUNK, "").trim();
  const base = deheaded.length >= 2 ? deheaded : trimmed;
  let out = base;

  // Surnom complet "(Paul)" / "! Hawa)" : on coupe a la DERNIERE ouvrante.
  if (CLOSERS.includes(base[base.length - 1])) {
    let cut = -1;
    for (let i = base.length - 2; i >= 2; i--) {
      if (OPENERS.includes(base[i])) {
        cut = i;
        break;
      }
    }
    if (cut >= 2) {
      const candidate = base.slice(0, cut).trim();
      if (candidate.length >= 2) out = candidate;
    } else {
      // Fermante presente, AUCUNE ouvrante : le "(" est un trait fin, souvent
      // perdu ou rendu comme un simple blanc ("AZ-hawwaw Hawa)"). On coupe alors
      // au dernier blanc — mais seulement si ce qui reste tient debout et si la
      // queue a bien la taille d'un surnom. Sans ces deux garde-fous, "AZ
      // MakiGhost)" serait ramene a "AZ".
      const sp = base.lastIndexOf(" ");
      const head = sp > 0 ? base.slice(0, sp).trim() : "";
      const tail = sp > 0 ? base.slice(sp + 1) : "";
      if (head.length >= 4 && tail.length <= MAX_NICKNAME) out = head;
    }
  } else {
    // Surnom ouvert et tronque : "AZ-Alk_pc(Pau".
    const open = base.replace(TRAILING_OPEN_NICKNAME, "").trim();
    if (open.length >= 2) out = open;
  }

  // Le rebut de fin ne se retire que s'il reste un pseudo consistant derriere.
  const dejunked = out.replace(TRAILING_JUNK, "").trim();
  if (dejunked.length >= 3) out = dejunked;

  return out.length >= 2 ? out : trimmed;
}
