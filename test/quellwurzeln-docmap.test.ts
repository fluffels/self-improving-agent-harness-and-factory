/* check:docmap über Quellwurzeln, Endungsliste und Ordner-Einheit (factory#183). */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { join, relative, sep } from "node:path";
import { fixture } from "./support/tmp-fixture";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawDocmap from "../scripts/check-docmap.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../scripts/projekt-config-lib.mjs";

type Struktur = { quelle: string | string[]; moduldoku: string | null; endungen?: string[]; ohne?: string[]; docmapEinheit?: string };
type Audit = { modules: string[]; ghosts: string[]; orphans: string[] };
const dm = rawDocmap as unknown as {
  collectSrcModules: (root?: string, s?: Struktur | string) => string[];
  auditDocMap: (root: string, s: Struktur) => Audit;
  parseDeepDocMaps: (root: string, s: Struktur) => Set<string>;
  docmapQuellen: (s: object) => { wurzeln: string[]; endungen: string[]; ohne: string[]; einheit: string };
};
const pc = rawPc as unknown as {
  ladeProjektConfig: () => { struktur: Struktur };
  pruefeProjektConfig: (c: unknown) => string[];
};

const WURZEL = fileURLToPath(new URL("../", import.meta.url));

/** Wörtliche Kopie des bisherigen Sammlers (Walk, `.ts` ohne `.d.ts`), als Referenz für „dieselben Module wie vorher“. */
function alteSammlung(rootDir: string, quelle: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile() && ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) out.push(relative(rootDir, abs).split(sep).join("/"));
    }
  };
  walk(join(rootDir, quelle));
  return out.sort();
}

const JAVA = "a/src/main/java";

describe("Negativfälle: ohne neue Schlüssel dieselben Module wie vorher (factory#183)", () => {
  test("die Factory-Config (String, ohne endungen, ohne ohne, ohne Einheit) ergibt auf dem echten Repo die alte Sammlung", () => {
    const struktur = pc.ladeProjektConfig().struktur;
    assert.equal(typeof struktur.quelle, "string");
    const alt = alteSammlung(WURZEL, struktur.quelle as string);
    assert.deepEqual(dm.collectSrcModules(WURZEL, { ...struktur, moduldoku: "x" }), alt);
    const tests = alteSammlung(WURZEL, "test");
    assert.ok(tests.length > 10);
    assert.deepEqual(dm.collectSrcModules(WURZEL, { quelle: "test", moduldoku: "x" }), tests);
  });
  test("gemischtes Fixture mit String-quelle liefert nur .ts ohne .d.ts", () => {
    const d = fixture({ "lib/a.ts": "x", "lib/s/b.ts": "x", "lib/c.d.ts": "x", "lib/d.mjs": "x", "lib/e.js": "x", "lib/F.java": "x", "lib/g.json": "{}" });
    assert.deepEqual(dm.collectSrcModules(d, { quelle: "lib", moduldoku: "doku" }), ["lib/a.ts", "lib/s/b.ts"]);
    assert.deepEqual(dm.collectSrcModules(d, "lib"), alteSammlung(d, "lib"));
  });
});

describe("Java: Quellwurzeln und Endungsliste, Einheit datei", () => {
  const s = (extra: Partial<Struktur> = {}): Struktur => ({ quelle: [JAVA], endungen: [".java"], moduldoku: "doku", ...extra });
  test("eine .java-Datei ohne Tiefendoc-Eintrag ist rot (verwaist), mit Erwähnung grün", () => {
    const d = fixture({ [`${JAVA}/com/x/Foo.java`]: "x", "doku/m.md": "nichts\n" });
    assert.deepEqual(dm.auditDocMap(d, s()).orphans, [`${JAVA}/com/x/Foo.java`]);
    const d2 = fixture({ [`${JAVA}/com/x/Foo.java`]: "x", "doku/m.md": `\`${JAVA}/com/x/Foo.java\`\n` });
    const a = dm.auditDocMap(d2, s());
    assert.deepEqual([a.orphans, a.ghosts], [[], []]);
  });
  test("Geister-Muster nennt dieselben Endungen: fehlende .java ist Geist, nicht gelistete .kt wird ignoriert", () => {
    const d = fixture({ [`${JAVA}/Foo.java`]: "x", "doku/m.md": `\`${JAVA}/Foo.java\` \`${JAVA}/Weg.java\` \`${JAVA}/Foo.kt\`\n` });
    const a = dm.auditDocMap(d, s());
    assert.deepEqual(a.ghosts, [`${JAVA}/Weg.java`]);
    assert.deepEqual(a.orphans, []);
  });
  test("Glob-Wurzel über zwei Module", () => {
    const d = fixture({
      "a/src/main/java/A.java": "x", "b/src/main/java/B.java": "x", "c/src/test/java/C.java": "x",
      "doku/m.md": "`a/src/main/java/A.java` `b/src/main/java/Weg.java`\n",
    });
    const a = dm.auditDocMap(d, s({ quelle: ["*/src/main/java"] }));
    assert.deepEqual(a.modules, ["a/src/main/java/A.java", "b/src/main/java/B.java"]);
    assert.deepEqual(a.orphans, ["b/src/main/java/B.java"]);
    assert.deepEqual(a.ghosts, ["b/src/main/java/Weg.java"]);
  });
  test("ohne: ausgeschlossene Datei ist kein Modul, erwähnt und vorhanden aber kein Geist, erwähnt und fehlend ein Geist", () => {
    const d = fixture({ "lib/x.ts": "x", "lib/x.spec.ts": "x", "doku/m.md": "`lib/x.ts` `lib/x.spec.ts` `lib/y.spec.ts`\n" });
    const a = dm.auditDocMap(d, { quelle: "lib", moduldoku: "doku", ohne: ["**/*.spec.ts"] });
    assert.deepEqual(a.modules, ["lib/x.ts"]);
    assert.deepEqual(a.ghosts, ["lib/y.spec.ts"]);
    assert.deepEqual(a.orphans, []);
  });
  test(".d.ts ist standardmäßig kein Modul, mit ausdrücklicher Endung schon", () => {
    const d = fixture({ "lib/a.ts": "x", "lib/t.d.ts": "x" });
    assert.deepEqual(dm.collectSrcModules(d, { quelle: "lib", moduldoku: "doku" }), ["lib/a.ts"]);
    assert.deepEqual(dm.collectSrcModules(d, { quelle: "lib", moduldoku: "doku", endungen: [".ts", ".d.ts"] }), ["lib/a.ts", "lib/t.d.ts"]);
  });
});

describe("Einheit ordner", () => {
  const s = (extra: Partial<Struktur> = {}): Struktur => ({ quelle: [JAVA], endungen: [".java"], moduldoku: "doku", docmapEinheit: "ordner", ...extra });
  const baum = { [`${JAVA}/com/x/Foo.java`]: "x", [`${JAVA}/com/x/Bar.java`]: "x", [`${JAVA}/com/y/Baz.java`]: "x" };
  test("Module sind die Ordner mit direkter Quelldatei; Oberordner und Wurzel nicht", () => {
    const d = fixture(baum);
    assert.deepEqual(dm.collectSrcModules(d, s()), [`${JAVA}/com/x`, `${JAVA}/com/y`]);
  });
  test("Ordnerpfad mit und ohne End-Slash deckt ab; eine Datei-Erwähnung deckt nicht ab", () => {
    const d = fixture({ ...baum, "doku/m.md": `\`${JAVA}/com/x/\` \`${JAVA}/com/y/Baz.java\`\n` });
    const a = dm.auditDocMap(d, s());
    assert.deepEqual(a.orphans, [`${JAVA}/com/y`]);
    assert.deepEqual(a.ghosts, []);
    const d2 = fixture({ ...baum, "doku/m.md": `\`${JAVA}/com/x\` \`${JAVA}/com/y\`\n` });
    assert.deepEqual(dm.auditDocMap(d2, s()).orphans, []);
  });
  test("Geist: nicht vorhandener Ordner; ein vorhandener Ordner nur mit Unterordnern ist weder Modul noch Geist", () => {
    const d = fixture({ ...baum, "doku/m.md": `\`${JAVA}/com/z\` \`${JAVA}/com\`\n` });
    const a = dm.auditDocMap(d, s());
    assert.deepEqual(a.ghosts, [`${JAVA}/com/z`]);
    assert.ok(!a.modules.includes(`${JAVA}/com`));
  });
  test("ein Ordner nur mit ohne-Dateien ist kein Modul", () => {
    const d = fixture({ [`${JAVA}/t/ATest.java`]: "x", [`${JAVA}/p/A.java`]: "x" });
    assert.deepEqual(dm.collectSrcModules(d, s({ ohne: ["**/*Test.java"] })), [`${JAVA}/p`]);
  });
  test("eine Wurzel mit direkten Dateien ist selbst Modul", () => {
    const d = fixture({ [`${JAVA}/A.java`]: "x" });
    assert.deepEqual(dm.collectSrcModules(d, s()), [JAVA]);
  });
  test("Standard bleibt datei: ohne docmapEinheit sind es Dateien", () => {
    const d = fixture(baum);
    assert.equal(dm.collectSrcModules(d, s({ docmapEinheit: undefined })).length, 3);
  });
});

describe("Scan-Grenzen der Backtick-Pfade", () => {
  test("Doppel-Backtick-Spanne deckt ab; Lauf mit Leerraum ist weder Kandidat noch Geist; Pfad außerhalb der Wurzel zählt nicht", () => {
    const d = fixture({ "lib/a.ts": "x", "lib/b.ts": "x", "doku/m.md": "``lib/a.ts`` und `lib/b.ts oder lib/c.ts` und `libx/d.ts`\n" });
    const a = dm.auditDocMap(d, { quelle: "lib", moduldoku: "doku" });
    assert.deepEqual(a.ghosts, []);
    assert.deepEqual(a.orphans, ["lib/b.ts"]);
    assert.deepEqual([...dm.parseDeepDocMaps(d, { quelle: "lib", moduldoku: "doku" })], ["lib/a.ts"]);
  });
});

describe("Config-Prüfung docmapEinheit", () => {
  const mit = (docmapEinheit?: string) => {
    const c = JSON.parse(JSON.stringify(pc.ladeProjektConfig())) as { struktur: Struktur };
    if (docmapEinheit !== undefined) c.struktur.docmapEinheit = docmapEinheit;
    return c;
  };
  test("ungültiger Wert ist ein Fehler mit Schlüssel; ordner, datei und fehlend sind gültig", () => {
    assert.match(pc.pruefeProjektConfig(mit("paket")).join("\n"), /struktur\.docmapEinheit/);
    for (const w of ["ordner", "datei", undefined]) assert.deepEqual(pc.pruefeProjektConfig(mit(w)), []);
  });
  test("docmapQuellen wirft bei ungültigem Wert mit Fix-Zeile und liefert sonst die Standardwerte", () => {
    assert.throws(() => dm.docmapQuellen({ quelle: "lib", docmapEinheit: "paket" }), /docmapEinheit[\s\S]*Fix:/);
    assert.deepEqual(dm.docmapQuellen({ quelle: "lib" }), { wurzeln: ["lib"], endungen: [".ts"], ohne: [], einheit: "datei" });
  });
});

describe("CLI-Verdrahtung (Kindlauf im Fremdrepo)", { timeout: 60_000 }, () => {
  const fremdrepo = (dateien: Record<string, string>): string => {
    const d = mkdtempSync(join(tmpdir(), "docmap-cli-"));
    cpSync(join(WURZEL, "scripts"), join(d, "scripts"), { recursive: true });
    mkdirSync(join(d, ".factory"));
    const config = { ...pc.ladeProjektConfig(), struktur: { quelle: [JAVA], endungen: [".java"], docmapEinheit: "ordner", moduldoku: "doku" } };
    writeFileSync(join(d, ".factory", "projekt.json"), JSON.stringify(config));
    for (const [rel, inhalt] of Object.entries(dateien)) {
      mkdirSync(join(d, rel, ".."), { recursive: true });
      writeFileSync(join(d, rel), inhalt);
    }
    return d;
  };
  const lauf = (d: string) => {
    const r = spawnSync(process.execPath, [join(d, "scripts", "check-docmap.mjs")], { encoding: "utf8", cwd: d, timeout: 30_000 });
    return { status: r.status, text: `${r.stderr}${r.stdout}` };
  };
  test("ohne Doku Exit 1 mit „Verwaistes Modul“ und Ordnerpfad, mit Doku Exit 0 und „vollständig“", () => {
    const d = fremdrepo({ [`${JAVA}/com/x/Foo.java`]: "x", "doku/m.md": "leer\n" });
    try {
      const rot = lauf(d);
      assert.equal(rot.status, 1, rot.text);
      assert.match(rot.text, /Verwaistes Modul: „a\/src\/main\/java\/com\/x"/);
      writeFileSync(join(d, "doku", "m.md"), `\`${JAVA}/com/x/\`\n`);
      const gruen = lauf(d);
      assert.equal(gruen.status, 0, gruen.text);
      assert.match(gruen.text, /vollständig[\s\S]*Ordner-Einheit/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
