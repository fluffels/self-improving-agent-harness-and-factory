/* Risikoklasse (factory#333): ein Klassifikator aus Risiko (Pfadmuster) und Größe in scripts/groessenstufe-lib.mjs. Klasse hoch ist nie Stufe S;
 * die Doku-Regel (nur *.md) steht nur dort; die Nachweis-Wächter beziehen sie von dort. Die Wächter laufen gegen ein echtes git-Repo im Temp-Ordner. */
import { afterEach, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libRaw from "../scripts/groessenstufe-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as reviewRaw from "../scripts/check-review-nachweis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as abnahmeRaw from "../scripts/check-abnahme-nachweis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as sliceRaw from "../scripts/slice-override.mjs";
import { echteSprache } from "./support/echte-sprache";
import { FREMD } from "./support/fremd-config";

type Risiko = { muster: string[] | null; quelle: string; fehler?: string[] };
type Klasse = { klasse: "hoch" | "normal" | "doku"; quelle: string; treffer: { pfad: string; muster: string }[]; gruende: string[] };
const lib = libRaw as unknown as {
  RISIKO_STANDARDLISTE: string[];
  istDokuDiff: (p: unknown) => boolean;
  risikoMusterAus: (c: unknown) => Risiko;
  bestimmeRisikoklasse: (p: unknown, r?: Risiko) => Klasse;
  bestimmeGroessenstufe: (o: { eintraege: unknown; muster: string[] | null; prognose?: boolean; risiko?: Risiko }) => { stufe: string; gruende: string[]; risiko: Klasse };
  groessenstufeAusGit: (git: (a: string[]) => string, b: string, h?: string, o?: { ladeMuster?: () => string[]; ladeRisiko?: () => Risiko }) => { stufe: string; gruende: string[]; risiko: Klasse };
};
const STANDARD: Risiko = { muster: lib.RISIKO_STANDARDLISTE, quelle: "Standardliste" };
const klasse = (pfade: unknown, r: Risiko = STANDARD) => lib.bestimmeRisikoklasse(pfade, r);

describe("Standardliste und Muster", () => {
  test("eingefroren, nicht leer, nur Texte, ohne Backslash", () => {
    expect(Object.isFrozen(lib.RISIKO_STANDARDLISTE)).toBe(true);
    expect(lib.RISIKO_STANDARDLISTE.length).toBeGreaterThan(10);
    for (const m of lib.RISIKO_STANDARDLISTE) expect(typeof m === "string" && m.trim() !== "" && !m.includes("\\")).toBe(true);
  });
  test("hoch: Auth-, Krypto-, Persistenz-, Hook-Pfade mit Pfad und Muster im Grund", () => {
    const k = klasse(["src/auth/x.ts"]);
    expect(k.klasse).toBe("hoch");
    expect(k.treffer).toEqual([{ pfad: "src/auth/x.ts", muster: "*auth*" }]);
    expect(k.gruende[0]).toBe("src/auth/x.ts trifft *auth* (Standardliste)");
    for (const p of ["src/db/a.sql", ".github/workflows/ci.yml", ".githooks/pre-push", "keys/server.pem", ".env.local", "src/PasswordForm.ts"]) expect(klasse([p]).klasse, p).toBe("hoch");
  });
  test("jedes Muster der Standardliste trifft einen Beispielpfad (alle Kategorien)", () => {
    const beispiele: Record<string, string> = {
      "/.githooks/": ".githooks/pre-push", "/.claude/hooks/": ".claude/hooks/x.mjs", "/.claude/settings.json": ".claude/settings.json", "/.codex/": ".codex/config.toml", "/.mcp.json": ".mcp.json",
      "/.github/workflows/": ".github/workflows/ci.yml", "*guard*": "scripts/x-guard.mjs", "*auth*": "src/auth.ts", "*login*": "src/login.ts", "*session*": "src/session.ts", "*permission*": "src/permission.ts",
      "*crypt*": "src/crypto.ts", "*secret*": "src/secret.ts", "*credential*": "src/credentials.ts", "*password*": "src/password.ts", ".env*": ".env.local", "*.pem": "k/a.pem", "*.key": "k/a.key",
      "*privacy*": "src/privacy.ts", "*consent*": "src/consent.ts", "*personal*": "src/personal.ts", "*gdpr*": "src/gdpr.ts", "*dsgvo*": "src/dsgvo.ts",
      "*migration*": "src/migration.ts", "*persist*": "src/persist.ts", "*storage*": "src/storage.ts", "*database*": "src/database.ts", "db/": "db/schema.sql",
    };
    expect(Object.keys(beispiele).sort()).toEqual([...lib.RISIKO_STANDARDLISTE].sort());
    for (const [m, pfad] of Object.entries(beispiele)) expect(klasse([pfad], { muster: [m], quelle: "t" }).treffer, m).toEqual([{ pfad, muster: m }]);
  });
  test("Groß-/Kleinschreibung gilt auch für das Muster; ohne risiko-Argument und mit null-Eintrag fail-closed", () => {
    expect(klasse(["src/geheim/x.ts"], { muster: ["/SRC/Geheim/"], quelle: "Projekt-Config" }).klasse).toBe("hoch");
    expect(lib.bestimmeRisikoklasse(["src/a.ts"])).toMatchObject({ klasse: "hoch", quelle: "Standardliste" });
    expect(lib.bestimmeGroessenstufe({ eintraege: [null], muster: ["/x/"], risiko: STANDARD })).toMatchObject({ stufe: "voll", risiko: { klasse: "hoch" } });
  });
  test("Groß-/Kleinschreibung egal; verankertes Muster trifft nur an der Wurzel", () => {
    expect(klasse(["src/AuthService.ts"]).klasse).toBe("hoch");
    expect(klasse(["docs/.github/workflows/x.ts"]).klasse).toBe("normal");
  });
  test("normal ohne Treffer; doku bei reinem *.md auch mit Mustertreffer im Namen; gemischt zählt jeder Pfad", () => {
    expect(klasse(["src/a.ts"])).toMatchObject({ klasse: "normal" });
    expect(klasse(["docs/auth.md"])).toMatchObject({ klasse: "doku", gruende: ["nur *.md"] });
    expect(klasse(["docs/auth.md", "src/a.ts"]).klasse).toBe("hoch");
    expect(klasse(["docs/a.md", "src/a.ts"]).klasse).toBe("normal");
    expect(klasse(["docs/a.md", "src/auth/a.ts"]).klasse).toBe("hoch");
  });
  test("fail-closed hoch: leer, kein Array, Eintrag ohne Pfad, quotierter Pfad, keine Muster (mit Fehlergrund)", () => {
    for (const p of [[], null, undefined, [null], [""], ['"a\\303\\244.ts"']]) expect(klasse(p).klasse, JSON.stringify(p)).toBe("hoch");
    expect(klasse(["src/a.ts"], { muster: null, quelle: "Projekt-Config", fehler: ["kaputt"] })).toMatchObject({ klasse: "hoch", gruende: ["kaputt"] });
    expect(klasse(["src/a.ts"], { muster: [], quelle: "Projekt-Config" }).klasse).toBe("hoch");
  });
});

describe("risikoMusterAus: Config ersetzt die Standardliste", () => {
  test("ohne Block die Standardliste; mit Block nur dessen Muster", () => {
    expect(lib.risikoMusterAus({})).toEqual({ muster: lib.RISIKO_STANDARDLISTE, quelle: "Standardliste" });
    expect(lib.risikoMusterAus(undefined).quelle).toBe("Standardliste");
    const r = lib.risikoMusterAus({ risiko: { hoch: ["/geheim/"] } });
    expect(r).toEqual({ muster: ["/geheim/"], quelle: "Projekt-Config" });
    expect(klasse(["src/auth.ts"], r).klasse).toBe("normal");
    expect(klasse(["geheim/x.ts"], r)).toMatchObject({ klasse: "hoch", quelle: "Projekt-Config" });
  });
  test("ein ungültiger Block schaltet nichts ab: hoch mit den Fehlern", () => {
    for (const schlecht of [{ hoch: [] }, { hoch: [1] }, {}, "x", { hoch: ["a"], extra: 1 }]) {
      const r = lib.risikoMusterAus({ risiko: schlecht });
      expect(r.muster, JSON.stringify(schlecht)).toBeNull();
      expect(klasse(["src/a.ts"], r).klasse).toBe("hoch");
    }
  });
});

describe("ladeRisikoMuster liest die Projekt-Config (pruefen: false)", () => {
  const lade = (inhalt: string) => {
    const d = mkdtempSync(join(tmpdir(), "risiko-cfg-"));
    dirs.push(d);
    const pfad = join(d, "c.json");
    writeFileSync(pfad, inhalt);
    return () => (libRaw as { ladeRisikoMuster: (o: { pfad: string }) => Risiko }).ladeRisikoMuster({ pfad });
  };
  test("mit Block die Config-Muster (auch wenn die Config sonst ungültig ist), ohne Block die Standardliste, kein JSON wirft", () => {
    expect(lade(JSON.stringify({ risiko: { hoch: ["/geheim/"] } }))()).toEqual({ muster: ["/geheim/"], quelle: "Projekt-Config" });
    expect(lade(JSON.stringify({ version: 2 }))()).toEqual({ muster: lib.RISIKO_STANDARDLISTE, quelle: "Standardliste" });
    expect(lade(JSON.stringify({ risiko: { hoch: [] } }))().muster).toBeNull();
    expect(lade("kein json")).toThrow();
  });
});

describe("Größenstufe mit Risikoklasse", () => {
  const MUSTER = ["/src/save/"];
  const stufe = (pfad: string, zeilen = 5) => lib.bestimmeGroessenstufe({ eintraege: [{ pfad, zeilen }], muster: MUSTER, risiko: STANDARD });
  test("K5a: eine Datei, wenige Zeilen unter einem hoch-Muster ist voll mit dem Grund Risikoklasse hoch", () => {
    const r = stufe("src/auth/x.ts");
    expect(r.stufe).toBe("voll");
    expect(r.gruende.join()).toMatch(/Risikoklasse hoch: src\/auth\/x\.ts trifft \*auth\*/);
    expect(r.risiko.klasse).toBe("hoch");
  });
  test("K5b: reiner *.md-Diff mit Mustertreffer im Namen bleibt S und doku", () => {
    expect(stufe("docs/auth.md")).toMatchObject({ stufe: "S", gruende: [], risiko: { klasse: "doku" } });
    expect(stufe("src/a.ts")).toMatchObject({ stufe: "S", risiko: { klasse: "normal" } });
  });
  test("mehrere Treffer: erster Grund plus Zahl der weiteren; frühe Fail-closed-Returns tragen die Klasse", () => {
    const r = lib.bestimmeGroessenstufe({ eintraege: [{ pfad: "a/auth.ts", zeilen: 1 }, { pfad: "b/login.ts", zeilen: 1 }], muster: MUSTER, risiko: STANDARD });
    expect(r.gruende.join()).toMatch(/\(\+1 weitere\)/);
    expect(lib.bestimmeGroessenstufe({ eintraege: [{ pfad: "x", zeilen: 1 }], muster: [], risiko: STANDARD }).risiko.klasse).toBe("normal");
    expect(lib.bestimmeGroessenstufe({ eintraege: [], muster: MUSTER, risiko: STANDARD }).risiko.klasse).toBe("hoch");
  });
  test("ein werfendes ladeRisiko und ein werfendes git sind voll und hoch", () => {
    const wirft = () => {
      throw new Error("kaputt");
    };
    const r = lib.groessenstufeAusGit(() => "1\t0\tsrc/a.ts\n", "B", "H", { ladeMuster: () => ["/x/"], ladeRisiko: wirft });
    expect(r).toMatchObject({ stufe: "voll", risiko: { klasse: "hoch" } });
    expect(r.gruende.join()).toMatch(/Projekt-Config nicht ladbar: kaputt/);
    const g = lib.groessenstufeAusGit(wirft, "B", "H", { ladeMuster: () => ["/x/"], ladeRisiko: () => STANDARD });
    expect(g).toMatchObject({ stufe: "voll", risiko: { klasse: "hoch", gruende: [expect.stringMatching(/git-Fehler/)] } });
    const s = lib.groessenstufeAusGit(() => "1\t0\tsrc/a.ts\n", "B", "H", { ladeMuster: wirft, ladeRisiko: () => STANDARD });
    expect(s.risiko).toMatchObject({ klasse: "hoch", gruende: [expect.stringMatching(/Schutzliste nicht ladbar: kaputt/)] });
  });
});

describe("Doku-Regel nur im Klassifikator", () => {
  const FAELLE: unknown[] = [[], null, undefined, ["a.md"], ["A.MD"], [" a.md "], ["a.md", "b.ts"], [""], [null], ["a.mdx"], ["a.md", ""]];
  test("istDokuDiff: nur Pfade, die auf .md enden; Endung muss am Ende stehen", () => {
    expect(lib.istDokuDiff(["a.md", "b/C.MD", " c.md "])).toBe(true);
    for (const nein of [["a.mdx"], ["a.md.ts"], ["a.md", "b.ts"]]) expect(lib.istDokuDiff(nein), JSON.stringify(nein)).toBe(false);
  });
  test("pflichtLenses folgt istDokuDiff über eine Falltabelle", () => {
    const { pflichtLenses } = reviewRaw as { pflichtLenses: (d: unknown) => string[] };
    for (const f of FAELLE) expect(pflichtLenses(f)[0] === "doku", JSON.stringify(f)).toBe(lib.istDokuDiff(f));
  });
  test("Scan-Wächter: kein anderer Nachweis-Wächter trägt die Regel noch einmal (Regex-Literal auf .md am Ende, endsWith(\".md\"))", () => {
    // Grenze: nur diese geschlossene Liste und nur diese beiden bekannten Schreibweisen.
    const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");
    const dateien = ["scripts/check-review-nachweis.mjs", "scripts/check-abnahme-nachweis.mjs", "scripts/nachweis-lib.mjs", "scripts/groessenstufe.mjs"];
    const regexMd = String.fromCharCode(92) + ".md" + String.fromCharCode(36) + "/";
    const treffer = (text: string) => text.includes(regexMd) || text.includes(".endsWith(\".md\")");
    // Gegenprobe: der Wächter erkennt die frühere Kopie der Regel
    expect(treffer("return dateien.every((d) => /" + regexMd + "i.test(d.trim()));")).toBe(true);
    expect(treffer("x.endsWith(\".md\")")).toBe(true);
    for (const d of dateien) expect(treffer(readFileSync(join(wurzel, d), "utf8")), d).toBe(false);
  });
});

// ── Wächter gegen ein echtes git-Repo ───────────────────────────────────────────
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const PL = FREMD.agenten.planer;
const { commitZeilen } = sliceRaw as unknown as { commitZeilen: (p: string, pl: string) => { plan: string; review: string; abnahme: string } };
const Z = commitZeilen(FREMD.praefixe.commitZeile, PL);

function repo(aenderungen: Record<string, string>, nachweis: string) {
  const dir = mkdtempSync(join(tmpdir(), "risiko-"));
  dirs.push(dir);
  const git = (a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.org", "-c", "commit.gpgsign=false", ...a], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "README.md"), "x\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "basis"]);
  const base = git(["rev-parse", "HEAD"]).trim();
  for (const [pfad, text] of Object.entries(aenderungen)) {
    mkdirSync(dirname(join(dir, pfad)), { recursive: true });
    writeFileSync(join(dir, pfad), text);
  }
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "umsetzung"]);
  const head = git(["rev-parse", "HEAD"]).trim();
  git(["commit", "-q", "--allow-empty", "-m", nachweis.replaceAll("<HEAD>", head)]);
  return { git, base };
}

describe("Wächter rechnen mit der Risikoklasse", () => {
  const review = (aenderungen: Record<string, string>, nachweis: string, ladeRisiko?: () => Risiko) => {
    const { git, base } = repo(aenderungen, nachweis);
    return (reviewRaw as { checkReviewNachweis: (o: unknown) => { ok: boolean; fehler: string[] } }).checkReviewNachweis({ runGit: git, env: { FACTORY_DIFF_BASE: base }, ladeZeilen: () => Z, ladeRisiko });
  };
  const nach = `${Z.plan}: ${PL} — skizze\n${Z.review}: head=<HEAD> runden=1 lenses=kombiniert blocker=kombiniert:0 verdikt=ok`;
  test("Risiko-Pfad mit einer Zeile: kombiniert und skizze sind rot; ohne Treffer in der Config grün", () => {
    const f = review({ "src/auth/a.ts": "x\n" }, nach, () => STANDARD).fehler.join("\n");
    expect(f).toMatch(/gilt nur bei Größenstufe S/);
    expect(f).toMatch(/kombiniert genügt nur bei Größenstufe S/);
    expect(review({ "src/auth/a.ts": "x\n" }, nach, () => ({ muster: ["/geheim/"], quelle: "Projekt-Config" })).fehler).toEqual([]);
  });
  const CONFIG = { repo: FREMD.repo, praefixe: { commitZeile: FREMD.praefixe.commitZeile }, agenten: { planer: PL }, sprache: echteSprache() };
  const abnahme = (aenderungen: Record<string, string>, config: Record<string, unknown>) => {
    const { git, base } = repo(aenderungen, `${Z.plan}: ${PL}\n${Z.review}: head=<HEAD> runden=1 lenses=kombiniert verdikt=ok\n${Z.abnahme}: entfaellt — klein: nichts zu beobachten`);
    return (abnahmeRaw as { checkAbnahmeNachweis: (o: unknown) => { ok: boolean; fehler: string[] } }).checkAbnahmeNachweis({
      runGit: git,
      gh: () => ({ body: "## Akzeptanzkriterien\n1. eins\n2. zwei\n" }),
      env: { FACTORY_DIFF_BASE: base, FACTORY_PR_BODY: "Closes #9" },
      ladeConfig: () => config,
    });
  };
  test("Abnahme: entfaellt — klein mit Risiko-Pfad ist rot, mit CONFIG.risiko.hoch ohne Treffer grün", () => {
    expect(abnahme({ "src/auth/a.ts": "x\n" }, CONFIG).ok).toBe(false);
    expect(abnahme({ "src/auth/a.ts": "x\n" }, { ...CONFIG, risiko: { hoch: ["/geheim/"] } }).fehler).toEqual([]);
  });
});
