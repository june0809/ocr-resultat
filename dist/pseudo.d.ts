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
/**
 * Nettoie un pseudo lu : retire le surnom entre parentheses et le rebut de fin,
 * normalise les espaces.
 *
 * Ne retire jamais au point de vider la chaine : si le nettoyage ne laisse rien
 * (ou moins de 2 caracteres), on rend le texte brut et on laisse l'humain
 * trancher — mieux vaut un pseudo bruite qu'une case vide (§9).
 */
export declare function cleanPseudo(raw: string): string;
//# sourceMappingURL=pseudo.d.ts.map