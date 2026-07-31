import { type ImageSource, type RelBox } from "./source";
import type { RowBand } from "../template";
/**
 * @param box boite du tableau RELATIVE a l'image, telle que rendue par
 *            autoDetectTables (la partie `body`).
 * @returns les bandes RELATIVES a la boite, ou null si le profil est
 *          inexploitable / manifestement faux.
 */
export declare function anchorRows(src: ImageSource, box: RelBox): Promise<RowBand[] | null>;
//# sourceMappingURL=anchor.d.ts.map