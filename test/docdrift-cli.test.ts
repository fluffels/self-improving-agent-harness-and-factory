/**
 * #101: der CLI-Pfad von `check:docdrift` und die Lücken von `check:docmap` im Temp-Fixture.
 * Die Prüf-Logik deckt test/docdrift.test.ts per Import; hier läuft das Skript als Prozess:
 * Exit 0 sauber, Exit 1 je Fehlerklasse (1)–(7), kaputte Config mit Meldung statt Stacktrace.
 * (`check:docmap` ohne struktur und mit verwaistem Modul deckt test/projekt-config.test.ts ab.)
 */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const SAUBER_README = "# R\n\n`npm run verify`, `npm run typecheck`, `npm test`\n";

/** Fixture-Repo mit kopiertem scripts/ und einer sauberen Doku; `dateien` überschreibt oder ergänzt (Pfad → Text). */
const fixture = (dateien: Record<string, string> = {}): string => {
  const d = mkdtempSync(join(tmpdir(), "docdrift-cli-"));
  temps.push(d);
  cpSync(join(WURZEL, "scripts"), join(d, "scripts"), { recursive: true });
  const pkg = { scripts: { verify: "npm run typecheck && npm test", typecheck: "tsc", test: "vitest" } };
  const alle: Record<string, string> = { "package.json": JSON.stringify(pkg), "README.md": SAUBER_README, ...dateien };
  for (const [pfad, text] of Object.entries(alle)) {
    mkdirSync(dirname(join(d, pfad)), { recursive: true });
    writeFileSync(join(d, pfad), text);
  }
  return d;
};

const lauf = (d: string, skript: string) => {
  const r = spawnSync(process.execPath, [join(d, "scripts", skript)], { encoding: "utf8", cwd: d, timeout: 20_000 });
  return { status: r.status, text: `${r.stderr}${r.stdout}` };
};

describe("check:docdrift als Prozess (#101)", { timeout: 60_000 }, () => {
  test("sauberes Fixture: Exit 0 mit Erfolgszeile", () => {
    const r = lauf(fixture(), "check-docdrift.mjs");
    assert.equal(r.status, 0, r.text);
    assert.match(r.text, /✔ Harness-Doku deckt sich mit dem Code/);
  });

  const FEHLER: [string, Record<string, string>, RegExp][] = [
    ["(1) totes Kommando", { "README.md": `${SAUBER_README}\`npm run weg\`\n` }, /✖ Totes Kommando: „npm run weg"/],
    [
      "(2) undokumentiertes Kern-Skript",
      { "package.json": JSON.stringify({ scripts: { verify: "npm run typecheck && npm test", typecheck: "tsc", test: "vitest", extra: "x" } }) },
      /✖ Undokumentiertes Kern-Skript „extra"/,
    ],
    ["(3) toter Link", { "README.md": `${SAUBER_README}[x](docs/gibt-es-nicht.md)\n` }, /✖ Toter Link: „docs\/gibt-es-nicht\.md"/],
    ["(4) toter Anker", { "README.md": `${SAUBER_README}[x](#gibts-nicht)\n` }, /✖ Toter Anker: „#gibts-nicht"/],
    ["(5) veraltete verify-Kette", { "README.md": `${SAUBER_README}typecheck → lint → test\n` }, /✖ Veraltete verify-Kette in README\.md — überzählige Gates: lint/],
    [
      "(6) ADR-Fortschreibung ohne Zeiger im ADR",
      { "docs/adr/fortschreibungen/0001-5-x.md": "# Fortschreibung #5 (2026-01-01): T\n" },
      /✖ ADR-Fortschreibung: 0001-5-x\.md: 0001-a\.md enthält keinen Zeiger/,
    ],
    ["(7) toter Test-Pfad", { "README.md": `${SAUBER_README}\`test/weg.test.ts\`\n` }, /✖ Toter Test-Pfad: „test\/weg\.test\.ts" in README\.md/],
  ];
  for (const [name, dateien, muster] of FEHLER) {
    test(`${name}: Exit 1 mit Meldung`, () => {
      const r = lauf(fixture({ "docs/adr/0001-a.md": "# ADR 1\n", ...dateien }), "check-docdrift.mjs");
      assert.equal(r.status, 1, r.text);
      assert.match(r.text, muster);
      assert.match(r.text, /Harness-Doku-Drift/);
    });
  }

  test("kaputte scripts/docs-gen/config.json: Exit 1 mit Meldung, kein Stacktrace", () => {
    const r = lauf(fixture({ "scripts/docs-gen/config.json": "{kaputt" }), "check-docdrift.mjs");
    assert.equal(r.status, 1, r.text);
    assert.match(r.text, /✖ .*config\.json/);
    assert.doesNotMatch(r.text, /^\s+at /m);
  });
});

describe("check:docmap als Prozess: Lücken neben projekt-config.test.ts (#101)", { timeout: 60_000 }, () => {
  const echteConfig = JSON.parse(readFileSync(join(WURZEL, ".factory", "projekt.json"), "utf8")) as Record<string, unknown>;
  const mitStruktur = (moduldoku: unknown) =>
    fixture({ ".factory/projekt.json": JSON.stringify({ ...echteConfig, struktur: { quelle: "lib", moduldoku } }), "lib/m.ts": "export {};\n" });

  test("moduldoku null: Exit 0 mit Hinweis, das Gate entfällt", () => {
    const r = lauf(mitStruktur(null), "check-docmap.mjs");
    assert.equal(r.status, 0, r.text);
    assert.match(r.text, /check:docmap entfällt \(struktur\.moduldoku: null\)/);
  });

  test("moduldoku leer: Exit 1 mit ✖, kein Stacktrace", () => {
    const r = lauf(mitStruktur(""), "check-docmap.mjs");
    assert.equal(r.status, 1, r.text);
    assert.match(r.text, /✖ /);
    assert.doesNotMatch(r.text, /^\s+at /m);
  });
});
