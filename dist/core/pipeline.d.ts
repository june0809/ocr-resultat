import { type Worker } from "tesseract.js";
import { type ImageSource } from "./source";
import { type GameTemplate } from "../template";
/**
 * Lecture du scoreboard, cellule par cellule.
 *
 * On ne fait JAMAIS d'OCR plein cadre : les polices stylisees sur fond
 * translucide donnent de la bouillie. Chaque cellule est decoupee via le
 * template puis lue au bon mode (chiffres -> whitelist, pseudo -> texte libre).
 *
 * Partage Node/navigateur : les pixels passent par ImageSource, le moteur par
 * un Worker tesseract fourni par l'appelant (qui sait, lui, ou trouver la
 * traineddata sur sa plateforme).
 */
export interface OcrCell {
    text: string;
    /** 0.0–1.0 (tesseract rend 0–100, converti ici). */
    confidence: number;
}
export interface OcrPlayer {
    pseudo: string;
    kills: number | null;
    deaths: number | null;
    assists: number | null;
    score: number | null;
    /** MVP = 1re ligne (board trie par score decroissant). Corrigible cote UI. */
    is_mvp: boolean;
    /** confiance des STATS (cellule K/D/A) : alimente la confiance globale + 422. */
    confidence: number;
    /** confiance de lecture du pseudo : warning + surlignage, jamais le 422. */
    pseudo_confidence: number;
    cells: {
        pseudo: OcrCell;
        score: OcrCell;
        ema: OcrCell;
    };
}
export interface OcrTeam {
    side: "blue" | "red";
    players: OcrPlayer[];
}
export interface OcrResult {
    teams: OcrTeam[];
}
/** "15/7/0" (avec bruit OCR) -> {kills,deaths,assists} : 3 premiers nombres. */
export declare function parseEma(raw: string): {
    kills: number | null;
    deaths: number | null;
    assists: number | null;
};
/** Extrait un entier d'une chaine OCR bruitee ("SCORE 240" -> 240). */
export declare function parseInt0(raw: string): number | null;
export interface RunOcrOptions {
    /** Trace les colonnes detectees (diagnostic). */
    onDebug?: (message: string) => void;
}
export declare function runOcr(worker: Worker, src: ImageSource, template: GameTemplate, opts?: RunOcrOptions): Promise<OcrResult>;
//# sourceMappingURL=pipeline.d.ts.map