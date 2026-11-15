/* Runden-Abgleich des Review-Nachweises (factory#534) – @harness-waechter: einziger Durchsetzer der Regel „runden stimmt mit den Commit-Zeilen überein“.
 *
 * `runden` darf nicht unter der höchsten Commit-Zeile `Runde <n>:` plus 1 liegen; über dem Cap (MAX_REVIEW_PAESSE) braucht jeder Pass
 * eine Commit-Zeile `<Präfix>Zusatzpass: R<k> <Ursache> — Entscheidung: <X>, weil <Y>`. Gilt für beide Laufzeiten, weil die CI prüft. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { FREMD } from "../support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/check-review-nachweis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as sliceRaw from "../../scripts/slice-override.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as lib from "../../scripts/nachweis-lib.mjs";

type Z = { plan: string; review: string; zusatzpass: string; reviewOverride: string };
const { commitZeilen } = sliceRaw as unknown as { commitZeilen: (p: string, pl: string) => Z };
const Zl = commitZeilen(FREMD.praefixe.commitZeile, FREMD.agenten.planer);
const { hoechsteRunde, zusatzpassZeilenAus, MAX_REVIEW_PAESSE } = lib as unknown as {
  hoechsteRunde: (t: string) => number;
  zusatzpassZeilenAus: (t: string, k: string) => ({ k: number; ursache: string } | { ungueltig: string })[];
  MAX_REVIEW_PAESSE: number;
};
const SHA = "c".repeat(40);
const BASE = "b".repeat(40);
// Reiner Doku-Diff: Risikostufe 0 (Basis 3 Pässe), eine Doku-Brille.
const LENSES = "lenses=doku sollte=doku:0 hinweis=doku:0";
const ZP = (k: number, ursache = "Zusatzpass") => `${Zl.zusatzpass}: R${k} ${ursache} — Entscheidung: Pass ist nötig, weil Blocker offen`;

/** Gefälschtes git: nur die Branch-Commits (`base..HEAD`) im Log, wie die Merge-Base es liefert. */
const fakeGit = (commits: string) => (a: string[]): string => {
  const j = a.join(" ");
  if (j.startsWith("merge-base")) return BASE;
  if (j === "rev-parse HEAD") return "d".repeat(40);
  if (j.startsWith("log --reverse")) return commits;
  if (j.startsWith("diff --name-only")) return "docs/a.md\n";
  if (j.startsWith("-c core.quotepath=off diff --numstat")) return "100\t0\tdocs/a.md\n";
  if (j.startsWith("rev-parse --verify")) return SHA;
  if (j.startsWith("rev-list --count")) return "1";
  if (j.startsWith("rev-list --merges")) return "";
  if (j.startsWith("rev-list --reverse --no-merges")) return "";
  if (j.startsWith("rev-list")) return `${SHA}\n`;
  throw new Error(`unerwartet: ${j}`);
};
const pruefe = (review: string, davor = "") =>
  (raw as unknown as { checkReviewNachweis: (o: unknown) => { ok: boolean; fehler: string[] } }).checkReviewNachweis({
    runGit: fakeGit(`${davor}\n${Zl.plan}: ${FREMD.agenten.planer}\n${Zl.review}: head=${SHA} ${review}\n`),
    env: {},
    ladeZeilen: () => Zl,
  });
const bewerte = (o: { runden: number; hoechste?: number; zeilen?: unknown[] | null }) =>
  (raw as unknown as { bewerteNachweis: (o: unknown) => string[] }).bewerteNachweis({
    nachweis: (raw as unknown as { parseNachweis: (t: string, z: unknown) => unknown }).parseNachweis(
      `${Zl.plan}: ${FREMD.agenten.planer}\n${Zl.review}: head=${SHA} runden=${o.runden}${o.runden > 3 ? ` zusatzpass=${o.runden - 3}:Entscheidung` : ""} ${LENSES} verdikt=ok`,
      Zl,
    ),
    dateien: ["docs/a.md"],
    headBekannt: true,
    headImSlice: true,
    zeilen: Zl,
    risiko: { klasse: "doku", gruende: ["t"] },
    risikostufe: { stufe: 0, gruende: ["t"], treffer: [], pfade: [] },
    hoechsteRunde: o.hoechste ?? 0,
    zusatzpassZeilen: o.zeilen === undefined ? [] : o.zeilen,
  });

describe("hoechsteRunde", () => {
  test("keine Zeile ergibt 0, die höchste zählt, Squash-Präfix gilt, Prosa und Einrückung nicht", () => {
    assert.equal(hoechsteRunde("Titel\n\nkein Treffer"), 0);
    assert.equal(hoechsteRunde("Fix\n\nRunde 1: a\n\nFix\n\nRunde 3: b"), 3);
    assert.equal(hoechsteRunde("* Runde 2: x"), 2);
    assert.equal(hoechsteRunde("  Runde 5: x\nsiehe in Runde 4: bla"), 0);
    assert.equal(hoechsteRunde("Runde 2: x\r\nRunde 10: y\r\n"), 10);
  });
});

describe("zusatzpassZeilenAus", () => {
  test("alle vier Ursachen gelten, tolerant beim Gedankenstrich", () => {
    for (const u of ["Zusatzpass", "Abnahme-Fix", "CI-Fix-Delta", "Merge-Delta"]) {
      assert.deepEqual(zusatzpassZeilenAus(ZP(4, u), Zl.zusatzpass), [{ k: 4, ursache: u, entscheidung: "Pass ist nötig", weil: "Blocker offen" }]);
    }
    assert.equal((zusatzpassZeilenAus(`${Zl.zusatzpass}: R4 Zusatzpass - Entscheidung: X, weil Y`, Zl.zusatzpass)[0] as { k: number }).k, 4);
    assert.equal((zusatzpassZeilenAus(`* ${Zl.zusatzpass}: R4 Zusatzpass — Entscheidung: X, weil Y`, Zl.zusatzpass)[0] as { k: number }).k, 4);
  });
  test("ungültige Formen werden als ungültig markiert", () => {
    for (const w of ["R4 Unbekannt — Entscheidung: X, weil Y", "R4 Zusatzpass — Entscheidung: X", "R4 Zusatzpass — Entscheidung: , weil Y", "R4 Zusatzpass — Entscheidung: X, weil <Grund>", "R0 Zusatzpass — Entscheidung: X, weil Y", "Rx Zusatzpass — Entscheidung: X, weil Y", "nur Text"]) {
      assert.ok("ungueltig" in zusatzpassZeilenAus(`${Zl.zusatzpass}: ${w}`, Zl.zusatzpass)[0], w);
    }
  });
});

describe("bewerteNachweis: Runden-Abgleich (K2, K5)", () => {
  test("K5: runden=3 bei Commit-Zeile `Runde 3:` ist rot, mit `Runde 2:` grün", () => {
    assert.match(bewerte({ runden: 3, hoechste: 3 }).join("\n"), /runden=3 liegt unter der höchsten Commit-Zeile "Runde 3:" plus 1/);
    assert.deepEqual(bewerte({ runden: 3, hoechste: 2 }), []);
  });
  test("K5: runden=4 ohne Zusatzpass-Zeile mit Entscheidung ist rot und nennt das Format", () => {
    const f = bewerte({ runden: 4 }).join("\n");
    assert.match(f, /braucht je Pass über dem Cap genau eine Commit-Zeile \(R4\), gefunden: keine/);
    assert.match(f, /Zusatzpass: R<k> <Ursache> — Entscheidung: <X>, weil <Y>/);
  });
  test("runden=4 mit gültiger R4-Zeile ist grün, mit R4 und R5 rot, doppeltes R4 bei runden=5 rot, R4 allein bei runden=5 rot", () => {
    const z = (...ks: number[]) => zusatzpassZeilenAus(ks.map((k) => ZP(k)).join("\n"), Zl.zusatzpass);
    assert.deepEqual(bewerte({ runden: 4, zeilen: z(4), hoechste: 3 }), []);
    assert.ok(bewerte({ runden: 4, zeilen: z(4, 5) }).length > 0);
    assert.ok(bewerte({ runden: 5, zeilen: z(4, 4) }).length > 0);
    assert.ok(bewerte({ runden: 5, zeilen: z(4) }).length > 0);
    assert.deepEqual(bewerte({ runden: 5, zeilen: z(5, 4) }), []);
  });
  test("eine ungültige Zeile ist rot und nennt das erwartete Format; bei runden ≤ Cap ist jede Zeile rot", () => {
    const ung = zusatzpassZeilenAus(`${Zl.zusatzpass}: R4 Unbekannt — Entscheidung: X, weil Y`, Zl.zusatzpass);
    assert.match(bewerte({ runden: 4, zeilen: ung }).join("\n"), /keine gültige Zeile \(erwartet: .*Ursache: Zusatzpass, Abnahme-Fix, CI-Fix-Delta, Merge-Delta/);
    assert.match(bewerte({ runden: MAX_REVIEW_PAESSE, zeilen: zusatzpassZeilenAus(ZP(4), Zl.zusatzpass) }).join("\n"), /nur bei runden > 3 zulässig/);
    assert.match(bewerte({ runden: 2, zeilen: zusatzpassZeilenAus(ZP(2), Zl.zusatzpass) }).join("\n"), /nur bei runden > 3 zulässig/);
  });
  test("ohne übergebene Eingaben (null) entfällt die Zeilenprüfung", () => {
    assert.deepEqual(bewerte({ runden: 4, zeilen: null }), []);
  });
});

describe("checkReviewNachweis: Abgleich gegen die Commit-Texte", () => {
  test("K5: runden=4 ohne Zusatzpass-Zeile ist rot, mit gültiger Zeile grün (Runde 3: im Fix-Commit)", () => {
    const review = `runden=4 zusatzpass=1:Entscheidung ${LENSES} verdikt=ok`;
    assert.equal(pruefe(review, "Fix\n\nRunde 1: x\n\nFix\n\nRunde 2: y").ok, false);
    const r = pruefe(review, `Fix\n\nRunde 1: x\n\nFix\n\nRunde 2: y\n\nFix\n\nRunde 3: z\n\n${ZP(4)}`);
    assert.deepEqual(r.fehler, []);
  });
  test("K5: runden=3 bei Commit-Zeile `Runde 3:` ist rot (auch mit CRLF)", () => {
    const r = pruefe(`runden=3 ${LENSES} verdikt=ok`, "Fix\r\n\r\nRunde 3: z\r\n");
    assert.equal(r.ok, false);
    assert.match(r.fehler.join("\n"), /Runde 3:/);
    assert.deepEqual(pruefe(`runden=3 ${LENSES} verdikt=ok`, "Fix\n\nRunde 2: y").fehler, []);
  });
  test("ein Review-Override bleibt grün", () => {
    const r = pruefe(`runden=3 ${LENSES} verdikt=ok`, `Fix\n\nRunde 3: z\n${Zl.reviewOverride}: #1 Revert-PR mit Begründung`);
    assert.equal(r.ok, true);
  });
});
