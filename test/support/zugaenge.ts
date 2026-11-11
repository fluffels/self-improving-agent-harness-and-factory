/** Welche Umgebungsvariablen ein Zugang sind (rein; das Setup test/support/zugaenge-entfernen.ts löscht sie, Wächter: test/harness/test-umgebung.test.ts). */
export const istZugang = (schluessel: string): boolean => schluessel.startsWith("LANGFUSE_") || schluessel === "GH_TOKEN" || schluessel === "GITHUB_TOKEN";
