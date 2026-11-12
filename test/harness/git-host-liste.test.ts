/* Git-Host-Liste-Wächter (factory#248, ADR 0032).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 * @probe-echte-dateien liest die echte Seite `docs/git-host.md` und die echten Dateien unter scripts/ und .github/workflows/.
 * Die Seite nennt je Fabrik-Teil `hostneutral` oder `GitHub`. Gehalten werden:
 * R1 (Negativfall): eine hostneutral-Zeile nennt keine Datei der GitHub-Menge und keine Workflow-Datei,
 * R2: jede Datei der GitHub-Menge und jeder Workflow steht in einer GitHub-Zeile,
 * R3: jeder genannte Pfad existiert, R4: die Spalte Git-Host hat nur die zwei Werte, R5: die vier Abschnitte gibt es.
 * GitHub-Menge (geschlossene Musterliste): scripts/gh-cli.mjs, Code ohne Kommentarzeilen mit process.env.GITHUB_ / process.env.GH_ /
 * api.github.com, dazu die transitive Hülle über relative Importe mit String-Literal.
 * Bewusste Grenzen: berechnete Importpfade, Kindprozesse anderer Skripte und reine Kommentar- oder Link-Erwähnungen werden nicht erkannt
 * (ein direktes gh außerhalb von gh-cli.mjs verbietet gh-cli.test.ts); Board, Agenten- und Skill-Texte und Dienste (Dependabot,
 * Code-Scanning) sind Handliste ohne Dateiabgleich. Backtick-Token mit .mjs/.cjs lösen unter scripts/ auf, mit .yml unter .github/workflows/, andere sind Prosa. */
import { describe, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const WURZEL = process.cwd();
const SEITE = "docs/git-host.md";
const ABSCHNITTE = ["Gates", "Skripte", "Workflows", "Board"];
const KOPF = "| Teil | Bestandteile | Git-Host | Was GitHub voraussetzt |";
const MARKER = /process\.env\.(GITHUB_|GH_)|api\.github\.com/;

type Zeile = { abschnitt: string; teil: string; host: string; zellen: string[]; text: string };

function skriptDateien(wurzel: string, dir = "scripts"): string[] {
  return readdirSync(join(wurzel, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? skriptDateien(wurzel, `${dir}/${e.name}`) : /\.(mjs|cjs)$/.test(e.name) ? [`${dir}/${e.name}`] : [],
  );
}

function codeOhneKommentar(text: string): string {
  return text.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
}

export function githubMenge(wurzel: string): Set<string> {
  const code = new Map(skriptDateien(wurzel).map((f) => [f, codeOhneKommentar(readFileSync(join(wurzel, f), "utf8"))]));
  const menge = new Set([...code].filter(([f, c]) => f === "scripts/gh-cli.mjs" || MARKER.test(c)).map(([f]) => f));
  const importe = (f: string) =>
    [...(code.get(f) ?? "").matchAll(/(?:from\s+|import\s*\(\s*)["'](\.[^"']+)["']/g)].map((m) =>
      relative(wurzel, resolve(wurzel, dirname(f), m[1])).split("\\").join("/"),
    );
  for (let neu = true; neu; ) {
    neu = false;
    for (const f of code.keys()) {
      if (!menge.has(f) && importe(f).some((i) => menge.has(i))) {
        menge.add(f);
        neu = true;
      }
    }
  }
  return menge;
}

export function zeilen(seite: string): Zeile[] {
  const aus: Zeile[] = [];
  let abschnitt = "";
  for (const l of seite.split("\n")) {
    const h = /^## (.+)$/.exec(l);
    if (h) abschnitt = h[1].trim();
    if (!l.startsWith("|") || l === KOPF || /^\|[-| ]+\|$/.test(l)) continue;
    const zellen = l.split("|").slice(1, -1).map((z) => z.trim());
    aus.push({ abschnitt, teil: zellen[0], host: zellen[2] ?? "", zellen, text: l });
  }
  return aus;
}

export function pfade(z: Zeile): string[] {
  return [...z.text.matchAll(/`([^`\s]+\.(?:mjs|cjs|yml))`/g)].map((m) =>
    m[1].endsWith(".yml") ? `.github/workflows/${m[1]}` : `scripts/${m[1]}`,
  );
}

export function pruefe(seite: string, menge: Set<string>, existiert: (p: string) => boolean, workflows: string[]): string[] {
  const fehler: string[] = [];
  const alle = zeilen(seite);
  for (const a of ABSCHNITTE) {
    if (!new RegExp(`^## ${a}$`, "m").test(seite)) fehler.push(`R5: Abschnitt „${a}“ fehlt`);
  }
  for (const z of alle) {
    if (z.host !== "hostneutral" && z.host !== "GitHub") fehler.push(`R4: ${z.teil}: Git-Host „${z.host}“ ist weder hostneutral noch GitHub`);
    for (const p of pfade(z)) {
      if (!existiert(p)) fehler.push(`R3: ${z.teil}: ${p} existiert nicht`);
      if (z.host === "hostneutral" && (menge.has(p) || workflows.includes(p))) {
        fehler.push(`R1: ${z.teil}: ${p} setzt GitHub voraus, steht aber als hostneutral`);
      }
    }
  }
  const inGitHub = new Set(alle.filter((z) => z.host === "GitHub").flatMap(pfade));
  for (const p of [...menge, ...workflows]) {
    if (!inGitHub.has(p)) fehler.push(`R2: ${p} setzt GitHub voraus und steht in keiner GitHub-Zeile von ${SEITE}`);
  }
  return fehler;
}

const SYNTH_MENGE = new Set(["scripts/a.mjs"]);
const WF = [".github/workflows/x.yml"];
const alleDa = () => true;
const rumpf = (...reihen: string[]) =>
  [...ABSCHNITTE.map((a) => `## ${a}\n\n${KOPF}\n|---|---|---|---|`), ...reihen].join("\n");
const ok = [
  "| Test | `a.mjs` | GitHub | gh |",
  "| Wf | `x.yml` | GitHub | Actions |",
  "| Lokal | `b.mjs` | hostneutral | nichts |",
];

describe("pure Hilfsfunktionen (Negativfälle, synthetisch)", () => {
  test("gültige Seite ergibt keinen Fehler", () => {
    expect(pruefe(rumpf(...ok), SYNTH_MENGE, alleDa, WF)).toEqual([]);
  });
  test("R1: hostneutral-Zeile mit einer GitHub-Datei", () => {
    const f = pruefe(rumpf(...ok, "| Falsch | `a.mjs` | hostneutral | |"), SYNTH_MENGE, alleDa, WF);
    expect(f.join("\n")).toMatch(/R1: Falsch: scripts\/a\.mjs/);
  });
  test("R1: hostneutral-Zeile mit einem Workflow", () => {
    const f = pruefe(rumpf(...ok, "| Falsch | `x.yml` | hostneutral | |"), SYNTH_MENGE, alleDa, WF);
    expect(f.join("\n")).toMatch(/R1: Falsch: \.github\/workflows\/x\.yml/);
  });
  test("R2: GitHub-Datei ohne GitHub-Zeile", () => {
    const f = pruefe(rumpf(ok[1], ok[2]), SYNTH_MENGE, alleDa, WF);
    expect(f).toEqual(["R2: scripts/a.mjs setzt GitHub voraus und steht in keiner GitHub-Zeile von docs/git-host.md"]);
  });
  test("R3: Geister-Pfad", () => {
    const f = pruefe(rumpf(...ok, "| Geist | `weg.mjs` | GitHub | |"), SYNTH_MENGE, (p) => p !== "scripts/weg.mjs", WF);
    expect(f).toEqual(["R3: Geist: scripts/weg.mjs existiert nicht"]);
  });
  test("R4: fremdes Vokabular", () => {
    const f = pruefe(rumpf(...ok, "| Misch | `b.mjs` | teilweise | |"), SYNTH_MENGE, alleDa, WF);
    expect(f.join("\n")).toMatch(/R4: Misch: Git-Host „teilweise“/);
  });
  test("R5: fehlender Abschnitt", () => {
    expect(pruefe(rumpf(...ok).replace("## Board", "## Anderes"), SYNTH_MENGE, alleDa, WF)).toEqual(['R5: Abschnitt „Board“ fehlt']);
  });
});

describe("githubMenge (synthetisches Repo)", () => {
  test("transitiver Import wird erkannt, Marker nur im Kommentar zählt nicht", () => {
    const dir = mkdtempSync(join(tmpdir(), "git-host-"));
    mkdirSync(join(dir, "scripts"));
    const schreibe = (n: string, t: string) => writeFileSync(join(dir, "scripts", n), t);
    schreibe("gh-cli.mjs", "export const gh = 1;\n");
    schreibe("mitte.mjs", 'import { gh } from "./gh-cli.mjs";\n');
    schreibe("aussen.mjs", 'const m = await import("./mitte.mjs");\n');
    schreibe("env.mjs", "const t = process.env.GH_TOKEN;\n");
    schreibe("kommentar.mjs", "// process.env.GITHUB_TOKEN und api.github.com\n/* api.github.com */\nexport const x = 1;\n");
    schreibe("rein.mjs", "export const y = 2;\n");
    expect([...githubMenge(dir)].sort()).toEqual(["scripts/aussen.mjs", "scripts/env.mjs", "scripts/gh-cli.mjs", "scripts/mitte.mjs"]);
  });
});

describe("echte Seite gegen echte Dateien", () => {
  const seite = readFileSync(join(WURZEL, SEITE), "utf8");
  const workflows = readdirSync(join(WURZEL, ".github/workflows")).filter((f) => f.endsWith(".yml")).map((f) => `.github/workflows/${f}`);
  test("docs/git-host.md hält R1 bis R5", () => {
    const fehler = pruefe(seite, githubMenge(WURZEL), (p) => existsSync(join(WURZEL, p)), workflows);
    expect(fehler, `Fix: die Datei in eine GitHub-Zeile von ${SEITE} eintragen (oder aus einer hostneutral-Zeile nehmen)`).toEqual([]);
  });
  test("die Hook-Zeile für umsetzer-abschluss.mjs ist GitHub", () => {
    const z = zeilen(seite).find((r) => pfade(r).includes("scripts/umsetzer-abschluss.mjs"));
    expect(z?.host).toBe("GitHub");
  });
});
