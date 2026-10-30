/* Wächter für die berichtenden Sicherheits-Workflows (#875): `codeql.yml` und `scorecard.yml`; dazu (#92) `zizmor.yml`
 * (nur `--offline`, kein Token, `security-events: write` nur im Analyse-Job) und `dependency-review.yml` (ohne jedes Schreibrecht).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regeln, darum im geschützten test/harness/ (#1165).
 *
 * Erzwungen wird: minimale Permissions (oben kein `write`, `security-events: write` nur im Job mit `codeql-action/analyze`),
 * Actions per Commit-SHA mit Versionskommentar gepinnt, Scorecard ohne Veröffentlichung (`publish_results: false`, kein PAT,
 * kein `id-token`), keine PR-Trigger bei Scorecard und `persist-credentials: false` am Checkout. Dass kein
 * Jobname einen Required-Check beschattet, erzwingt required-check-shadowing.test.ts für alle Workflows.
 *
 * Gelesen wird mit der `yaml`-Bibliothek (Struktur: Trigger, Permissions, Jobs, Schritte, `with`). Ehrliche Grenzen:
 * (1) Die Pin-Prüfung liest zeilenweise, weil der Versionskommentar im Syntaxbaum nicht steht; sie kennt nur `uses:` in einer
 * Zeile. (2) `secrets.`-Verwendung wird im kommentarbereinigten Text gesucht, nicht strukturell. (3) Pin-Pflicht gilt für jede
 * Workflow-Datei (`PIN_PFLICHT` liest das Verzeichnis). (4) Container-Images brauchen `@sha256:<64 hex>`; der Scan-Umfang ist geschlossen
 * (`docker run|create` in `run`-Blöcken, `container:`, `services.*.image`), alles andere (`docker pull/build/compose`, Images aus
 * Skripten, Variablen als Image) bleibt ungeprüft.
 *
 * Ausführen mit:  npm test
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const lies = (...teile: string[]) => readFileSync(join(ROOT, ...teile), "utf8");

/** Pin-Pflicht gilt für alle Workflows (#78): jede `uses:`-Zeile mit Commit-SHA und Versionskommentar. */
const PIN_PFLICHT = readdirSync(join(ROOT, ".github", "workflows")).filter((f) => /\.ya?ml$/.test(f));

type Obj = Record<string, unknown>;
const istObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

/** Text ohne Kommentarzeilen und Kommentar-Endungen. */
function ohneKommentare(yml: string): string {
  return String(yml ?? "")
    .split(/\r?\n/)
    .map((z) => (/^\s*#/.test(z) ? "" : z.replace(/\s+#.*$/, "")))
    .join("\n");
}

/** Schreibrechte eines `permissions`-Werts: `write-all` oder jede Eigenschaft mit Wert `write`. */
function schreibRechte(p: unknown): string[] {
  if (p === "write-all") return ["write-all"];
  if (!istObj(p)) return [];
  return Object.entries(p).filter(([, v]) => v === "write").map(([k]) => `${k}: write`);
}

/** Alle `uses:`-Zeilen ohne 40-stelligen Commit-SHA samt Versionskommentar (lokale `./`-Actions ausgenommen). */
function ungepinnteUses(yml: string): string[] {
  const out: string[] = [];
  for (const l of String(yml ?? "").split(/\r?\n/)) {
    const m = /^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/.exec(l);
    if (!m || m[1].startsWith("./")) continue;
    if (!/@[0-9a-f]{40}$/.test(m[1]) || !/^\s+#\s*v\d+(\.\d+)*\s*$/.test(m[2])) out.push(l.trim());
  }
  return out;
}

/** Alle Schlüssel eines Syntaxbaums (beliebige Tiefe). */
function schluessel(x: unknown, out: string[] = []): string[] {
  if (Array.isArray(x)) x.forEach((e) => schluessel(e, out));
  else if (istObj(x)) {
    for (const [k, v] of Object.entries(x)) {
      out.push(k);
      schluessel(v, out);
    }
  }
  return out;
}

/** Jeder `actions/checkout@` eines Jobs braucht `persist-credentials: false`. */
function checkoutFehler(name: string, job: Obj): string[] {
  const schritte = Array.isArray(job.steps) ? job.steps.filter(istObj) : [];
  return schritte
    .filter((s) => typeof s.uses === "string" && s.uses.startsWith("actions/checkout@") && !(istObj(s.with) && s.with["persist-credentials"] === false))
    .map(() => `Job ${name}: Checkout ohne persist-credentials: false`);
}

/** Alle Regelverstöße einer Datei als Liste (leer = ok). `art` wählt die dateispezifischen Regeln. */
function pruefe(yml: string, art: "codeql" | "scorecard"): string[] {
  const fehler: string[] = [];
  let wf: unknown;
  try {
    wf = parse(String(yml ?? ""));
  } catch {
    return ["YAML nicht lesbar"];
  }
  if (!istObj(wf)) return ["kein Workflow-Objekt"];
  const on = istObj(wf.on) ? wf.on : {};
  const brauch = art === "codeql" ? ["push", "pull_request", "schedule", "workflow_dispatch"] : ["push", "schedule", "workflow_dispatch"];
  for (const k of brauch) if (!(k in on)) fehler.push(`Trigger ${k} fehlt`);
  const push = on.push;
  if (!(istObj(push) && Array.isArray(push.branches) && push.branches.length === 1 && push.branches[0] === "main")) fehler.push("push-Trigger nicht auf main beschränkt");
  if (wf.permissions === undefined) fehler.push("permissions: auf oberster Ebene fehlt");
  else if (schreibRechte(wf.permissions).length) fehler.push("oberste permissions enthalten write");
  const jobs = istObj(wf.jobs) ? Object.entries(wf.jobs).filter((e): e is [string, Obj] => istObj(e[1])) : [];
  const schritte = (j: Obj): Obj[] => (Array.isArray(j.steps) ? j.steps.filter(istObj) : []);
  const mitAnalyze = (j: Obj) => schritte(j).some((s) => typeof s.uses === "string" && s.uses.startsWith("github/codeql-action/analyze@"));
  const schreibend = jobs.filter(([, j]) => schreibRechte(j.permissions).includes("security-events: write"));
  if (schreibend.length !== 1) fehler.push(`security-events: write in ${schreibend.length} Jobs statt genau einem`);
  for (const [name, j] of jobs) {
    const rechte = schreibRechte(j.permissions).filter((r) => r !== "security-events: write");
    if (rechte.length) fehler.push(`Job ${name}: unerlaubte Schreibrechte (${rechte.join(", ")})`);
    fehler.push(...checkoutFehler(name, j));
  }
  const alleSchluessel = schluessel(wf);
  if (art === "codeql") {
    const sprachen = jobs.flatMap(([, j]) => {
      const m = istObj(j.strategy) && istObj(j.strategy.matrix) ? j.strategy.matrix.language : undefined;
      return Array.isArray(m) ? (m as unknown[]) : [];
    });
    for (const sprache of ["javascript-typescript", "actions"]) if (!sprachen.includes(sprache)) fehler.push(`Matrix ohne ${sprache}`);
    const analyzeJobs = jobs.filter(([, j]) => mitAnalyze(j)).map(([n]) => n);
    if (schreibend.length === 1 && !(analyzeJobs.length === 1 && analyzeJobs[0] === schreibend[0][0])) fehler.push("security-events: write nicht im Job mit analyze");
  } else {
    if ("pull_request" in on || "pull_request_target" in on) fehler.push("Scorecard darf nicht auf PRs laufen");
    const publish = jobs.flatMap(([, j]) => schritte(j)).flatMap((s) => (istObj(s.with) && "publish_results" in s.with ? [s.with.publish_results] : []));
    if (publish.length === 0) fehler.push("publish_results: false fehlt");
    if (publish.some((p) => p !== false && p !== "false")) fehler.push("publish_results ist nicht false");
    if (alleSchluessel.includes("id-token")) fehler.push("id-token verwendet");
    if (alleSchluessel.includes("repo_token")) fehler.push("repo_token verwendet");
    if (/secrets\./.test(ohneKommentare(yml))) fehler.push("secrets.* verwendet");
  }
  for (const u of ungepinnteUses(String(yml ?? ""))) fehler.push(`Action nicht per SHA mit Versionskommentar gepinnt: ${u}`);
  return fehler;
}

const SHA = "0123456789abcdef0123456789abcdef01234567";
const CHECKOUT = `      - uses: actions/checkout@${SHA} # v7.0.1\n        with:\n          persist-credentials: false`;
const ANALYZE = `      - uses: github/codeql-action/analyze@${SHA} # v4.39.0`;
const codeql = (o: { top?: string; job?: string; name?: string; extra?: string; uses?: string; trig?: string; analyze?: string } = {}) =>
  [
    "name: CodeQL",
    "on:",
    o.trig ?? "  push:\n    branches: [main]\n  pull_request:\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:",
    o.top ?? "permissions: {}",
    "jobs:",
    "  analyse:",
    `    name: ${o.name ?? "CodeQL-Analyse (${{ matrix.language }})"}`,
    "    strategy:",
    "      matrix:",
    "        language: [javascript-typescript, actions]",
    "    permissions:",
    o.job ?? "      contents: read\n      security-events: write",
    "    steps:",
    o.uses ?? CHECKOUT,
    o.analyze ?? ANALYZE,
    o.extra ?? "",
  ].join("\n");
const scorecard = (o: { extra?: string; trig?: string; publish?: string; uses?: string; top?: string; job?: string } = {}) =>
  [
    "name: Scorecard",
    "on:",
    o.trig ?? "  push:\n    branches: [main]\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:",
    o.top ?? "permissions: {}",
    "jobs:",
    "  analyse:",
    "    name: Scorecard-Analyse",
    "    permissions:",
    o.job ?? "      security-events: write\n      contents: read",
    "    steps:",
    o.uses ?? CHECKOUT,
    `      - uses: ossf/scorecard-action@${SHA} # v2.5.0`,
    "        with:",
    `          publish_results: ${o.publish ?? "false"}`,
    o.extra ?? "",
  ].join("\n");

describe("echte Dateien", () => {
  for (const [datei, art] of [["codeql.yml", "codeql"], ["scorecard.yml", "scorecard"]] as const) {
    test(`${datei} hält alle Regeln`, () => {
      expect(pruefe(lies(".github", "workflows", datei), art)).toEqual([]);
    });
  }
  test("PIN_PFLICHT: jede Datei der Liste ist komplett gepinnt", () => {
    for (const d of PIN_PFLICHT) expect(ungepinnteUses(lies(".github", "workflows", d)), d).toEqual([]);
  });
});

describe("Fixtures: gültige Grundform", () => {
  test("codeql und scorecard ohne Verstöße", () => {
    expect(pruefe(codeql(), "codeql")).toEqual([]);
    expect(pruefe(scorecard(), "scorecard")).toEqual([]);
  });
});

describe("Negativfälle: jede Regel verfälscht für sich", () => {
  const nur = (f: string[], teil: string) => expect(f, f.join(" | ")).toEqual([expect.stringContaining(teil)]);
  test("security-events: write oben", () => expect(pruefe(codeql({ top: "permissions:\n  security-events: write" }), "codeql")).toContain("oberste permissions enthalten write"));
  test("write-all oben", () => nur(pruefe(codeql({ top: "permissions: write-all" }), "codeql"), "oberste permissions"));
  test("Flow-Style oben: permissions: { contents: write }", () => nur(pruefe(codeql({ top: "permissions: { contents: write }" }), "codeql"), "oberste permissions"));
  test("permissions oben fehlen", () => nur(pruefe(codeql({ top: "" }), "codeql"), "permissions: auf oberster Ebene fehlt"));
  test("zweiter Job mit security-events: write", () => {
    const z = codeql({ extra: "  zweiter:\n    name: CodeQL-Zwei\n    permissions:\n      security-events: write\n    steps: []" });
    expect(pruefe(z, "codeql").some((x) => x.includes("in 2 Jobs"))).toBe(true);
  });
  test("analyze in einem anderen Job als security-events: write", () => {
    const z = codeql({ analyze: "", extra: `  anderer:\n    name: CodeQL-Zwei\n    permissions:\n      contents: read\n    steps:\n${ANALYZE}` });
    nur(pruefe(z, "codeql"), "nicht im Job mit analyze");
  });
  test("anderes Schreibrecht im Analyse-Job", () => nur(pruefe(codeql({ job: "      contents: write\n      security-events: write" }), "codeql"), "unerlaubte Schreibrechte (contents: write)"));
  test("write-all im Job", () => {
    const z = codeql().replace("    permissions:\n      contents: read\n      security-events: write", "    permissions: write-all");
    expect(pruefe(z, "codeql").some((x) => x.includes("unerlaubte Schreibrechte (write-all)"))).toBe(true);
  });
  test("security-events: write fehlt ganz", () => expect(pruefe(codeql({ job: "      contents: read" }), "codeql").some((x) => x.includes("in 0 Jobs"))).toBe(true));
  test("Tag-Pin statt SHA", () => nur(pruefe(codeql({ uses: "      - uses: actions/checkout@v7\n        with:\n          persist-credentials: false" }), "codeql"), "nicht per SHA"));
  test("SHA ohne Versionskommentar", () => nur(pruefe(codeql({ uses: `      - uses: actions/checkout@${SHA}\n        with:\n          persist-credentials: false` }), "codeql"), "nicht per SHA"));
  test("Checkout ohne persist-credentials: false", () => nur(pruefe(codeql({ uses: `      - uses: actions/checkout@${SHA} # v7.0.1` }), "codeql"), "persist-credentials"));
  test.each(["true", "false-ähnlich"])("Checkout mit persist-credentials: %s", (wert) =>
    nur(pruefe(codeql({ uses: `      - uses: actions/checkout@${SHA} # v7.0.1\n        with:\n          persist-credentials: ${wert}` }), "codeql"), "persist-credentials"));
  test("Checkout mit with, aber ohne persist-credentials", () =>
    nur(pruefe(codeql({ uses: `      - uses: actions/checkout@${SHA} # v7.0.1\n        with:\n          fetch-depth: 0` }), "codeql"), "persist-credentials"));
  test.each(["branches: [dev]", "branches: [main, dev]", "tags: [v1]"])("push-Trigger mit %s", (b) =>
    nur(pruefe(codeql({ trig: `  push:\n    ${b}\n  pull_request:\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:` }), "codeql"), "push-Trigger"));
  test("push-Trigger als leeres Objekt", () =>
    nur(pruefe(codeql({ trig: "  push: {}\n  pull_request:\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:" }), "codeql"), "push-Trigger"));
  test.each(["schedule", "workflow_dispatch"])("Scorecard ohne %s", (k) => {
    const alle: Record<string, string> = { schedule: "  schedule:\n    - cron: '1 1 * * 1'", workflow_dispatch: "  workflow_dispatch:" };
    const trig = ["  push:\n    branches: [main]", ...Object.entries(alle).filter(([n]) => n !== k).map(([, v]) => v)].join("\n");
    nur(pruefe(scorecard({ trig }), "scorecard"), `Trigger ${k} fehlt`);
  });
  test("Matrix ohne actions", () => nur(pruefe(codeql().replace("javascript-typescript, actions", "javascript-typescript"), "codeql"), "Matrix ohne actions"));
  test("Matrix ohne javascript-typescript", () => nur(pruefe(codeql().replace("javascript-typescript, actions", "actions"), "codeql"), "Matrix ohne javascript-typescript"));
  test("pull_request-Trigger fehlt bei CodeQL", () => nur(pruefe(codeql({ trig: "  push:\n    branches: [main]\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:" }), "codeql"), "Trigger pull_request fehlt"));
  test("schedule-Trigger fehlt", () => nur(pruefe(codeql({ trig: "  push:\n    branches: [main]\n  pull_request:\n  workflow_dispatch:" }), "codeql"), "Trigger schedule fehlt"));
  test("workflow_dispatch-Trigger fehlt", () => nur(pruefe(codeql({ trig: "  push:\n    branches: [main]\n  pull_request:\n  schedule:\n    - cron: '1 1 * * 1'" }), "codeql"), "Trigger workflow_dispatch fehlt"));
  test("push nicht auf main beschränkt", () => nur(pruefe(codeql({ trig: "  push:\n  pull_request:\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:" }), "codeql"), "push-Trigger"));
  test("Scorecard: publish_results: true", () => nur(pruefe(scorecard({ publish: "true" }), "scorecard"), "publish_results ist nicht false"));
  test("Scorecard: ein Schritt false, ein zweiter true", () => {
    const z = scorecard({ extra: `      - uses: ossf/scorecard-action@${SHA} # v2.5.0\n        with:\n          publish_results: true` });
    nur(pruefe(z, "scorecard"), "publish_results ist nicht false");
  });
  test("Scorecard: publish_results fehlt", () => nur(pruefe(scorecard().replace(/ {10}publish_results: false\n?/, "          x: y\n"), "scorecard"), "publish_results: false fehlt"));
  test("Scorecard: id-token (ohne write, für sich)", () => nur(pruefe(scorecard({ extra: "          id-token: read" }), "scorecard"), "id-token"));
  test("Scorecard: id-token: write in den Job-Permissions", () => expect(pruefe(scorecard({ job: "      security-events: write\n      id-token: write" }), "scorecard")).toContain("id-token verwendet"));
  test("Scorecard: repo_token", () => nur(pruefe(scorecard({ extra: "          repo_token: x" }), "scorecard"), "repo_token"));
  test("Scorecard: secrets.X", () => nur(pruefe(scorecard({ extra: "          t: ${{ secrets.X }}" }), "scorecard"), "secrets"));
  test("Scorecard: pull_request-Trigger", () => nur(pruefe(scorecard({ trig: "  push:\n    branches: [main]\n  pull_request:\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:" }), "scorecard"), "nicht auf PRs"));
  test("Scorecard: pull_request_target-Trigger", () => nur(pruefe(scorecard({ trig: "  push:\n    branches: [main]\n  pull_request_target:\n  schedule:\n    - cron: '1 1 * * 1'\n  workflow_dispatch:" }), "scorecard"), "nicht auf PRs"));
});

describe("Grenzfälle", () => {
  test("leere und kaputte Eingabe wirft nicht und ist fail-closed", () => {
    for (const art of ["codeql", "scorecard"] as const) {
      expect(pruefe("", art).length).toBeGreaterThan(0);
      expect(pruefe(":::\n\t- [", art).length).toBeGreaterThan(0);
      expect(pruefe(undefined as unknown as string, art).length).toBeGreaterThan(0);
    }
  });
  test("CRLF ändert nichts", () => {
    expect(pruefe(codeql().replace(/\n/g, "\r\n"), "codeql")).toEqual([]);
    expect(pruefe(scorecard().replace(/\n/g, "\r\n"), "scorecard")).toEqual([]);
  });
  test("Kommentare mit secrets zählen nicht (die übrigen Schlüssel liest die yaml-Bibliothek ohnehin ohne Kommentare)", () => {
    expect(pruefe(scorecard({ extra: "          # id-token / repo_token / secrets.X" }), "scorecard")).toEqual([]);
    expect(ohneKommentare("a: 1 # secrets.X\n# secrets.Y")).not.toMatch(/secrets/);
  });
  test("lokale Action braucht keinen SHA", () => {
    expect(ungepinnteUses("      - uses: ./.github/actions/x")).toEqual([]);
  });
  test("SHA mit falscher Länge ist ungepinnt", () => {
    expect(ungepinnteUses("      - uses: a/b@0123456789abcdef # v1")).toHaveLength(1);
  });
});

/** Hat der Workflow ein `permissions:` auf oberster Ebene (Objekt oder `{}`)? Ohne gälte der Repo-Standard des Tokens. */
function hatOberstePermissions(yml: string): boolean {
  try {
    const doc: unknown = parse(yml);
    return istObj(doc) && istObj(doc.permissions);
  } catch {
    return false;
  }
}

describe("jeder Workflow hat oberste permissions", () => {
  const dateien = readdirSync(join(ROOT, ".github", "workflows")).filter((f) => /\.ya?ml$/.test(f));
  test("es gibt Workflows", () => expect(dateien.length).toBeGreaterThan(0));
  test.each(dateien)("%s", (datei) => {
    expect(hatOberstePermissions(lies(".github", "workflows", datei)), `${datei}: permissions: auf oberster Ebene fehlt`).toBe(true);
  });
  test("Negativfälle: fehlend, nur im Job, Flow-Skalar, kaputtes YAML", () => {
    expect(hatOberstePermissions("on: push\njobs:\n  a:\n    runs-on: x\n")).toBe(false);
    expect(hatOberstePermissions("on: push\njobs:\n  a:\n    permissions:\n      contents: read\n")).toBe(false);
    expect(hatOberstePermissions("permissions: write-all\njobs: {}\n")).toBe(false);
    expect(hatOberstePermissions("permissions: [\n")).toBe(false);
    expect(hatOberstePermissions("permissions: {}\njobs: {}\n")).toBe(true);
    expect(hatOberstePermissions("permissions:\n  contents: read\n")).toBe(true);
  });
});

/** Docker-Flags, die den nächsten Token als Wert verbrauchen (das Image ist der erste Token, der weder Flag noch Flag-Wert ist). */
const WERT_FLAGS = new Set(["-v", "--volume", "-e", "--env", "--env-file", "-w", "--workdir", "-u", "--user", "--name", "--entrypoint", "-p", "--publish", "--network", "--platform", "--mount", "-l", "--label", "--pull", "-h", "--hostname"]);

/** Image-Referenzen aller `docker run|create`-Aufrufe eines `run`-Blocks (Zeilenfortsetzung `\` und gefaltete Blöcke sind schon ein Text). */
function imagesImRun(run: string): string[] {
  const tokens = run.replace(/\\\r?\n/g, " ").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 2; i++) {
    if (tokens[i] !== "docker" || !["run", "create"].includes(tokens[i + 1])) continue;
    let j = i + 2;
    while (j < tokens.length && tokens[j].startsWith("-")) j += WERT_FLAGS.has(tokens[j]) ? 2 : 1;
    if (j < tokens.length) out.push(tokens[j]);
  }
  return out;
}

/** Alle Container-Images eines Workflows: `docker run|create` in `run`-Blöcken sowie `container:` und `services.*.image` (ohne `@sha256:<64 hex>`: Fund). */
function ungepinnteImages(yml: string): string[] {
  const wf: unknown = parse(String(yml ?? ""));
  const jobs = istObj(wf) && istObj(wf.jobs) ? Object.values(wf.jobs).filter(istObj) : [];
  const bilder: string[] = [];
  for (const j of jobs) {
    if (typeof j.container === "string") bilder.push(j.container);
    else if (istObj(j.container) && typeof j.container.image === "string") bilder.push(j.container.image);
    for (const s of istObj(j.services) ? Object.values(j.services).filter(istObj) : []) if (typeof s.image === "string") bilder.push(s.image);
    for (const st of Array.isArray(j.steps) ? j.steps.filter(istObj) : []) if (typeof st.run === "string") bilder.push(...imagesImRun(st.run));
  }
  return bilder.filter((b) => !/@sha256:[0-9a-f]{64}$/.test(b));
}

describe("Container-Images brauchen einen Digest (#92)", () => {
  // Ehrliche Grenze (Scan-Umfang geschlossen): `docker run|create` in `run`-Blöcken, `container:` und `services.*.image`. Nicht erkannt:
  // `docker pull`/`build`, `docker compose`, Images aus Skripten, Variablen als Image (`$IMAGE`), Flags hinter dem Image.
  const DIGEST = `sha256:${"a".repeat(64)}`;
  const wf = (schritt: string, job = "") => `on: push\npermissions: {}\njobs:\n  a:\n    runs-on: x\n${job}    steps:\n      - run: ${schritt}\n`;
  test("echte Datei secret-scan.yml: Image per Digest", () => {
    const yml = lies(".github", "workflows", "secret-scan.yml");
    expect(imagesImRun(String((parse(yml) as { jobs: { scan: { steps: { run?: string }[] } } }).jobs.scan.steps.find((s) => s.run?.includes("docker run"))?.run))).toHaveLength(1);
    expect(ungepinnteImages(yml)).toEqual([]);
  });
  test("alle PIN_PFLICHT-Workflows ohne ungepinnte Images", () => {
    for (const d of PIN_PFLICHT) expect(ungepinnteImages(lies(".github", "workflows", d)), d).toEqual([]);
  });
  test("Image mit Digest ist ok, auch mit Tag davor und Flags vorher", () => {
    expect(ungepinnteImages(wf(`docker run --rm -v "$PWD:/r" -e A=b ghcr.io/x/y:v1@${DIGEST} git /r`))).toEqual([]);
  });
  test("Negativ: Tag ohne Digest", () => expect(ungepinnteImages(wf("docker run --rm -v \"$PWD:/r\" ghcr.io/x/y:v1 git /r"))).toEqual(["ghcr.io/x/y:v1"]));
  test("Negativ: docker create ohne Digest zählt wie docker run", () => expect(ungepinnteImages(wf("docker create --name c ghcr.io/x/y:v1"))).toEqual(["ghcr.io/x/y:v1"]));
  test("Negativ: Kurzform ohne Registry und ohne Tag", () => expect(ungepinnteImages(wf("docker run --rm alpine echo"))).toEqual(["alpine"]));
  test("Negativ: gefalteter Block mit Zeilenfortsetzung", () => {
    expect(ungepinnteImages(wf("|\n          docker run --rm \\\n            -v a:b \\\n            ghcr.io/x/y:v1 cmd"))).toEqual(["ghcr.io/x/y:v1"]);
  });
  test("Negativ: zu kurzer Digest", () => expect(ungepinnteImages(wf("docker run ghcr.io/x/y@sha256:abc"))).toEqual(["ghcr.io/x/y@sha256:abc"]));
  test("Negativ: container: als Text und als Objekt, services.*.image", () => {
    expect(ungepinnteImages(wf("echo", "    container: node:22\n"))).toEqual(["node:22"]);
    expect(ungepinnteImages(wf("echo", "    container:\n      image: node:22\n"))).toEqual(["node:22"]);
    expect(ungepinnteImages(wf("echo", "    services:\n      db:\n        image: postgres:16\n"))).toEqual(["postgres:16"]);
    expect(ungepinnteImages(wf("echo", `    services:\n      db:\n        image: postgres:16@${DIGEST}\n`))).toEqual([]);
  });
  test("ohne Docker-Aufruf kein Fund", () => expect(ungepinnteImages(wf("echo docker run"))).toEqual([]));
});

/** Alle Schritte aller Jobs eines geparsten Workflows. */
function alleSchritte(wf: Obj): Obj[] {
  const jobs = istObj(wf.jobs) ? Object.values(wf.jobs).filter(istObj) : [];
  return jobs.flatMap((j) => (Array.isArray(j.steps) ? j.steps.filter(istObj) : []));
}

/** Regelverstöße von `zizmor.yml` (leer = ok): offline, ohne Token, Schreibrecht nur im Upload-Job, SARIF-Kategorie `zizmor`. */
function pruefeZizmor(yml: string): string[] {
  const fehler: string[] = [];
  let wf: unknown;
  try {
    wf = parse(String(yml ?? ""));
  } catch {
    return ["YAML nicht lesbar"];
  }
  if (!istObj(wf)) return ["kein Workflow-Objekt"];
  if (wf.permissions === undefined) fehler.push("permissions: auf oberster Ebene fehlt");
  else if (schreibRechte(wf.permissions).length) fehler.push("oberste permissions enthalten write");
  const jobs = istObj(wf.jobs) ? Object.entries(wf.jobs).filter((e): e is [string, Obj] => istObj(e[1])) : [];
  const schritte = (j: Obj): Obj[] => (Array.isArray(j.steps) ? j.steps.filter(istObj) : []);
  const mitUpload = (j: Obj) => schritte(j).some((s) => typeof s.uses === "string" && s.uses.startsWith("github/codeql-action/upload-sarif@"));
  const schreibend = jobs.filter(([, j]) => schreibRechte(j.permissions).includes("security-events: write"));
  if (schreibend.length !== 1) fehler.push(`security-events: write in ${schreibend.length} Jobs statt genau einem`);
  else if (!mitUpload(schreibend[0][1])) fehler.push("security-events: write nicht im Job mit upload-sarif");
  for (const [name, j] of jobs) {
    const rechte = schreibRechte(j.permissions).filter((r) => r !== "security-events: write");
    if (rechte.length) fehler.push(`Job ${name}: unerlaubte Schreibrechte (${rechte.join(", ")})`);
    fehler.push(...checkoutFehler(name, j));
  }
  const zizmorRuns = alleSchritte(wf).flatMap((s) => (typeof s.run === "string" && /zizmor/.test(s.run) ? [s.run] : []));
  if (zizmorRuns.length === 0) fehler.push("kein zizmor-Aufruf");
  for (const r of zizmorRuns) if (!/(^|\s)--offline(\s|$)/.test(r)) fehler.push("zizmor-Aufruf ohne --offline");
  const upload = alleSchritte(wf).filter((s) => typeof s.uses === "string" && s.uses.startsWith("github/codeql-action/upload-sarif@"));
  if (!upload.some((s) => istObj(s.with) && s.with.category === "zizmor")) fehler.push("upload-sarif ohne category: zizmor");
  if (/secrets\.|github\.token|GH_TOKEN|GITHUB_TOKEN/.test(ohneKommentare(yml))) fehler.push("Token an zizmor-Workflow übergeben");
  for (const u of ungepinnteUses(String(yml ?? ""))) fehler.push(`Action nicht per SHA mit Versionskommentar gepinnt: ${u}`);
  return fehler;
}

/** Regelverstöße von `dependency-review.yml` (leer = ok): nur berichtend, ohne jedes Schreibrecht, `fail-on-severity: high`, kein PR-Kommentar. */
function pruefeDepReview(yml: string): string[] {
  const fehler: string[] = [];
  let wf: unknown;
  try {
    wf = parse(String(yml ?? ""));
  } catch {
    return ["YAML nicht lesbar"];
  }
  if (!istObj(wf)) return ["kein Workflow-Objekt"];
  const on = istObj(wf.on) ? wf.on : {};
  if (!("pull_request" in on)) fehler.push("Trigger pull_request fehlt");
  if ("pull_request_target" in on) fehler.push("pull_request_target verwendet");
  if (wf.permissions === undefined) fehler.push("permissions: auf oberster Ebene fehlt");
  const jobs = istObj(wf.jobs) ? Object.entries(wf.jobs).filter((e): e is [string, Obj] => istObj(e[1])) : [];
  for (const r of [wf.permissions, ...jobs.map(([, j]) => j.permissions)]) if (schreibRechte(r).length) fehler.push(`Schreibrecht (${schreibRechte(r).join(", ")})`);
  for (const [name, j] of jobs) fehler.push(...checkoutFehler(name, j));
  const dr = alleSchritte(wf).filter((s) => typeof s.uses === "string" && s.uses.startsWith("actions/dependency-review-action@"));
  if (dr.length === 0) fehler.push("kein dependency-review-action-Schritt");
  for (const s of dr) {
    const w = istObj(s.with) ? s.with : {};
    if (w["fail-on-severity"] !== "high") fehler.push("fail-on-severity ist nicht high");
    if (w["comment-summary-in-pr"] !== undefined && w["comment-summary-in-pr"] !== "never") fehler.push("PR-Kommentar aktiviert");
  }
  for (const u of ungepinnteUses(String(yml ?? ""))) fehler.push(`Action nicht per SHA mit Versionskommentar gepinnt: ${u}`);
  return fehler;
}

describe("zizmor.yml und dependency-review.yml (#92)", () => {
  const D = `sha256:${"b".repeat(64)}`;
  const zizmor = (o: { top?: string; job?: string; run?: string; category?: string; extra?: string; env?: string } = {}) =>
    [
      "on: push",
      o.top ?? "permissions: {}",
      "jobs:",
      "  analyse:",
      "    permissions:",
      o.job ?? "      contents: read\n      security-events: write",
      "    steps:",
      CHECKOUT,
      `      - run: ${o.run ?? `docker run --rm -v "$PWD:/repo" ghcr.io/zizmorcore/zizmor:1@${D} --offline --format sarif .`}`,
      o.env ?? "",
      `      - uses: github/codeql-action/upload-sarif@${SHA} # v4.39.1`,
      `        with:\n          category: ${o.category ?? "zizmor"}`,
      o.extra ?? "",
    ].join("\n");
  const depRev = (o: { top?: string; job?: string; with?: string; trig?: string; checkout?: string } = {}) =>
    [
      `on:\n${o.trig ?? "  pull_request:"}`,
      o.top ?? "permissions: {}",
      "jobs:",
      "  pruefen:",
      "    permissions:",
      o.job ?? "      contents: read",
      "    steps:",
      o.checkout ?? "      - run: echo vorher",
      `      - uses: actions/dependency-review-action@${SHA} # v5.0.0`,
      `        with:\n${o.with ?? "          fail-on-severity: high"}`,
    ].join("\n");
  const nur = (f: string[], teil: string) => expect(f, f.join(" | ")).toEqual([expect.stringContaining(teil)]);

  test("echte Dateien halten alle Regeln", () => {
    expect(pruefeZizmor(lies(".github", "workflows", "zizmor.yml"))).toEqual([]);
    expect(pruefeDepReview(lies(".github", "workflows", "dependency-review.yml"))).toEqual([]);
  });
  test("gültige Grundformen", () => {
    expect(pruefeZizmor(zizmor())).toEqual([]);
    expect(pruefeDepReview(depRev())).toEqual([]);
  });

  test("zizmor: security-events: write in einem zweiten Job", () => {
    const z = zizmor({ extra: "  zweiter:\n    permissions:\n      security-events: write\n    steps: []" });
    expect(pruefeZizmor(z).some((x) => x.includes("in 2 Jobs"))).toBe(true);
  });
  test("zizmor: security-events: write in einem Job ohne upload-sarif", () => {
    const z = zizmor().replace(/ {6}- uses: github\/codeql-action\/upload-sarif@[^\n]*\n {8}with:\n {10}category: zizmor/, "      - run: echo");
    nur(pruefeZizmor(z).filter((x) => !x.includes("category")), "nicht im Job mit upload-sarif");
  });
  test("zizmor: ohne --offline", () => nur(pruefeZizmor(zizmor({ run: `docker run --rm ghcr.io/zizmorcore/zizmor:1@${D} --format sarif .` })), "ohne --offline"));
  test("zizmor: --offline nur als Teilstring zählt nicht", () => nur(pruefeZizmor(zizmor({ run: `docker run --rm ghcr.io/zizmorcore/zizmor:1@${D} --offline-x --format sarif .` })), "ohne --offline"));
  test("zizmor: kein zizmor-Aufruf", () => nur(pruefeZizmor(zizmor({ run: "echo hallo" })), "kein zizmor-Aufruf"));
  test("zizmor: Token an den Lauf", () => nur(pruefeZizmor(zizmor({ env: "        env:\n          GH_TOKEN: ${{ github.token }}" })), "Token"));
  test("zizmor: andere Kategorie", () => nur(pruefeZizmor(zizmor({ category: "x" })), "category: zizmor"));
  test("zizmor: weiteres Schreibrecht und write oben", () => {
    nur(pruefeZizmor(zizmor({ job: "      contents: write\n      security-events: write" })), "unerlaubte Schreibrechte (contents: write)");
    nur(pruefeZizmor(zizmor({ top: "permissions:\n  contents: write" })), "oberste permissions");
  });

  test("Dependency Review: Schreibrecht im Job, oben, write-all", () => {
    nur(pruefeDepReview(depRev({ job: "      contents: read\n      pull-requests: write" })), "Schreibrecht (pull-requests: write)");
    nur(pruefeDepReview(depRev({ top: "permissions: write-all" })), "Schreibrecht (write-all)");
  });
  test("Dependency Review: Checkout ohne persist-credentials: false", () => {
    nur(pruefeDepReview(depRev({ checkout: CHECKOUT.replace("persist-credentials: false", "fetch-depth: 1") })), "Checkout ohne persist-credentials: false");
    expect(pruefeDepReview(depRev({ checkout: CHECKOUT }))).toEqual([]);
  });
  test("Dependency Review: ohne dependency-review-action-Schritt", () => {
    const y = depRev().replace(/ {6}- uses: actions\/dependency-review-action@[^\n]*\n {8}with:\n {10}fail-on-severity: high/, "      - run: echo");
    nur(pruefeDepReview(y), "kein dependency-review-action-Schritt");
  });
  test("Dependency Review: permissions oben fehlen", () => {
    nur(pruefeDepReview(depRev({ top: "name: x" })), "permissions: auf oberster Ebene fehlt");
  });
  test("zizmor: Checkout ohne persist-credentials: false", () => {
    const y = zizmor().replace(CHECKOUT, CHECKOUT.replace("persist-credentials: false", "fetch-depth: 1"));
    nur(pruefeZizmor(y), "Checkout ohne persist-credentials: false");
  });
  test("zizmor: permissions oben fehlen", () => nur(pruefeZizmor(zizmor({ top: "name: x" })), "permissions: auf oberster Ebene fehlt"));
  test("zizmor: kein Job mit security-events: write", () => {
    nur(pruefeZizmor(zizmor({ job: "      contents: read" })), "security-events: write in 0 Jobs statt genau einem");
  });
  test("Dependency Review: security-events: write ist auch hier verboten", () => nur(pruefeDepReview(depRev({ job: "      security-events: write" })), "Schreibrecht"));
  test("Dependency Review: falsche Schwelle, PR-Kommentar", () => {
    nur(pruefeDepReview(depRev({ with: "          fail-on-severity: critical" })), "fail-on-severity");
    nur(pruefeDepReview(depRev({ with: "          fail-on-severity: high\n          comment-summary-in-pr: always" })), "PR-Kommentar");
  });
  test("Dependency Review: pull_request_target statt pull_request", () => {
    const f = pruefeDepReview(depRev({ trig: "  pull_request_target:" }));
    expect(f).toContain("pull_request_target verwendet");
    expect(f).toContain("Trigger pull_request fehlt");
  });
  test("kaputte und leere Eingabe ist fail-closed", () => {
    for (const p of [pruefeZizmor, pruefeDepReview]) {
      expect(p("").length).toBeGreaterThan(0);
      expect(p(":::\n\t- [").length).toBeGreaterThan(0);
    }
  });
});

/* Wächter (#101): Checkout ohne gespeicherte Credentials, Dependabot-Cooldown, Ausnahme für gefährliche Trigger.
 * Grenzen: nur `actions/checkout@` als `uses:` (Struktur per `yaml`), der Cooldown wird nur auf `default-days` geprüft,
 * und die zizmor-Ausnahme am Trigger wird zeilenweise gesucht (Kommentare stehen nicht im Syntaxbaum). */
const WORKFLOW_DATEIEN = readdirSync(join(ROOT, ".github", "workflows")).filter((f) => /\.ya?ml$/.test(f));

/** Checkout-Schritte ohne `with.persist-credentials: false` (Namen als `datei:job`). */
function checkoutOhneSchutz(datei: string, yml: string): string[] {
  const wf: unknown = parse(yml);
  if (!istObj(wf) || !istObj(wf.jobs)) return [`${datei}: keine Jobs`];
  const fehler: string[] = [];
  for (const [job, j] of Object.entries(wf.jobs)) {
    const schritte = istObj(j) && Array.isArray(j.steps) ? j.steps.filter(istObj) : [];
    for (const s of schritte) {
      if (typeof s.uses !== "string" || !s.uses.startsWith("actions/checkout@")) continue;
      if (!istObj(s.with) || s.with["persist-credentials"] !== false) fehler.push(`${datei}:${job}`);
    }
  }
  return fehler;
}

/** `updates[]` ohne `cooldown.default-days` ≥ 1. */
function ohneCooldown(yml: string): string[] {
  const d: unknown = parse(yml);
  const updates: unknown[] = istObj(d) && Array.isArray(d.updates) ? d.updates : [];
  if (updates.length === 0) return ["keine updates"];
  return updates.flatMap((u) => {
    const tage = istObj(u) && istObj(u.cooldown) ? u.cooldown["default-days"] : undefined;
    const name = istObj(u) ? String(u["package-ecosystem"]) : "?";
    return typeof tage === "number" && tage >= 1 ? [] : [name];
  });
}

/** Workflows mit `workflow_run`/`pull_request_target` ohne zizmor-Ausnahme samt Grund am Trigger oder mit `ref:` im Checkout. */
function gefaehrlicherTrigger(datei: string, yml: string): string[] {
  const wf: unknown = parse(yml);
  const on = istObj(wf) ? wf.on : undefined;
  const heikel = istObj(on) ? Object.keys(on).filter((t) => t === "workflow_run" || t === "pull_request_target") : [];
  if (heikel.length === 0) return [];
  const fehler: string[] = [];
  for (const t of heikel) {
    const z = yml.split(/\r?\n/).find((l) => l.startsWith(`  ${t}:`)) ?? "";
    if (!/# zizmor: ignore\[dangerous-triggers\]\s+\S/.test(z)) fehler.push(`${datei}: ${t} ohne zizmor-Ausnahme samt Grund`);
  }
  for (const s of alleSchritte(istObj(wf) ? wf : {})) {
    if (typeof s.uses === "string" && s.uses.startsWith("actions/checkout@") && istObj(s.with) && "ref" in s.with) fehler.push(`${datei}: Checkout mit ref`);
  }
  return fehler;
}

describe("Checkout, Cooldown und gefährliche Trigger (#101)", () => {
  test.each(WORKFLOW_DATEIEN)("%s: jeder Checkout mit persist-credentials: false", (f) => {
    expect(checkoutOhneSchutz(f, lies(".github", "workflows", f))).toEqual([]);
  });
  test.each(WORKFLOW_DATEIEN)("%s: gefährliche Trigger mit Ausnahme samt Grund, ohne ref", (f) => {
    expect(gefaehrlicherTrigger(f, lies(".github", "workflows", f))).toEqual([]);
  });
  test("dependabot.yml: jedes updates[] mit cooldown.default-days >= 1", () => {
    expect(ohneCooldown(lies(".github", "dependabot.yml"))).toEqual([]);
  });
  test("Negativfälle: jede Regel verfälscht für sich", () => {
    const wf = (checkout: string, on = "  push:") => `on:\n${on}\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@${SHA} # v7\n${checkout}`;
    expect(checkoutOhneSchutz("x.yml", wf(""))).toEqual(["x.yml:a"]);
    expect(checkoutOhneSchutz("x.yml", wf("        with:\n          persist-credentials: true"))).toEqual(["x.yml:a"]);
    expect(checkoutOhneSchutz("x.yml", wf("        with:\n          persist-credentials: false"))).toEqual([]);
    expect(checkoutOhneSchutz("x.yml", "on: push")).toEqual(["x.yml: keine Jobs"]);
    expect(ohneCooldown("updates:\n  - package-ecosystem: npm\n")).toEqual(["npm"]);
    expect(ohneCooldown("updates:\n  - package-ecosystem: npm\n    cooldown:\n      default-days: 0\n")).toEqual(["npm"]);
    expect(ohneCooldown("updates:\n  - package-ecosystem: npm\n    cooldown:\n      default-days: 7\n")).toEqual([]);
    expect(ohneCooldown("version: 2")).toEqual(["keine updates"]);
    const ok = "  workflow_run:  # zizmor: ignore[dangerous-triggers] Checkout zieht main\n    workflows: [CI]";
    const sicher = "        with:\n          persist-credentials: false";
    expect(gefaehrlicherTrigger("x.yml", wf(sicher, ok))).toEqual([]);
    expect(gefaehrlicherTrigger("x.yml", wf(sicher, "  workflow_run:\n    workflows: [CI]"))).toEqual(["x.yml: workflow_run ohne zizmor-Ausnahme samt Grund"]);
    expect(gefaehrlicherTrigger("x.yml", wf(sicher, "  pull_request_target:  # zizmor: ignore[dangerous-triggers]"))).toEqual(["x.yml: pull_request_target ohne zizmor-Ausnahme samt Grund"]);
    expect(gefaehrlicherTrigger("x.yml", wf(`${sicher}\n          ref: x`, ok))).toEqual(["x.yml: Checkout mit ref"]);
  });
});
