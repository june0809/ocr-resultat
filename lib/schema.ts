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

export const Source = z.enum(["web", "discord"]);
export type Source = z.infer<typeof Source>;

// --- Entree : cas navigateur (OCR deja fait cote client), §6.1 --------------

const nonNegInt = z.number().int().min(0);

const PlayerIn = z.object({
  pseudo: z.string().min(1).max(64),
  kills: nonNegInt,
  deaths: nonNegInt,
  // assists optionnel : certains jeux ne l'affichent pas (§6.2)
  assists: nonNegInt.optional(),
  confidence: z.number().min(0).max(1),
  // placement au niveau joueur : uniquement pour free_for_all (§6.2)
  placement: nonNegInt.optional(),
});

const TeamIn = z.object({
  placement: nonNegInt.optional(),
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

// --- Entree : cas image (OCR cote serveur), §6.1 ----------------------------
// Non implemente en Lot 1 (aucun OCR). On valide quand meme la forme pour
// rendre une erreur propre et stable.

export const ImageMatchBody = z.object({
  source: z.literal("discord"),
  game: z.string().min(1).max(64),
  mode: Mode.optional(),
  image_base64: z.string().min(1),
});

/**
 * Union discriminee sur `source`, puis application des regles de mode (§6.2)
 * uniquement au chemin navigateur. Le refine au niveau de l'union est autorise
 * (contrairement au refine sur un membre de discriminatedUnion).
 */
export const MatchBody = z
  .discriminatedUnion("source", [WebMatchBody, ImageMatchBody])
  .superRefine((body, ctx) => {
    if (body.source === "web") refineWeb(body, ctx);
  });

export type WebMatchBody = z.infer<typeof WebMatchBody>;
export type ImageMatchBody = z.infer<typeof ImageMatchBody>;

// --- Sortie : §6.2 ----------------------------------------------------------
// Types uniquement (la reponse est construite dans lib/response.ts).

export interface PlayerOut {
  pseudo: string;
  kills: number;
  deaths: number;
  assists?: number;
  placement?: number;
  confidence: number;
}

export interface TeamOut {
  placement?: number;
  players: PlayerOut[];
}

export interface Warning {
  code: string;
  player?: string;
  detail: string;
}

export interface MatchResponse {
  match_id: string;
  game: string;
  mode: Mode;
  captured_at: string;
  source: Source;
  confidence: number;
  teams: TeamOut[];
  warnings: Warning[];
}
