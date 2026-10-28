/* Gemeinsame Baseline-Zählung der Kern-Wächter (#78 L16c): `kern-reinheit.test.ts` (Projektliterale je Kern-Einheit) und
 * `factory-seiten.test.ts` (Projektwerte je Doku-Seite) zählen Begriffe je Einheit, vergleichen die Zählung nur sinkend mit einer
 * Baseline-Datei und sperren deren Anhebung gegen die Diff-Basis. Die Mechanik steht hier einmal; die Meldungstexte bringt jeder Wächter selbst mit.
 * Die Datei enthält bewusst keine Tests (kein `.test.ts`, vitest sammelt sie nicht ein). */

/** Zählung je Begriff (nur > 0). */
export type Zaehlung = Record<string, number>;
/** Zählung je Einheit (Datei, Seite). */
export type Baseline = Record<string, Zaehlung>;

/** Zählung je Begriff (nur > 0), CRLF-neutral. */
export function zaehle(text: string, begriffe: Record<string, RegExp>): Zaehlung {
  const t = text.replace(/\r\n/g, "\n");
  const out: Zaehlung = {};
  for (const [name, re] of Object.entries(begriffe)) {
    const n = (t.match(re) ?? []).length;
    if (n > 0) out[name] = n;
  }
  return out;
}

/** Meldungstexte des Vergleichs; jede Funktion liefert die Meldung(en) zu genau einem Befund. */
export interface VergleichsTexte {
  /** Begriff ohne Baseline-Eintrag (n > 0). */
  neu: (einheit: string, begriff: string, n: number) => string;
  /** Zählung über der Baseline. */
  ueber: (einheit: string, begriff: string, n: number, baseline: number) => string;
  /** Zählung unter der Baseline: `n` ist 0, wenn der Begriff in der Einheit nicht mehr vorkommt. */
  unter: (einheit: string, begriff: string, n: number, baseline: number) => string;
  /** Baseline-Eintrag, dessen Einheit nicht (mehr) gezählt wird; eine Meldung je Einheit oder je Begriff. */
  verwaist: (einheit: string, begriffe: Zaehlung) => string[];
}

/** Meldungen (leer = grün): Ist gegen Baseline, nur sinkend. Erst die Einheiten der Zählung, danach Baseline-Einheiten ohne Zählung. Die Texte bringt der Wächter mit (kein Standard). */
export function vergleiche(ist: Baseline, baseline: Baseline, texte: VergleichsTexte): string[] {
  const out: string[] = [];
  for (const [einheit, z] of Object.entries(ist)) {
    const b = baseline[einheit] ?? {};
    for (const [begriff, n] of Object.entries(z)) {
      const bn = b[begriff];
      if (bn === undefined) out.push(texte.neu(einheit, begriff, n));
      else if (n > bn) out.push(texte.ueber(einheit, begriff, n, bn));
      else if (n < bn) out.push(texte.unter(einheit, begriff, n, bn));
    }
    for (const [begriff, bn] of Object.entries(b)) {
      if (!(begriff in z)) out.push(texte.unter(einheit, begriff, 0, bn));
    }
  }
  for (const [einheit, b] of Object.entries(baseline)) {
    if (!(einheit in ist)) out.push(...texte.verwaist(einheit, b));
  }
  return out;
}

/** Meldungen: Baseline-Werte über dem erlaubten Basiswert. `erl` nennt je berührter Einheit die Zählung an der Diff-Basis; eine Einheit ohne Eintrag dort wird nicht geprüft. */
export function anhebungen(baseline: Baseline, erl: Baseline): string[] {
  const out: string[] = [];
  for (const [einheit, basis] of Object.entries(erl)) {
    for (const [begriff, n] of Object.entries(baseline[einheit] ?? {})) {
      const b = basis[begriff] ?? 0;
      if (n > b) out.push(`${einheit}: Baseline '${begriff}' ${n} über dem Wert an der Diff-Basis (${b}), anheben ist verboten`);
    }
  }
  return out;
}

/** Anheben-Prüfung gegen die Diff-Basis: `pruefen` (Basis da), `entfaellt` (lokal ohne Basis), `rot` (CI ohne Basis, fail-closed). */
export function diffBasisModus(basis: string | null, env: Record<string, string | undefined>): "pruefen" | "entfaellt" | "rot" {
  if (basis !== null) return "pruefen";
  return env.CI === "true" ? "rot" : "entfaellt";
}
