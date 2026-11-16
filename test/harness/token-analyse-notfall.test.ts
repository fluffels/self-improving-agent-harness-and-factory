/* @harness-waechter Die Notfall-Art token-analyse in NOTFAELLE (board-lib.mjs, verteilt) trägt denselben Marker wie die Fabrik-eigene Quelle (token-analyse-ausloesen-lib.mjs), steht hinter rot-main und security und vor dependabot, und weder das Bau-Ticket factory#518 noch seine Kinder gelten als Analyse-Ticket (factory#578). Grenze: prüft Marker und Rang, nicht den Ablauf des Auslösers (test/token-analyse-ausloesen.test.ts). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as boardModul from "../../scripts/board-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as ausloeserModul from "../../scripts/token-analyse-ausloesen-lib.mjs";

const board = boardModul as unknown as {
  NOTFAELLE: { art: string; marker: string; quelle: string }[];
  istKopfItem: (i: { title: string }) => boolean;
  kopfRang: (i: { title: string }) => number;
};
const ausloeser = ausloeserModul as unknown as { MARKER: string; istAnalyseTicket: (i: { title: string; body: string }) => boolean };

const arten = () => board.NOTFAELLE.map((n) => n.art);
const eintrag = () => board.NOTFAELLE.find((n) => n.art === "token-analyse");

describe("Notfall-Art token-analyse", () => {
  it("der Marker in NOTFAELLE ist der Marker der Fabrik-Quelle", () => {
    expect(eintrag()?.marker).toBe(ausloeser.MARKER);
  });

  it("Rang hinter rot-main und security, vor dependabot", () => {
    const a = arten();
    expect(a.indexOf("token-analyse")).toBe(a.indexOf("security") + 1);
    expect(a.indexOf("token-analyse")).toBe(a.indexOf("dependabot") - 1);
    expect(board.kopfRang({ title: "🔒 Security: x" })).toBeLessThan(board.kopfRang({ title: "💸 Token-Analyse 2026-12-15 (Anlass: manuell)" }));
    expect(board.kopfRang({ title: "💸 Token-Analyse 2026-12-15 (Anlass: manuell)" })).toBeLessThan(board.kopfRang({ title: "🤖 Dependabot-PRs auflösen" }));
  });

  it("die Quelle docs/ticket-reihenfolge.md nennt den Marker wörtlich", () => {
    const quelle = eintrag()?.quelle ?? "";
    expect(quelle).toBe("docs/ticket-reihenfolge.md");
    expect(readFileSync(new URL(`../../${quelle}`, import.meta.url), "utf8")).toContain(ausloeser.MARKER);
  });

  it("ein ausgelöstes Analyse-Ticket ist ein Kopf-Item", () => {
    expect(board.istKopfItem({ title: "💸 Token-Analyse 2026-12-15 (Anlass: manuell)" })).toBe(true);
  });

  it("Negativfall: das Bau-Ticket und seine Kinder tragen den Marker nicht", () => {
    const bau = { title: "Token-Analyse 8/9: Auslöser monatlich, manuell und Kosten mit Kopf-Item und Dedupe (factory#518)", body: "Titelmarker `💸 Token-Analyse`, Body-Marker `<!-- token-analyse -->`" };
    const epic = { title: "Epic: Token-Analyse (factory#518)", body: "Kinder 1/9 bis 9/9" };
    for (const t of [bau, epic]) {
      expect(ausloeser.istAnalyseTicket(t), t.title).toBe(false);
      expect(board.istKopfItem(t), t.title).toBe(false);
    }
  });
});
