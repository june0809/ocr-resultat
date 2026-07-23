import { z } from "zod";

/**
 * Schemas de validation du contrat d'API. SPEC §6.
 *
 * Regle d'or : le service ne renvoie JAMAIS de profile_id / email / identite.
 * Le pseudo est rendu BRUT, jamais "corrige" (§12). Ces schemas valident la
 * STRUCTURE ; ils ne modifient pas les pseudos.
 */

// --- Enums ------------------------------------------------------------------

export const Mode = z.enum(["battle_royale", "team_deathmatch", "free_for_all"]);
export type Mode = z.infer<typeof Mode>;

// Qui appelle le service. En v2 le chemin NOMINAL est `the_circle` + image (OCR
// serveur). `web` = chemin "JSON deja extrait", conserve pour les tests / la
// compat (§5.1). `discord` (v1) est supprime.
export const Source = z.enum(["the_circle", "web"]);
export type Source = z.infer<typeof Source>;

// Gabarit d'ecran CODM (§4.2). Optionnel en entree : si absent, le service tente
// de reconnaitre le gabarit, sinon 422 unreadable_scoreboard. Determine aussi le
// `mode` en sortie (codm_br -> battle_royale, codm_mp -> team_deathmatch).
export const Screen = z.enum(["codm_br", "codm_mp"]);
export type Screen = z.infer<typeof Screen>;

// --- Entree : cas navigateur (OCR deja fait cote client), §6.1 --------------

const nonNegInt = z.number().int().min(0);

const PlayerIn = z.object({
  pseudo: z.string().min(1).max(64),
  kills: nonNegInt,
  deaths: nonNegInt,
  // assists optionnel : certains jeux ne l'affichent pas (§6.2)
  assists: nonNegInt.optional(),
  // confidence optionnelle : confiance dans les STATS du joueur (kills/deaths/
  // assists). C'est elle qui alimente la confiance globale et le gate 422. Si
  // omise, 1.0 par defaut (lib/response.ts).
  confidence: z.number().min(0).max(1).optional(),
  // pseudo_confidence : confiance SPECIFIQUE a la lecture du pseudo (souvent basse
  // pour les pseudos stylises). N'impacte PAS le 422 : sert uniquement a lever un
  // warning low_confidence_pseudo pour la validation humaine (§9). Optionnel.
  pseudo_confidence: z.number().min(0).max(1).optional(),
  // placement au niveau joueur : uniquement pour free_for_all (§6.2)
  placement: nonNegInt.optional(),
  // is_mvp : badge MVP par joueur (champ generique esport). Passthrough : lu en
  // entree, reemis tel quel en sortie, jamais deduit cote service.
  is_mvp: z.boolean().optional(),
});

const TeamIn = z.object({
  placement: nonNegInt.optional(),
  // rounds_won : score de manches de l'equipe (ex. 5 pour un 5:4). Optionnel,
  // passthrough. Pour le chemin image (Lot 2), ce sera la source de verite du
  // placement (gagnant = plus de rounds_won).
  rounds_won: nonNegInt.optional(),
  players: z.array(PlayerIn).min(1),
});

const Extracted = z.object({
  teams: z.array(TeamIn).min(1),
});

/**
 * Corps du chemin navigateur (objet nu, sans refine).
 *
 * ⚠️ z.discriminatedUnion n'accepte que des ZodObject : on NE met donc pas le
 * .superRefine ici (il produirait un ZodEffects). Les regles specifiques au mode
 * (BR / TDM / FFA, §6.2) sont appliquees via `refineWeb` au niveau de l'union.
 */
export const WebMatchBody = z.object({
  source: z.literal("web"),
  game: z.string().min(1).max(64),
  mode: Mode,
  // captured_at optionnel : heure REELLE du match fournie par le client
  // (ex. The Circle). Si absent, le service met son heure serveur (voir response.ts).
  // Accepte l'UTC (Z) comme les offsets (+02:00).
  captured_at: z.string().datetime({ offset: true }).optional(),
  extracted: Extracted,
});

/** Regles §6.2 specifiques au mode, appliquees au chemin navigateur. */
function refineWeb(body: z.infer<typeof WebMatchBody>, ctx: z.RefinementCtx) {
  {
    const { mode, extracted } = body;
    const teams = extracted.teams;

    if (mode === "team_deathmatch") {
      if (teams.length !== 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["extracted", "teams"],
          message: "team_deathmatch : exactement 2 teams attendues.",
        });
      }
      teams.forEach((t, i) => {
        if (t.placement !== 1 && t.placement !== 2) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["extracted", "teams", i, "placement"],
            message: "team_deathmatch : placement doit valoir 1 (gagnante) ou 2.",
          });
        }
      });
    }

    if (mode === "battle_royale") {
      teams.forEach((t, i) => {
        if (t.placement === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["extracted", "teams", i, "placement"],
            message: "battle_royale : chaque team doit avoir un placement.",
          });
        }
      });
    }

    if (mode === "free_for_all") {
      if (teams.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["extracted", "teams"],
          message: "free_for_all : une seule team contenant tous les joueurs.",
        });
      }
      teams.forEach((t, ti) =>
        t.players.forEach((p, pi) => {
          if (p.placement === undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["extracted", "teams", ti, "players", pi, "placement"],
              message: "free_for_all : placement porte au niveau joueur.",
            });
          }
        })
      );
    }
  }
}

// --- Entree : cas image (OCR cote serveur, chemin NOMINAL v2), §5.1 ----------
// The Circle envoie l'image ; l'OCR (template auto-ancre + Tesseract par cellule)
// est fait cote serveur (Lot A). La forme est FIGEE ici : c'est le contrat (§5)
// contre lequel The Circle integre en parallele.

export const TheCircleImageMatchBody = z.object({
  source: z.literal("the_circle"),
  game: z.string().min(1).max(64),
  // screen optionnel : reconnaissance auto du gabarit si absent (§5.1).
  screen: Screen.optional(),
  // png/jpg en base64 SANS en-tete data:. Taille max / MIME verifies au cablage.
  image_base64: z.string().min(1),
});

/**
 * Union discriminee sur `source`, puis application des regles de mode (§6.2)
 * uniquement au chemin navigateur. Le refine au niveau de l'union est autorise
 * (contrairement au refine sur un membre de discriminatedUnion).
 */
export const MatchBody = z
  .discriminatedUnion("source", [WebMatchBody, TheCircleImageMatchBody])
  .superRefine((body, ctx) => {
    if (body.source === "web") refineWeb(body, ctx);
  });

export type WebMatchBody = z.infer<typeof WebMatchBody>;
export type TheCircleImageMatchBody = z.infer<typeof TheCircleImageMatchBody>;

// --- Sortie : §6.2 ----------------------------------------------------------
// Types uniquement (la reponse est construite dans lib/response.ts).

/**
 * Confiance + source d'UNE cellule lue par l'OCR image (§5.2). `source: "vision"`
 * n'apparait qu'avec le repli vision (Lot B, ETEINT en Lot A -> tout "tesseract").
 * C'est ce detail qui permet a The Circle de surligner cellule par cellule.
 */
export type CellSource = "tesseract" | "vision";

export interface CellField {
  value: string | number;
  confidence: number;
  source: CellSource;
}

/** Detail par cellule d'un joueur (chemin image). Absent sur le chemin web/compat. */
export interface PlayerFields {
  pseudo?: CellField;
  kills?: CellField;
  deaths?: CellField;
  assists?: CellField;
  placement?: CellField;
}

export interface PlayerOut {
  pseudo: string;
  kills: number;
  deaths: number;
  assists?: number;
  placement?: number;
  is_mvp?: boolean;
  // confiance agregee du joueur = min des cellules du joueur (§4.5).
  confidence: number;
  // detail par cellule (confiance + source). Chemin image uniquement.
  fields?: PlayerFields;
}

export interface TeamOut {
  placement?: number;
  rounds_won?: number;
  players: PlayerOut[];
}

export interface Warning {
  code: string;
  player?: string;
  detail: string;
}

/** Observabilite : combien de cellules ont ete lues par Tesseract vs le repli
 *  vision (suivi du budget). Chemin image uniquement (§5.2). */
export interface Engine {
  tesseract_cells: number;
  vision_cells: number;
}

export interface MatchResponse {
  match_id: string;
  game: string;
  mode: Mode;
  // gabarit d'ecran reconnu (chemin image). Absent sur le chemin web/compat.
  screen?: Screen;
  captured_at: string;
  source: Source;
  confidence: number;
  // compteurs moteur (chemin image). Absent sur le chemin web/compat.
  engine?: Engine;
  teams: TeamOut[];
  warnings: Warning[];
}
