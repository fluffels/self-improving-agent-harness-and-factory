/** Welche Umgebungsvariablen ein Zugang sind (rein; das Setup test/support/zugaenge-entfernen.ts löscht sie, Wächter: test/harness/test-umgebung.test.ts). PROJECT_TOKEN wird über tokenFuerZiel (scripts/gh-cli.mjs) zum GH_TOKEN für fremde Ziel-Repos. */
const TOKEN_NAMEN = new Set(["GH_TOKEN", "GITHUB_TOKEN", "PROJECT_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"]);
export const istZugang = (schluessel: string): boolean => schluessel.startsWith("LANGFUSE_") || TOKEN_NAMEN.has(schluessel);
