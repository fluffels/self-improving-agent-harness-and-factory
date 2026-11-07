/**
 * Texte vieler Pfade einer Basis in einem Aufruf `git cat-file --batch` (factory#220 L37), statt ein `git show` je Pfad.
 * `gitBatch(args, input)` führt git mit `input` auf stdin aus und liefert stdout als Buffer. Antwort je Pfad:
 * `<oid> <typ> <größe>\n<inhalt>\n` oder `<objekt> missing\n`; die Größe zählt Bytes, darum wird auf dem Buffer geparst.
 */
export type GitBatch = (args: string[], input: Buffer) => Buffer;

/** Pfad -> Text der Basis (UTF-8), `null` für einen Pfad, den die Basis nicht kennt. */
export function basisTexte(gitBatch: GitBatch, basis: string, pfade: string[]): Map<string, string | null> {
  const ergebnis = new Map<string, string | null>();
  if (pfade.length === 0) return ergebnis;
  const aus = gitBatch(["cat-file", "--batch"], Buffer.from(pfade.map((p) => `${basis}:${p}\n`).join(""), "utf8"));
  let pos = 0;
  for (const pfad of pfade) {
    const ende = aus.indexOf(0x0a, pos);
    const kopf = aus.subarray(pos, ende).toString("utf8");
    pos = ende + 1;
    if (kopf.endsWith(" missing")) {
      ergebnis.set(pfad, null);
      continue;
    }
    const groesse = Number(kopf.slice(kopf.lastIndexOf(" ") + 1));
    ergebnis.set(pfad, aus.subarray(pos, pos + groesse).toString("utf8"));
    pos += groesse + 1;
  }
  return ergebnis;
}
