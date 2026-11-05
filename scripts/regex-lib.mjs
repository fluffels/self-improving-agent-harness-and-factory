/**
 * Regex-Helfer ohne Importe (Blatt): die eine Quelle für `escapeRegex` und das Entfernen von ANSI-Farbcodes (factory#202).
 * Jeder Verbraucher importiert direkt von hier, es gibt keinen Re-Export (wie factory#114). `schichten-kern.cjs` (CommonJS ohne Importe)
 * maskiert ohne diese Quelle nur den Punkt (Endungsform) und trägt keine Kopie der Escape-Klasse.
 */

/** Maskiert alle Regex-Metazeichen samt `/` und `-`. Pur. */
export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\/-]/g, String.raw`\$&`);
}

/** ANSI-Farbcode (`ESC[…m`). */
export const FARBCODE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Text ohne ANSI-Farbcodes. Pur. */
export const ohneFarbcodes = (text) => String(text ?? "").replace(FARBCODE, "");
