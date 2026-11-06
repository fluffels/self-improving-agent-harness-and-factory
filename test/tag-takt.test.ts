import { describe, expect, it } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/tag-takt.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as lib from "../scripts/release-tag-lib.mjs";
import { FREMD } from "./support/fremd-config";

type Commit = { sha: string; datum: string; betreff: string; body: string; dateien: string[]; pr?: string };
type Offen = { number: number; titel: string; assignees: string[]; body?: string };
type Entscheidung = { aktion: string; grund: string; warnungen: string[]; nummer?: number; ausloeser?: string[] };
type Io = Record<string, unknown>;
const T = raw as unknown as {
  TAG_MARKER: string;
  MIN_PRS: number;
  tagTitel: (t: string) => string;
  commitsAusLog: (t: string) => Commit[];
  besitzCommits: (c: Commit[], m: unknown) => Commit[];
  naechsterTag: (t: string, c: Commit[], entfernt?: { datei: string; namen: string[] }[]) => string;
  dringlichSignal: (b: Commit[], k: string) => { grund: string; sha: string } | null;
  bezieherMigrationen: (b: Commit[], k: string) => { pr: string; text: string }[];
  entscheideTagTakt: (a: { letzterTag: string | null; besitz: Commit[]; jetzt: Date; offene: Offen[]; dringlichKey: string; milestones?: { nummer: number; titel: string; closedAt: string }[] }) => Entscheidung;
  bestaetigeTagAnlegen: (e: Entscheidung, a: { zweit: () => unknown }) => Entscheidung;
  ciZustand: (l: unknown) => { zustand: string; url: string | null };
  tagBody: (a: Record<string, unknown>) => string;
  bezieherProbe: (a: { bezieher: string[]; ergebnisse?: Record<string, number | string> }) => { zeilen: string[]; blocker: string[]; offen: string[]; rest: string[] };
  uebernimmHaken: (alt: string | undefined, neu: string) => string;
  lauf: (a: { io: Io; trocken?: boolean }) => number;
};

const { mechanischeSchritte } = lib as { mechanischeSchritte: (quelle: string) => string[] };

const KEY = `${FREMD.praefixe.commitZeile}Sync-Dringlich`;
const MKEY = `${FREMD.praefixe.commitZeile}Bezieher-Migration`;
const JETZT = new Date("2026-06-20T12:00:00Z");
const TAG_MS = 86_400_000;
const MANIFEST = { eintraege: [{ pfad: "scripts/a.mjs", ring: "kern" }, { pfad: "docs/x", ring: "kern" }, { pfad: "scripts/cockpit/c.mjs", ring: "oberflaeche" }] };
const vor = (tage: number) => new Date(JETZT.getTime() - tage * TAG_MS).toISOString();
const commit = (o: Partial<Commit> = {}): Commit => ({ sha: "a".repeat(40), datum: vor(1), betreff: "fix: x (#5)", body: "fix: x (#5)", dateien: ["scripts/a.mjs"], ...o });
const reihe = (n: number, o: Partial<Commit> = {}) => T.besitzCommits(Array.from({ length: n }, (_, i) => commit({ sha: String(i).repeat(40), betreff: `fix: x (#${i + 1})`, ...o })), MANIFEST);
const entscheide = (o: Partial<Parameters<typeof T.entscheideTagTakt>[0]> = {}) => T.entscheideTagTakt({ letzterTag: "v1.2.3", besitz: reihe(1), jetzt: JETZT, offene: [], dringlichKey: KEY, ...o });
const tagOffen = (o: Partial<Offen> = {}): Offen => ({ number: 40, titel: "🏷️ Tag v1.2.4 setzen und syncen", assignees: [], body: "alt", ...o });

describe("factory#215 L4: uebernimmHaken", () => {
  const neu = ["Kopf", "- [ ] Eins", "- [ ] Zwei geändert", "* [ ] Drei", "  - [ ] Vier", "- [x] Fünf neu schon erledigt", "Text [ ] Eins"].join("\n");
  it("übernimmt [x] und [X] (auch * und Einrückung); geänderter Text und Nicht-Checklistenzeilen bleiben", () => {
    const alt = ["- [x] Eins", "- [ ] Zwei", "* [X] Drei", "- [x] Vier", "- [ ] Fünf neu schon erledigt"].join("\n");
    expect(T.uebernimmHaken(alt, neu)).toBe(["Kopf", "- [x] Eins", "- [ ] Zwei geändert", "* [x] Drei", "  - [x] Vier", "- [x] Fünf neu schon erledigt", "Text [ ] Eins"].join("\n"));
  });
  it("Negativ: ein offenes [ ] im alten Body setzt keinen Haken; ohne alten Body bleibt alles", () => {
    expect(T.uebernimmHaken("- [ ] Eins", neu)).toBe(neu);
    expect(T.uebernimmHaken(undefined, neu)).toBe(neu);
    expect(T.uebernimmHaken("- [x] Eins\r\n", "- [ ] Eins")).toBe("- [x] Eins");
  });
});

describe("Parser und Besitz-Filter", () => {
  it("parst Commits mit Betreff, Body und Dateiliste (Leerzeilen, mehrere Commits)", () => {
    const log = `\x1e${"1".repeat(40)}\x1f2026-06-01T10:00:00+00:00\x1ffeat: a (#7)\n\n* Zeile\n\x1f\n\nscripts/a.mjs\ndocs/x/y.md\n\x1e${"2".repeat(40)}\x1f2026-06-02T10:00:00+00:00\x1ffix: b\n\x1f\n\nREADME.md\n`;
    const c = T.commitsAusLog(log);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ sha: "1".repeat(40), datum: "2026-06-01T10:00:00+00:00", betreff: "feat: a (#7)", dateien: ["scripts/a.mjs", "docs/x/y.md"] });
    expect(c[0].body).toContain("* Zeile");
    expect(c[1].dateien).toEqual(["README.md"]);
    expect(T.commitsAusLog("")).toEqual([]);
  });
  it.each([
    ["Kern-Pfad zählt", ["scripts/a.mjs"], 1],
    ["Verzeichnis-Eintrag zählt für Dateien darunter", ["docs/x/y.md"], 1],
    ["Manifest selbst zählt", [".factory/besitz.json"], 1],
    ["Ring oberflaeche zählt nicht", ["scripts/cockpit/c.mjs"], 0],
    ["Fremdpfad zählt nicht", ["src/app.ts"], 0],
    ["Präfix-Namensvetter zählt nicht", ["docs/xx/y.md"], 0],
  ])("%s", (_n, dateien, erwartet) => {
    expect(T.besitzCommits([commit({ dateien })], MANIFEST)).toHaveLength(erwartet);
  });
  it("PR-Nummer = letztes (#N) im Betreff, sonst Kurz-SHA", () => {
    const [a, b] = T.besitzCommits([commit({ betreff: "feat: x (#4) (#9)" }), commit({ betreff: "direkt", sha: "abcdef0123" })], MANIFEST);
    expect([a.pr, b.pr]).toEqual(["#9", "abcdef0"]);
  });
});

describe("Versionsvorschlag", () => {
  it.each([
    ["v1.2.3", [commit({ betreff: "fix: a" })], "v1.2.4"],
    ["v1.2.3", [commit({ betreff: "fix: a" }), commit({ betreff: "feat(x): b" })], "v1.3.0"],
    ["v1.2.3", [commit({ betreff: "feat: b" }), commit({ betreff: "refactor(x)!: c" })], "v2.0.0"],
    ["1.2.3", [commit({ betreff: "fix: a", body: "fix: a\n\nBREAKING CHANGE: weg" })], "2.0.0"],
    ["1.2.3", [commit({ betreff: "chore: a" })], "1.2.4"],
    ["v0.6.0", [commit({ betreff: "feat!: a" })], "v0.7.0"],
    ["v0.6.0", [commit({ betreff: "fix: a", body: "fix: a\n\nBREAKING CHANGE: weg" })], "v0.7.0"],
    ["v0.6.3", [commit({ betreff: "feat!: a" })], "v0.7.0"],
    ["v0.6.3", [commit({ betreff: "fix: a" })], "v0.6.4"],
  ])("%s mit Commits → %s", (tag, commits, erwartet) => {
    expect(T.naechsterTag(tag, commits)).toBe(erwartet);
  });
});

describe("Schwellen", () => {
  it.each([
    ["2 PRs, 1 Tag alt", reihe(2), "nichts"],
    ["3 PRs", reihe(3), "anlegen"],
    ["1 PR, genau 7,0 Tage", reihe(1, { datum: vor(7) }), "nichts"],
    ["1 PR, 7 Tage und 1 ms", reihe(1, { datum: new Date(JETZT.getTime() - 7 * TAG_MS - 1).toISOString() }), "anlegen"],
    ["Negativfall: 2 PRs, 6 Tage, nicht dringlich", reihe(2, { datum: vor(6) }), "nichts"],
    ["Dringlich mit Grund", reihe(1, { body: `fix: x\n\n${KEY}: Sicherheitsfix` }), "anlegen"],
    ["Dringlich ohne Grund", reihe(1, { body: `fix: x\n\n${KEY}:   ` }), "nichts"],
    ["Dringlich in Nicht-Besitz-Commit", T.besitzCommits([commit({ body: `fix: x\n\n${KEY}: Grund`, dateien: ["src/app.ts"] }), commit()], MANIFEST), "nichts"],
    ["keine Besitz-PRs", [], "nichts"],
  ])("%s → %s", (_n, besitz, aktion) => {
    expect(entscheide({ besitz }).aktion).toBe(aktion);
  });
  it("nennt den Dringlich-Grund im Auslöser und liest die Zeile mit GitHub-Stern-Präfix", () => {
    expect(T.dringlichSignal([commit({ body: `feat: x\n\n* ${KEY}: Lücke` })], KEY)).toEqual({ grund: "Lücke", sha: "a".repeat(40) });
    expect(entscheide({ besitz: reihe(1, { body: `fix: x\n\n${KEY}: Lücke` }) }).ausloeser?.[0]).toContain("Dringlich: Lücke");
  });
  it("factory#162 L24: die Zahl-Schwelle ist die gemessene (Median der Besitz-PRs je Tag-Abstand 2,5, aufgerundet 3), nie unter dem Boden 3; der Auslöser nennt sie", () => {
    expect(T.MIN_PRS).toBe(3);
    expect(entscheide({ besitz: reihe(T.MIN_PRS) }).ausloeser?.[0]).toContain(`(ab ${T.MIN_PRS})`);
    expect(entscheide({ besitz: reihe(T.MIN_PRS - 1) }).aktion).toBe("nichts");
  });
  it("ohne Release-Tag entsteht nichts", () => {
    expect(entscheide({ letzterTag: null, besitz: reihe(5) }).aktion).toBe("nichts");
  });
});

describe("Milestone-Auslöser (factory#194)", () => {
  const ms = (titel = "Erste Stufe", closedAt = "2026-06-19T00:00:00Z") => ({ nummer: 1, titel, closedAt });
  it("ein seit dem Tag geschlossener Milestone löst das Anlegen schon bei 1 Besitz-PR aus und steht im Auslöser", () => {
    const e = entscheide({ besitz: reihe(1), milestones: [ms()] });
    expect(e.aktion).toBe("anlegen");
    expect(e.ausloeser).toEqual(["Milestone „Erste Stufe“ geschlossen"]);
  });
  it("mehrere geschlossene Milestones ergeben je einen Auslöser, in der übergebenen Reihenfolge", () => {
    const e = entscheide({ besitz: reihe(1), milestones: [ms("Eins"), ms("Zwei")] });
    expect(e.ausloeser).toEqual(["Milestone „Eins“ geschlossen", "Milestone „Zwei“ geschlossen"]);
  });
  it("Titel mit | und Zeilenumbruch wird bereinigt", () => {
    expect(entscheide({ besitz: reihe(1), milestones: [ms("A|B\nC")] }).ausloeser?.[0]).toBe("Milestone „A B C“ geschlossen");
  });
  it("Steuerzeichen im Titel werden zu Leerzeichen und der Titel wird auf 80 Zeichen gekürzt (Auslöser und Grund)", () => {
    expect(entscheide({ besitz: reihe(1), milestones: [ms("A\u0000B\tC\u007fD")] }).ausloeser?.[0]).toBe("Milestone „A B C D“ geschlossen");
    const lang = entscheide({ besitz: reihe(1), milestones: [ms("x".repeat(100))] }).ausloeser?.[0] ?? "";
    expect(lang).toBe(`Milestone „${"x".repeat(79)}…“ geschlossen`);
    expect(entscheide({ besitz: [], milestones: [ms("A\u0000B")] }).grund).toContain("Milestone „A B“");
    expect(entscheide({ besitz: [], milestones: [ms("x".repeat(100))] }).grund).toContain(`„${"x".repeat(79)}…“`);
  });
  it("ohne Besitz-PRs entsteht nichts, der Grund nennt Milestone und den Tag", () => {
    const e = entscheide({ besitz: [], milestones: [ms()] });
    expect(e.aktion).toBe("nichts");
    expect(e.grund).toContain("Milestone „Erste Stufe“");
    expect(e.grund).toContain("nichts Ungetaggtes seit v1.2.3");
  });
  it("offenes ungeclaimtes Ticket wird aktualisiert, ein geclaimtes bleibt unberührt, nie ein zweites", () => {
    expect(entscheide({ besitz: reihe(1), milestones: [ms()], offene: [tagOffen()] })).toMatchObject({ aktion: "aktualisieren", nummer: 40 });
    expect(entscheide({ besitz: reihe(1), milestones: [ms()], offene: [tagOffen({ assignees: ["x"] })] }).aktion).toBe("nichts");
  });
  it("Negativfall: ohne Parameter, mit leerer Liste gilt dieselbe Entscheidung wie bisher", () => {
    for (const besitz of [reihe(1), reihe(3)]) {
      const ohne = entscheide({ besitz });
      expect(entscheide({ besitz, milestones: [] })).toEqual(ohne);
    }
    expect(entscheide({ besitz: reihe(1), milestones: [] }).aktion).toBe("nichts");
  });
});

describe("Duplikate und Schließen", () => {
  it("offenes ungeclaimtes Ticket wird aktualisiert, nie ein zweites angelegt", () => {
    expect(entscheide({ besitz: reihe(5), offene: [tagOffen()] })).toMatchObject({ aktion: "aktualisieren", nummer: 40 });
    expect(entscheide({ besitz: reihe(1), offene: [tagOffen()] }).aktion).toBe("aktualisieren");
  });
  it("geclaimtes Ticket bleibt unberührt, auch ohne Besitz-PRs", () => {
    expect(entscheide({ besitz: reihe(5), offene: [tagOffen({ assignees: ["x"] })] }).aktion).toBe("nichts");
    expect(entscheide({ besitz: [], offene: [tagOffen({ assignees: ["x"] })] }).aktion).toBe("nichts");
  });
  it("ohne Besitz-PRs wird ein ungeclaimtes Ticket geschlossen", () => {
    expect(entscheide({ besitz: [], offene: [tagOffen()] })).toMatchObject({ aktion: "schliessen", nummer: 40 });
  });
  it("zwei offene Tickets: Warnung, das älteste gilt, keine Selbst-Schließung", () => {
    const zwei = [tagOffen({ number: 50 }), tagOffen({ number: 40 })];
    const e = entscheide({ besitz: reihe(4), offene: zwei });
    expect(e).toMatchObject({ aktion: "aktualisieren", nummer: 40 });
    expect(e.warnungen[0]).toContain("#40");
    expect(entscheide({ besitz: [], offene: zwei }).aktion).toBe("nichts");
  });
  it("Fremdtitel gelten nicht als Tag-Ticket", () => {
    expect(entscheide({ besitz: reihe(5), offene: [tagOffen({ titel: "Anderes Ticket" })] }).aktion).toBe("anlegen");
  });
  it("Zweitabfrage: frisches Tag-Ticket oder ein Fehler verhindern das Anlegen (fail-closed)", () => {
    const anlegen = entscheide({ besitz: reihe(4) });
    expect(T.bestaetigeTagAnlegen(anlegen, { zweit: () => [] })).toBe(anlegen);
    expect(T.bestaetigeTagAnlegen(anlegen, { zweit: () => [{ number: 9, titel: T.tagTitel("v1.2.4") }] }).aktion).toBe("nichts");
    expect(T.bestaetigeTagAnlegen(anlegen, { zweit: () => { throw new Error("netz"); } }).aktion).toBe("nichts");
    const nichts = entscheide();
    expect(T.bestaetigeTagAnlegen(nichts, { zweit: () => { throw new Error("nie gefragt"); } })).toBe(nichts);
  });
});

describe("CI-Zustand und Body", () => {
  it.each([
    [[{ path: ".github/workflows/ci.yml", status: "completed", conclusion: "success", html_url: "u" }], "gruen"],
    [[{ path: ".github/workflows/ci.yml", status: "completed", conclusion: "failure" }], "rot"],
    [[{ path: ".github/workflows/ci.yml", status: "in_progress", conclusion: null }], "laeuft"],
    [[{ path: ".github/workflows/andere.yml", status: "completed", conclusion: "success" }], "unbekannt"],
    [null, "unbekannt"],
  ])("%j → %s", (laeufe, zustand) => {
    expect(T.ciZustand(laeufe).zustand).toBe(zustand);
  });
  const body = T.tagBody({ tag: "v1.3.0", letzterTag: "v1.2.3", sha: "b".repeat(40), prs: reihe(3), aeltestes: { datum: vor(2), sha: "c".repeat(40) }, ausloeser: ["3 Besitz-PRs"], ci: { zustand: "gruen", url: "https://example.invalid/run/1" } });
  it("nennt PRs, CI-Status, fertigen Tag-Befehl und die Checkliste samt Grenze", () => {
    for (const teil of ["#1 fix: x", "#3 fix: x", "CI-Status dieses Commits: grün", "https://example.invalid/run/1", `git -C .claude/worktrees/tag-v1.3.0 tag -a v1.3.0 ${"b".repeat(40)}`, "git -C .claude/worktrees/tag-v1.3.0 push origin v1.3.0", "Trockenlauf gegen den Probe-Erstbezug", "Bezieher holen das Update selbst", "sobald der Tag gepusht ist", "ja, taggen", "Die Fabrik schreibt in kein Bezieher-Repo (ADR 0031)", "--tag v1.3.0"]) {
      expect(body, teil).toContain(teil);
    }
    expect(T.tagTitel("v1.3.0")).toBe("🏷️ Tag v1.3.0 setzen und syncen");
    expect(T.tagTitel("v1.3.0").startsWith(T.TAG_MARKER)).toBe(true);
  });
  it("L5: Tag-Befehl aus einem Worktree auf dem Commit, mit Hook-Hinweis und Aufräumen", () => {
    const sha = "b".repeat(40);
    const block = body.slice(body.indexOf("```") + 3, body.indexOf("```", body.indexOf("```") + 3)).split("\n").filter(Boolean);
    const wt = ".claude/worktrees/tag-v1.3.0";
    expect(block).toEqual(["git fetch origin --tags", `gh run list --commit ${sha} --workflow ci.yml`, `git worktree add --detach ${wt} ${sha}`, `git -C ${wt} tag -a v1.3.0 ${sha} -m "v1.3.0"`, `git -C ${wt} push origin v1.3.0`, `git worktree remove ${wt}`]);
    expect(body).toContain("Der Hook blockiert `git tag` und `git push <tag>` im geteilten Hauptcheckout");
    expect(body).not.toMatch(/^git tag -a/m);
  });
  it("factory#215 L6: die Checkliste verlangt die Sichtung der Rückmeldungen fremder Bezieher (Meldestelle) vor dem Schließen, mit und ohne Bezieher-Liste", () => {
    const zeile = "- [ ] Rückmeldungen fremder Bezieher seit dem letzten Tag (Meldestelle) gesichtet: je Auffälligkeit eine Sammelticket-Zeile „Gate-Lücke: …“";
    for (const b of [body, T.tagBody({ tag: "v1.3.0", letzterTag: "v1.2.3", sha: "b".repeat(40), prs: reihe(3), aeltestes: { datum: vor(2), sha: "c".repeat(40) }, ausloeser: ["x"], ci: { zustand: "gruen", url: null }, bezieher: ["o/a"] })]) {
      const zeilen = b.split("\n");
      const i = zeilen.indexOf(zeile);
      expect(i).toBeGreaterThan(-1);
      expect(i).toBeLessThan(zeilen.findIndex((z) => z.startsWith("- [ ] Ticket schließen")));
      expect(i).toBeGreaterThan(zeilen.findIndex((z) => z.startsWith("- [ ] Tag ")));
    }
  });
  it("factory#162 L26: Trockenlauf gegen den Probe-Erstbezug im Scratch, nie ein Bezieher-Repo, mit --ziel", () => {
    const punkt = body.split("\n").find((z) => z.startsWith("- [ ] Trockenlauf")) ?? "";
    for (const teil of ["Probe-Erstbezug", "test/fixtures/projekt-probe.json", "Export im Scratch", "nie ein Bezieher-Repo", "--ziel <scratch-ordner> --entwurf --trocken", "--quelle <checkout auf bbbbbbb>"]) {
      expect(punkt, teil).toContain(teil);
    }
    // factory#177: ein Ziel ohne Kern-Marker in AGENTS.md ist kein Erstbezug, den die Probe aussagekräftig prüft
    expect(punkt).toContain("AGENTS.md mit den Kern-Markern <!-- factory-besitz:start kern --> und <!-- factory-besitz:ende kern -->");
    expect(punkt).not.toContain("gh repo clone");
  });
  it("factory#162 L26: kein Schritt der Fabrik schreibt in ein Bezieher-Repo (kein Sync-PR, kein Bezieher-Trockenlauf, kein --repo)", () => {
    for (const verboten of ["Sync-PR je Bezieher", "gh repo clone <bezieher>", "--repo <bezieher>", "gh workflow run", "Cross-Repo-Token", "Issue ins Bezieher-Repo"]) {
      expect(body, verboten).not.toContain(verboten);
    }
  });
  describe("factory#188: Vor-Tag-Probe je Bezieher (nur lesend, Klon im Scratch)", () => {
    const mitBezieher = T.tagBody({ tag: "v1.3.0", letzterTag: "v1.2.3", sha: "b".repeat(40), prs: reihe(3), aeltestes: { datum: vor(2), sha: "c".repeat(40) }, ausloeser: ["3 Besitz-PRs"], ci: { zustand: "gruen", url: null }, bezieher: ["o/a", "o/b"] });
    it("ohne Bezieher-Liste kein Probe-Block, mit Liste je Bezieher eine offene Zeile vor „ja, taggen“", () => {
      expect(body).not.toContain("Vor-Tag-Probe");
      expect(body).not.toContain("Keine Bezieher gelistet");
      expect(mitBezieher).not.toContain("Keine Bezieher gelistet");
      const zeilen = mitBezieher.split("\n");
      const probe = zeilen.findIndex((z) => z.includes("`o/a`: Probe ausstehend"));
      expect(probe).toBeGreaterThan(-1);
      expect(zeilen.findIndex((z) => z.includes("`o/b`: Probe ausstehend"))).toBeGreaterThan(probe);
      expect(zeilen.findIndex((z) => z.startsWith("- [ ] Pre-Flight „ja, taggen“"))).toBeGreaterThan(probe);
    });
    it("beschreibt den lesenden Ablauf: Klon im Scratch ohne origin, lokaler Tag, Entwurfs-Vorschau, Sync mit --tag, install und verify, Ergebnis-Befehl", () => {
      const block = mitBezieher.slice(mitBezieher.indexOf("Vor-Tag-Probe"), mitBezieher.indexOf("Checkliste:"));
      // factory#177: der Klon `quelle` steht per Detach auf dem Commit (sonst fehlt der Tag-Stand im Arbeitsbaum), und `verify` bräche nach dem ersten Rot ab
      const zeilen = block.split("\n");
      expect(zeilen).toContain("git -C <s>/quelle tag v1.3.0 " + "b".repeat(40));
      expect(zeilen).toContain("git -C <s>/quelle checkout --detach " + "b".repeat(40));
      expect(zeilen.indexOf("git -C <s>/quelle checkout --detach " + "b".repeat(40))).toBeGreaterThan(zeilen.indexOf("git -C <s>/quelle tag v1.3.0 " + "b".repeat(40)));
      expect(block).not.toMatch(/gate-befehl\.mjs verify(?!Kompakt)/);
      expect(block).toContain("fährt jeden Schritt auch nach einem Rot");
      for (const teil of ["rot heißt: nicht taggen", "nur lesend", "Klon im Scratch", "git clone --depth 1 https://github.com/<owner/name>.git", "remote remove origin", "tag v1.3.0 " + "b".repeat(40), "--entwurf --trocken", "--tag v1.3.0", "node scripts/gate-befehl.mjs install", "npm run lint:prune", "node scripts/projektwerte.mjs --write", "npm run docs:gen", "npm run check:factorylinks -- --schreiben", "node scripts/gate-befehl.mjs verifyKompakt", "kein Rot durch Factory-Besitz", "Befund bzw. eine Bezieher-Migration", "node scripts/tag-takt.mjs --probe"]) {
        expect(block, teil).toContain(teil);
      }
    });
    it("factory#215 L2: die Probe-Befehle sind genau die mechanischen Update-Schritte in Reihenfolge (zwischen install und verify), der Erklärsatz nennt sie", () => {
      const mechanisch = mechanischeSchritte("<s>/quelle");
      expect(mechanisch).toHaveLength(4);
      expect(mitBezieher).toContain("cd <s>/bezieher && node scripts/gate-befehl.mjs install && " + mechanisch.join(" && ") + " && node scripts/gate-befehl.mjs verify\n");
      for (const befehl of mechanisch) expect(mitBezieher.split("aussagekräftig")[0], befehl).toContain("`" + befehl + "`");
    });
    it("Negativ: die Probe schreibt nie in einen Bezieher (kein push, kein PR, kein --repo, kein Issue) und ist von der Checkliste der Fabrik-Grenze gedeckt", () => {
      const block = mitBezieher.slice(mitBezieher.indexOf("Vor-Tag-Probe"), mitBezieher.indexOf("Checkliste:"));
      for (const verboten of ["git push", "gh pr create", "--repo", "gh issue", "gh workflow run", "Cross-Repo-Token"]) expect(block, verboten).not.toContain(verboten);
      expect(mitBezieher).toContain("Die Fabrik schreibt in kein Bezieher-Repo (ADR 0031)");
    });
    it("bezieherProbe ohne Ergebnisse: je Bezieher ausstehend, beide offen, kein Blocker", () => {
      const r = T.bezieherProbe({ bezieher: ["o/a", "o/b"] });
      expect(r.zeilen).toEqual(["- [ ] `o/a`: Probe ausstehend (nicht taggen, bis sie grün ist)", "- [ ] `o/b`: Probe ausstehend (nicht taggen, bis sie grün ist)"]);
      expect(r.offen).toEqual(["o/a", "o/b"]);
      expect(r.blocker).toEqual([]);
    });
    it("bezieherProbe Negativfall (K4): ein roter Bezieher erscheint als BLOCKER, ein Bezieher ohne Rot durch Factory-Besitz (Exit 0) nicht", () => {
      const r = T.bezieherProbe({ bezieher: ["o/a", "o/b"], ergebnisse: { "o/a": 0, "o/b": 1 } });
      expect(r.zeilen).toEqual(["- [x] `o/a`: Probe grün", "- [ ] BLOCKER `o/b`: Probe rot (Exit 1), nicht taggen"]);
      expect(r.blocker).toEqual(["o/b"]);
      expect(r.offen).toEqual([]);
    });
    it("factory#215 L5: bezieherProbe mit rest: Zeile grün mit Projekt-Rest, in rest gelistet, weder Blocker noch offen", () => {
      const r = T.bezieherProbe({ bezieher: ["o/a", "o/b"], ergebnisse: { "o/a": "rest", "o/b": 0 } });
      expect(r.zeilen).toEqual(["- [x] `o/a`: Probe grün mit Projekt-Rest (Befund bzw. Bezieher-Migration festhalten, kein Blocker)", "- [x] `o/b`: Probe grün"]);
      expect([r.blocker, r.offen, r.rest]).toEqual([[], [], ["o/a"]]);
    });
    it("bezieherProbe: jeder Exit ungleich 0 ist ein Blocker, auch 2; ein Ergebnis zu einem fremden Repo zählt nicht", () => {
      const r = T.bezieherProbe({ bezieher: ["o/a"], ergebnisse: { "o/a": 2, "x/fremd": 0 } });
      expect(r.blocker).toEqual(["o/a"]);
      expect(r.zeilen).toHaveLength(1);
    });
    it("bezieherProbe mit leerer Liste: Hinweiszeile ohne Checkbox, nichts offen", () => {
      const r = T.bezieherProbe({ bezieher: [] });
      expect(r.zeilen).toHaveLength(1);
      expect(r.zeilen[0]).toContain("Keine Bezieher gelistet (Schlüssel `bezieher` der Projekt-Config)");
      expect(r.zeilen[0]).not.toContain("[ ]");
      expect(r.offen).toEqual([]);
      expect(r.blocker).toEqual([]);
    });
  });
  it("factory#162 L26: die Bezieher holen das Update selbst (factory-update.yml), Werkzeug-Hinweis bleibt, Patch-Tag nie verschoben, Schließen bei Tag und Release", () => {
    const punkte = body.split("\n").filter((z) => z.startsWith("- [ ] "));
    const holen = punkte.findIndex((z) => z.includes("Bezieher holen das Update selbst (`factory-update.yml`"));
    expect(holen).toBeGreaterThan(-1);
    expect(punkte[holen]).toContain("node <quelle>/scripts/factory-sync.mjs --quelle <quelle> --tag <tag>");
    expect(punkte[holen]).toContain("docs/adr/0031-fabrik-ohne-zugriff-auf-bezieher.md");
    expect(punkte[holen]).toContain("kein Sync-PR, kein Trockenlauf im Bezieher-Checkout, kein Issue, kein Kommentar");
    expect(punkte[holen + 1]).toContain("Fix upstream per PR, dann Patch-Tag auf den Fix-Commit, ein gesetzter Tag wird nie verschoben");
    expect(punkte.find((z) => z.includes("Gate-Lücke"))).toContain("Sammelticket");
    expect(punkte[punkte.length - 1]).toContain("sobald der Tag gepusht ist");
    expect(body).toContain("vom Bezieher beim Update zu erledigen");
  });
  it("begrenzt die PR-Liste auf 50 Zeilen und bereinigt Zellen", () => {
    const viele = T.besitzCommits(Array.from({ length: 53 }, (_, i) => commit({ betreff: i === 0 ? "fix: a|b`c (#1)" : `fix: n (#${i + 2})` })), MANIFEST);
    const b = T.tagBody({ tag: "v1.3.0", letzterTag: "v1.2.3", sha: "b".repeat(40), prs: viele, aeltestes: { datum: vor(2), sha: "c".repeat(40) }, ausloeser: ["x"], ci: { zustand: "unbekannt", url: null } });
    expect(b).toContain("… und 3 weitere");
    expect(b).toContain("fix: a b c (#1)");
  });
});

describe("L14: entfernte Exporte sind ein Major", () => {
  const X = raw as unknown as {
    exporteAus: (t: string | null) => Set<string>;
    entfernteExporte: (alt: string | null, neu: string | null) => string[];
    verteilteSkripte: (b: Commit[], m: unknown) => string[];
  };
  const alt = "export const a = 1;\nexport let b = 2;\nexport function c() {}\nexport async function d() {}\nexport class E {}\nconst f = 1;\nexport { f, f as g };\n";
  it("erkennt alle Export-Formen (äußerer Name bei as), Nicht-Exporte nicht", () => {
    expect([...X.exporteAus(alt)].sort()).toEqual(["E", "a", "b", "c", "d", "f", "g"]);
    expect([...X.exporteAus("function intern() {}\n// export const x\n  export const eingerueckt = 1;")]).toEqual([]);
    expect(X.exporteAus(null).size).toBe(0);
  });
  it("entfernteExporte: entfernt, umbenannt, gelöscht (null); neu und unverändert nicht", () => {
    expect(X.entfernteExporte("export const a = 1;\nexport const b = 2;", "export const a = 1;")).toEqual(["b"]);
    expect(X.entfernteExporte("export function a() {}", "export function a2() {}")).toEqual(["a"]);
    expect(X.entfernteExporte("export const a = 1;\nexport const b = 2;", null)).toEqual(["a", "b"]);
    expect(X.entfernteExporte("export const a = 1;", "export const a = 1;\nexport const neu = 2;")).toEqual([]);
  });
  it("verteilteSkripte: nur Skript-Dateien unter einem verteilten Ganzdatei-Eintrag", () => {
    const m = { eintraege: [{ pfad: "scripts/a.mjs", ring: "kern" }, { pfad: "scripts/lib", ring: "kern" }, { pfad: "scripts/o.mjs", ring: "oberflaeche" }, { pfad: "scripts/b.mjs", ring: "kern", block: "x" }] };
    const b = [commit({ dateien: ["scripts/a.mjs", "scripts/lib/z.cjs", "scripts/lib/readme.md", "scripts/o.mjs", "scripts/b.mjs", "src/x.mjs"] }), commit({ dateien: ["scripts/a.mjs"] })];
    expect(X.verteilteSkripte(b, m)).toEqual(["scripts/a.mjs", "scripts/lib/z.cjs"]);
  });
  it("naechsterTag unter v1: entfernter Export hebt nur das Minor (SemVer §4), ab v1 den Major", () => {
    const fix = [commit({ betreff: "fix: a" })];
    expect(T.naechsterTag("v0.6.0", fix, [{ datei: "scripts/a.mjs", namen: ["b"] }])).toBe("v0.7.0");
    expect(T.naechsterTag("v1.2.3", fix, [{ datei: "scripts/a.mjs", namen: ["b"] }])).toBe("v2.0.0");
  });
  it("naechsterTag: entfernter Export hebt auf Major, auch über feat; ohne bleibt es Minor", () => {
    const feat = [commit({ betreff: "feat: x (#1)", body: "feat: x (#1)" })];
    expect(T.naechsterTag("v1.2.3", feat, [{ datei: "scripts/a.mjs", namen: ["b"] }])).toBe("v2.0.0");
    expect(T.naechsterTag("v1.2.3", feat, [])).toBe("v1.3.0");
    expect(T.naechsterTag("v1.2.3", feat)).toBe("v1.3.0");
  });
  it("tagBody nennt die entfernten Exporte je Datei", () => {
    const b = T.tagBody({ tag: "v2.0.0", letzterTag: "v1.2.3", sha: "b".repeat(40), prs: reihe(3), aeltestes: { datum: vor(2), sha: "c".repeat(40) }, ausloeser: ["x"], ci: { zustand: "unbekannt", url: null }, entfernt: [{ datei: "scripts/a.mjs", namen: ["b", "c"] }] });
    expect(b).toContain("- Entfernte Exporte (Breaking): `scripts/a.mjs`: b, c");
  });
  const dateien: Record<string, Record<string, string | null>> = {
    "v1.2.3": { "scripts/a.mjs": "export const a = 1;\nexport const b = 2;", "scripts/n.mjs": null },
    [`${"d".repeat(40)}`]: { "scripts/a.mjs": "export const a = 1;", "scripts/n.mjs": "export const n = 1;" },
  };
  const ioMit = (zeige: (r: string, p: string) => string | null) => {
    const texte: string[] = [];
    const eins = (k: number) => `\x1e${String(k).repeat(40)}\x1f${vor(k)}\x1ffeat: a (#${k})\x1f\n\nscripts/a.mjs\nscripts/n.mjs\n`;
    const log = eins(1) + eins(2) + eins(3);
    const code = T.lauf({ io: { istBezieher: () => false, tags: () => ["v1.2.3"], ladeLog: () => log, ladeManifest: () => MANIFEST, headSha: () => "d".repeat(40), ladeLaeufe: () => [], ladeOffene: () => [], frischeOffene: () => [], dringlichKey: KEY, jetzt: () => JETZT, projectToken: "t", legeIssueAn: (_t: string, b: string) => { texte.push(b); return "5"; }, sortiereEin: () => true, zeigeDatei: zeige, log: () => undefined }, trocken: false });
    return { code, text: texte[0] ?? "" };
  };
  it("lauf: Datei am Tag vorhanden, jetzt ohne Export: Major und Zeile; am Tag fehlende (neue) Datei zählt nicht", () => {
    const r = ioMit((ref, pfad) => dateien[ref]?.[pfad] ?? null);
    expect(r.text).toContain("`v2.0.0`");
    expect(r.text).toContain("- Entfernte Exporte (Breaking): `scripts/a.mjs`: b");
    expect(r.text).not.toContain("scripts/n.mjs`:");
    const gleich = ioMit((ref, pfad) => (pfad === "scripts/n.mjs" ? null : dateien["v1.2.3"][pfad] ?? null));
    expect(gleich.text).toContain("`v1.3.0`");
    expect(gleich.text).not.toContain("Entfernte Exporte");
  });
  // Blocker A (Runde 1): der verteilte Satz ist die Vereinigung des Manifests am Tag und an HEAD; gelöscht und umbenannt zählen.
  const MANIFEST_TAG = JSON.stringify({ eintraege: [{ pfad: "scripts/alt.mjs", ring: "kern" }, { pfad: "scripts/a.mjs", ring: "kern" }] });
  const mitTag = (dateienImLog: string[], zeige: (r: string, p: string) => string | null, kopf: unknown = MANIFEST, tagManifest: string | null = MANIFEST_TAG) => {
    const texte: string[] = [];
    const eins = (k: number) => `\x1e${String(k).repeat(40)}\x1f${vor(k)}\x1ffeat: a (#${k})\x1f\n\n${dateienImLog.join("\n")}\n`;
    T.lauf({ io: { istBezieher: () => false, tags: () => ["v1.2.3"], ladeLog: () => eins(1) + eins(2) + eins(3), ladeManifest: () => kopf, headSha: () => "d".repeat(40), ladeLaeufe: () => [], ladeOffene: () => [], frischeOffene: () => [], dringlichKey: KEY, jetzt: () => JETZT, projectToken: "t", legeIssueAn: (_t: string, b: string) => { texte.push(b); return "5"; }, sortiereEin: () => true, zeigeDatei: (r: string, p: string) => (p === ".factory/besitz.json" ? (r === "v1.2.3" ? tagManifest : null) : zeige(r, p)), log: () => undefined }, trocken: false });
    return texte[0] ?? "";
  };
  it("lauf: am Tag verteilte, inzwischen gelöschte Datei (nicht mehr im Manifest von HEAD): Major mit Zeile", () => {
    const text = mitTag(["scripts/alt.mjs"], (ref, pfad) => (ref === "v1.2.3" && pfad === "scripts/alt.mjs" ? "export const alt = 1;" : null));
    expect(text).toContain("`v2.0.0`");
    expect(text).toContain("- Entfernte Exporte (Breaking): `scripts/alt.mjs`: alt");
  });
  it("lauf: umbenannte verteilte Datei (Log nennt alten und neuen Pfad): der alte Pfad zählt als gelöscht, Major", () => {
    const text = mitTag(["scripts/alt.mjs", "scripts/a.mjs"], (ref, pfad) => (pfad === "scripts/alt.mjs" ? (ref === "v1.2.3" ? "export const alt = 1;" : null) : "export const a = 1;"));
    expect(text).toContain("- Entfernte Exporte (Breaking): `scripts/alt.mjs`: alt");
  });
  it("lauf: fehlt das Manifest am Tag, bleibt es beim Manifest von HEAD (kein Absturz, keine Zeile)", () => {
    const text = mitTag(["scripts/alt.mjs", "scripts/a.mjs"], (ref, pfad) => (pfad === "scripts/alt.mjs" && ref !== "v1.2.3" ? null : "export const x = 1;"), MANIFEST, null);
    expect(text).toContain("`v1.3.0`");
    expect(text).not.toContain("Entfernte Exporte");
  });
  it("lauf: eine verteilte Ganzdatei außerhalb von scripts/ löst keinen Major aus (Anker ^scripts/)", () => {
    const kopf = { eintraege: [{ pfad: ".claude/hooks", ring: "kern" }] };
    const text = mitTag([".claude/hooks/x.mjs"], (ref) => (ref === "v1.2.3" ? "export const x = 1;" : null), kopf, JSON.stringify(kopf));
    expect(text).toContain("`v1.3.0`");
    expect(text).not.toContain("Entfernte Exporte");
  });
  it("exporteAus: `export var` zählt, ein Komma am Ende der Liste ergibt keinen leeren Namen", () => {
    expect([...X.exporteAus("export var x = 1;")]).toEqual(["x"]);
    expect([...X.exporteAus("export { a, };")]).toEqual(["a"]);
  });
  it("verteilteSkripte und besitzCommits: ein Manifest ohne `eintraege` (oder undefined) ergibt leer statt Absturz", () => {
    expect(X.verteilteSkripte([commit()], {})).toEqual([]);
    expect(X.verteilteSkripte([commit()], undefined)).toEqual([]);
    expect(T.besitzCommits([commit()], {})).toEqual([]);
  });
});

describe("lauf", () => {
  const log: string[] = [];
  const aufrufe: string[] = [];
  function io(o: Io = {}): Io {
    log.length = 0;
    aufrufe.length = 0;
    return {
      log: (z: string) => log.push(z),
      istBezieher: () => false,
      tags: () => ["v1.2.3"],
      ladeLog: () => `\x1e${"1".repeat(40)}\x1f${vor(1)}\x1ffeat: a (#1)\x1f\n\nscripts/a.mjs\n\x1e${"2".repeat(40)}\x1f${vor(2)}\x1ffix: b (#2)\x1f\n\nscripts/a.mjs\n\x1e${"3".repeat(40)}\x1f${vor(3)}\x1ffix: c (#3)\x1f\n\nscripts/a.mjs\n`,
      ladeManifest: () => MANIFEST,
      headSha: () => "d".repeat(40),
      ladeLaeufe: () => [{ path: ".github/workflows/ci.yml", status: "completed", conclusion: "success", html_url: "u" }],
      ladeOffene: () => [],
      frischeOffene: () => {
        aufrufe.push("zweit");
        return [];
      },
      dringlichKey: KEY,
      jetzt: () => JETZT,
      projectToken: "t",
      legeIssueAn: (titel: string) => {
        aufrufe.push(`anlegen:${titel}`);
        return "77";
      },
      sortiereEin: (nr: string, art: string) => aufrufe.push(`platziere:${nr}:${art}`) > 0,
      aktualisiere: (nr: number, titel: string) => aufrufe.push(`aktualisiere:${nr}:${titel}`),
      schliesse: (nr: number) => aufrufe.push(`schliesse:${nr}`),
      ...o,
    };
  }
  it("legt bei 3 Besitz-PRs ein Ticket an und sortiert es per Art tag an die Spitze", () => {
    expect(T.lauf({ io: io() })).toBe(0);
    expect(aufrufe).toEqual(["zweit", "anlegen:🏷️ Tag v1.3.0 setzen und syncen", "platziere:77:tag"]);
  });
  it("legt ohne Zweitabfrage-Treffer an, mit Treffer nicht", () => {
    T.lauf({ io: io({ frischeOffene: () => [{ number: 9, titel: T.tagTitel("v1.3.0") }] }) });
    expect(aufrufe.some((a) => a.startsWith("anlegen"))).toBe(false);
  });
  it("--dry-run ruft keine Schreib-IO und keine Zweitabfrage", () => {
    expect(T.lauf({ io: io(), trocken: true })).toBe(0);
    expect(aufrufe).toEqual([]);
    expect(log.join("\n")).toContain("[dry-run] 🏷️ Tag v1.3.0");
  });
  it("L3: geclaimtes Ticket: --dry-run gibt den Vorschlag trotzdem aus, ohne --dry-run bleibt es bei nichts und ohne Schreib-IO", () => {
    const geclaimt = { ladeOffene: () => [tagOffen({ assignees: ["x"] })] };
    expect(T.lauf({ io: io(geclaimt), trocken: true })).toBe(0);
    const t = log.join("\n");
    expect(t).toContain("nichts");
    expect(t).toContain("[dry-run] 🏷️ Tag v1.3.0 setzen und syncen");
    expect(t).toContain("[dry-run] - Vorgeschlagener Tag");
    T.lauf({ io: io(geclaimt) });
    expect(aufrufe).toEqual([]);
    expect(log.join("\n")).not.toContain("[dry-run]");
    T.lauf({ io: io({ ladeLog: () => "", ...geclaimt }), trocken: true });
    expect(log.join("\n")).not.toContain("[dry-run]");
    // ohne Claim und ohne Auslöser (zwei jüngere Besitz-PRs) gibt es keinen Vorschlag, auch nicht im Dry-Run
    const zwei = `\x1e${"1".repeat(40)}\x1f${vor(1)}\x1ffix: a (#1)\x1f\n\nscripts/a.mjs\n\x1e${"2".repeat(40)}\x1f${vor(2)}\x1ffix: b (#2)\x1f\n\nscripts/a.mjs\n`;
    T.lauf({ io: io({ ladeLog: () => zwei }), trocken: true });
    expect(log.join("\n")).toContain("Tag-Takt: nichts");
    expect(log.join("\n")).not.toContain("[dry-run]");
  });
  it("ein werfender CI-Leser legt trotzdem an, mit Status unbekannt", () => {
    const text: string[] = [];
    T.lauf({ io: io({ ladeLaeufe: () => { throw new Error("403"); }, legeIssueAn: (_t: string, b: string) => { text.push(b); return "5"; } }) });
    expect(text[0]).toContain("CI-Status dieses Commits: unbekannt");
    expect(text[0]).toContain(`Älteste ungetaggte Änderung: ${vor(3).slice(0, 10)}`);
  });
  it("factory#215 L4: ein aktualisiertes Ticket behält die Haken, ein aktuelles Ticket mit Haken bleibt unberührt", () => {
    let body = "";
    T.lauf({ io: io({ ladeOffene: () => [tagOffen()], aktualisiere: (_n: number, _t: string, b: string) => { body = b; } }) });
    const pre = "- [ ] Pre-Flight „ja, taggen“";
    expect(body).toContain(pre);
    const abgehakt = body.replace(pre, "- [x] Pre-Flight „ja, taggen“");
    const titel = "🏷️ Tag v1.3.0 setzen und syncen";
    T.lauf({ io: io({ ladeOffene: () => [tagOffen({ titel, body: abgehakt })] }) });
    expect(aufrufe).toEqual([]);
    let neu = "";
    T.lauf({ io: io({ ladeOffene: () => [tagOffen({ titel, body: abgehakt.replace("Besitz-Änderungen liegen", "Alt-Änderungen liegen") })], aktualisiere: (_n: number, _t: string, b: string) => { neu = b; } }) });
    expect(neu).toContain("- [x] Pre-Flight „ja, taggen“");
    expect(neu.match(/^- \[x\]/gm)).toHaveLength(1);
  });
  it("identisches offenes Ticket bleibt unberührt, abweichendes wird aktualisiert, leeres geschlossen", () => {
    T.lauf({ io: io({ ladeOffene: () => [tagOffen()] }) });
    expect(aufrufe).toEqual(["aktualisiere:40:🏷️ Tag v1.3.0 setzen und syncen"]);
    let body = "";
    T.lauf({ io: io({ ladeOffene: () => [tagOffen()], aktualisiere: (_n: number, _t: string, b: string) => { body = b; } }) });
    const titel = "🏷️ Tag v1.3.0 setzen und syncen";
    T.lauf({ io: io({ ladeOffene: () => [tagOffen({ titel, body })] }) });
    expect(aufrufe).toEqual([]);
    T.lauf({ io: io({ ladeLog: () => "", ladeOffene: () => [tagOffen()] }) });
    expect(aufrufe).toEqual(["schliesse:40"]);
  });
  it("Bezieher: nichts zu tun; Git-Fehler: Exit 1; ohne PROJECT_TOKEN nur Warnung", () => {
    expect(T.lauf({ io: io({ istBezieher: () => true, tags: () => { throw new Error("nie"); } }) })).toBe(0);
    expect(T.lauf({ io: io({ tags: () => { throw new Error("git kaputt"); } }) })).toBe(1);
    expect(log.join("\n")).toContain("::error::");
    expect(T.lauf({ io: io({ projectToken: undefined }) })).toBe(0);
    expect(log.join("\n")).toContain("::warning::PROJECT_TOKEN fehlt");
    expect(aufrufe.some((a) => a.startsWith("platziere"))).toBe(false);
  });
});

describe("Härtung (Review Runde 1)", () => {
  const leer = { zustand: "unbekannt", url: null };
  const bodyVon = (o: Record<string, unknown> = {}) => T.tagBody({ tag: "v1.3.0", letzterTag: "v1.2.3", sha: "b".repeat(40), prs: reihe(3), aeltestes: { datum: vor(2), sha: "c".repeat(40) }, ausloeser: ["x"], ci: leer, ...o });
  const logZeilen = (o: Io, trocken = false) => {
    const z: string[] = [];
    const code = T.lauf({ io: { ...baseIo(), log: (t: string) => z.push(t), ...o }, trocken });
    return { code, z: z.join("\n") };
  };
  const logText = `\x1e${"1".repeat(40)}\x1f${vor(1)}\x1ffeat: a (#1)\x1f\n\nscripts/a.mjs\n\x1e${"2".repeat(40)}\x1f${vor(2)}\x1ffix: b (#2)\x1f\n\nscripts/a.mjs\n\x1e${"3".repeat(40)}\x1f${vor(3)}\x1ffix: c (#3)\x1f\n\nscripts/a.mjs\n`;
  function baseIo(): Io {
    return {
      istBezieher: () => false,
      tags: () => ["v1.2.3"],
      ladeLog: () => logText,
      ladeManifest: () => MANIFEST,
      headSha: () => "d".repeat(40),
      ladeLaeufe: () => [],
      ladeOffene: () => [],
      frischeOffene: () => [],
      dringlichKey: KEY,
      jetzt: () => JETZT,
      projectToken: "t",
      legeIssueAn: () => "77",
      sortiereEin: () => true,
      aktualisiere: () => undefined,
      schliesse: () => undefined,
    };
  }

  it("Tags ohne v-Präfix: das eigene Ticket wird wiedergefunden (kein zweites Ticket)", () => {
    const aufrufe: string[] = [];
    const io = { tags: () => ["1.2.3"], ladeOffene: () => [tagOffen({ titel: T.tagTitel("1.3.0") })], legeIssueAn: () => aufrufe.push("anlegen"), aktualisiere: () => aufrufe.push("aktualisiere") };
    logZeilen(io);
    expect(aufrufe).toEqual(["aktualisiere"]);
    expect(T.tagTitel("1.3.0").startsWith(T.TAG_MARKER)).toBe(true);
  });
  it("Schreibfehler enden mit Exit 1 und ::error::", () => {
    const werfen = () => {
      throw new Error("gh kaputt");
    };
    for (const o of [{ sortiereEin: () => false }, { legeIssueAn: werfen }]) {
      const r = logZeilen(o);
      expect(r.code, JSON.stringify(Object.keys(o))).toBe(1);
      expect(r.z).toContain("::error::");
    }
    expect(logZeilen({ ladeOffene: () => [tagOffen()], aktualisiere: werfen }).code).toBe(1);
    expect(logZeilen({ ladeLog: () => "", ladeOffene: () => [tagOffen()], schliesse: werfen }).code).toBe(1);
    expect(logZeilen({ ladeLog: () => "", ladeOffene: () => [tagOffen()] }).code).toBe(0);
  });
  it("Lesefehler von ladeOffene: Exit 1 mit ::error::", () => {
    const r = logZeilen({ ladeOffene: () => { throw new Error("gh weg"); } });
    expect(r.code).toBe(1);
    expect(r.z).toContain("::error::Tag-Takt: Lesen fehlgeschlagen");
  });
  it("kein Release-Tag in lauf: Exit 0, kein Log-Lesen, keine Schreib-IO", () => {
    const r = logZeilen({ tags: () => [], ladeLog: () => { throw new Error("nie"); }, legeIssueAn: () => { throw new Error("nie"); } });
    expect(r.code).toBe(0);
  });
  it("Warnungen erscheinen als ::warning:: im Log, ein einzelnes offenes Ticket warnt nicht", () => {
    const zwei = [tagOffen({ number: 50 }), tagOffen({ number: 40 })];
    expect(logZeilen({ ladeOffene: () => zwei }).z).toContain("::warning::Mehrere offene Tag-Tickets");
    expect(entscheide({ besitz: reihe(4), offene: [tagOffen()] }).warnungen).toEqual([]);
    expect(logZeilen({ ladeOffene: () => [tagOffen()] }).z).not.toContain("::warning::");
  });
  it("Alter zählt die älteste Änderung, nicht die jüngste", () => {
    // git log liefert den neuesten Commit zuerst: der älteste steht hinten bzw. in der Mitte.
    const gemischt = T.besitzCommits([commit({ datum: vor(1) }), commit({ datum: vor(8), sha: "b".repeat(40) })], MANIFEST);
    expect(entscheide({ besitz: gemischt }).aktion).toBe("anlegen");
    const mitte = T.besitzCommits([commit({ datum: vor(2) }), commit({ datum: vor(9), sha: "b".repeat(40) }), commit({ datum: vor(1), sha: "c".repeat(40) })], MANIFEST);
    // 3 Commits lösen schon über MIN_PRS aus: darum den Auslöser prüfen, nicht nur die Aktion.
    expect(entscheide({ besitz: mitte }).grund).toContain("älteste ungetaggte Änderung über");
    const texte: string[] = [];
    const dreiLog = (d: number[]) => d.map((tage, k) => `\x1e${String(k).repeat(40)}\x1f${vor(tage)}\x1ffix: n (#${k + 1})\x1f\n\nscripts/a.mjs\n`).join("");
    logZeilen({ ladeLog: () => dreiLog([2, 9, 1]), legeIssueAn: (_t: string, b: string) => { texte.push(b); return "5"; } });
    expect(texte[0]).toContain(`Älteste ungetaggte Änderung: ${vor(9).slice(0, 10)}`);
  });
  it("istAktuell: Titel allein oder Body allein abweichend führt zur Aktualisierung", () => {
    let soll = { titel: "", body: "" };
    expect(logZeilen({ ladeOffene: () => [tagOffen()], aktualisiere: (_n: number, t: string, b: string) => { soll = { titel: t, body: b }; } }).code).toBe(0);
    for (const abw of [{ titel: "🏷️ Tag v9.9.9 anders" }, { body: "anderer Body" }]) {
      const aufrufe: string[] = [];
      logZeilen({ ladeOffene: () => [tagOffen({ ...soll, ...abw, titel: abw.titel ?? soll.titel })], aktualisiere: () => aufrufe.push("a") });
      expect(aufrufe, JSON.stringify(abw)).toEqual(["a"]);
    }
  });

  it("CI-Text: rot, läuft, unbekannt, Link nur mit URL", () => {
    expect(bodyVon({ ci: { zustand: "rot", url: "https://example.invalid/r" } })).toContain("CI-Status dieses Commits: ROT ([Lauf](https://example.invalid/r))");
    expect(bodyVon({ ci: { zustand: "laeuft", url: null } })).toContain("läuft noch (Stand des Takts; nächster Push auf main oder Montagslauf aktualisiert)");
    expect(bodyVon({ ci: { zustand: "irgendwas", url: null } })).toContain("CI-Status dieses Commits: unbekannt");
    expect(bodyVon()).not.toContain("[Lauf]");
  });
  it("PR-Liste: genau 50 ohne Rest, bei 53 fehlen die letzten, Zellen gekürzt und bereinigt", () => {
    const viele = (n: number, betreff: (i: number) => string) => T.besitzCommits(Array.from({ length: n }, (_, i) => commit({ betreff: betreff(i) })), MANIFEST);
    const b50 = bodyVon({ prs: viele(50, (i) => `fix: n (#${i + 1})`) });
    expect(b50).not.toContain("weitere");
    expect(b50).toContain("#50 fix");
    const b53 = bodyVon({ prs: viele(53, (i) => `fix: n (#${i + 1})`) });
    expect(b53).toContain("#50 fix");
    expect(b53).not.toContain("#51 fix");
    const lang = bodyVon({ prs: viele(1, () => `fix: ${"x".repeat(200)} (#1)`) });
    expect(lang).not.toContain("x".repeat(121));
    const exakt = bodyVon({ prs: viele(1, () => "x".repeat(200)) });
    expect(exakt).toContain("x".repeat(120));
    expect(exakt).not.toContain("x".repeat(121));
    expect(bodyVon({ prs: viele(1, () => "|`") })).toContain("- aaaaaaa - (");
    expect(bodyVon({ prs: viele(1, () => "fix: a\nb (#1)") })).not.toContain("a\nb");
  });
  it("Zweitabfrage ohne Liste oder mit Eintrag ohne Titel stürzt nicht ab (fail-closed)", () => {
    const anlegen = entscheide({ besitz: reihe(4) });
    for (const antwort of [null, {}]) expect(T.bestaetigeTagAnlegen(anlegen, { zweit: () => antwort }).aktion, JSON.stringify(antwort)).toBe("nichts");
    expect(T.bestaetigeTagAnlegen(anlegen, { zweit: () => [{ number: 1 }, null] })).toBe(anlegen);
  });
  it.each([
    ["feat!: x", "v2.0.0"],
    ["fix: a\n\nBREAKING-CHANGE: x", "v2.0.0"],
    ["fix: a\n\n* BREAKING CHANGE: x", "v2.0.0"],
    ["fix: Text BREAKING CHANGE: mitten", "v1.2.4"],
    ["feature: x", "v1.2.4"],
    ["featx: y", "v1.2.4"],
    ["fix: wow!: x", "v1.2.4"],
    ["fix: kein feat: x", "v1.2.4"],
  ])("Versionsgrenze %j → %s", (text, erwartet) => {
    expect(T.naechsterTag("v1.2.3", [commit({ betreff: text.split("\n")[0], body: text })])).toBe(erwartet);
  });
  it("ciZustand: neuester Lauf zuerst, Null-Einträge tolerant, URL nur als String", () => {
    const ci = (conclusion: string, extra = {}) => ({ path: ".github/workflows/ci.yml", status: "completed", conclusion, ...extra });
    expect(T.ciZustand([ci("failure"), ci("success")]).zustand).toBe("rot");
    expect(T.ciZustand([null, ci("success")]).zustand).toBe("gruen");
    expect(T.ciZustand([ci("success", { html_url: 5 })]).url).toBeNull();
    expect(T.ciZustand([ci("success", { html_url: "https://example.invalid/r" })]).url).toBe("https://example.invalid/r");
  });
  it("besitzCommits mit kaputtem Manifest: nur das Manifest selbst zählt, kein Absturz", () => {
    for (const m of [{}, null]) {
      expect(T.besitzCommits([commit({ dateien: [".factory/besitz.json"] }), commit()], m)).toHaveLength(1);
    }
  });
});

describe("Bezieher-Migration (Sammelticket-Zeilen)", () => {
  const mitTag = (o: Record<string, unknown> = {}) => T.tagBody({ tag: "v1.3.0", letzterTag: "v1.2.3", sha: "b".repeat(40), prs: reihe(3), aeltestes: { datum: vor(2), sha: "c".repeat(40) }, ausloeser: ["x"], ci: { zustand: "unbekannt", url: null }, ...o });
  it("liest je Besitz-Commit alle Zeilen mit Text, ignoriert leere Texte und Nicht-Besitz-Commits", () => {
    const besitz = T.besitzCommits([
      commit({ betreff: "feat: a (#7)", body: `feat: a (#7)\n\n${MKEY}: Konfig X ergänzen\n* ${MKEY}: Datei Y löschen\n${MKEY}:   ` }),
      commit({ pr: "#8", body: `feat: b\n\n${MKEY}: nur Projekt`, dateien: ["src/app.ts"] }),
      commit({ pr: "#9", body: "feat: c" }),
    ], MANIFEST);
    expect(T.bezieherMigrationen(besitz, MKEY)).toEqual([{ pr: "#7", text: "Konfig X ergänzen" }, { pr: "#7", text: "Datei Y löschen" }]);
  });
  it("tagBody rendert den Abschnitt mit den Zeilen, ohne Zeilen „keine gemeldet“", () => {
    const mit = mitTag({ migrationen: [{ pr: "#7", text: "Konfig X ergänzen" }] });
    expect(mit).toContain("Bezieher-Migration");
    expect(mit).toContain("- #7 Konfig X ergänzen");
    expect(mit).not.toContain("keine gemeldet");
    expect(mitTag()).toContain("keine gemeldet");
  });
  it("factory#162 L26: Migrationen gehören dem Bezieher beim Update; Schritte im Bezieher stehen nicht mehr in der Checkliste der Fabrik", () => {
    const b = mitTag();
    for (const teil of ["Bezieher-Migration (Commit-Zeilen der Besitz-PRs, vom Bezieher beim Update zu erledigen)", "Gate-Lücke: welches Bezieher-Gate hätte es melden müssen"]) expect(b, teil).toContain(teil);
    for (const teil of ["ticket-lock.mjs claim", "Plan: ohne — Factory-Sync", "npm run verify:kompakt", "abgelöster Kern-Tests", "Issue ins Bezieher-Repo"]) expect(b, teil).not.toContain(teil);
  });
  it("lauf reicht die Migrationen aus dem Log in den Ticket-Body (migrationKey)", () => {
    const texte: string[] = [];
    const eins = (n: number) => `\x1e${String(n).repeat(40)}\x1f${vor(n)}\x1ffeat: a (#${n})\n\n${MKEY}: Konfig neu\x1f\n\nscripts/a.mjs\n`;
    T.lauf({ io: { istBezieher: () => false, tags: () => ["v1.2.3"], ladeLog: () => eins(1) + eins(2) + eins(3), ladeManifest: () => MANIFEST, headSha: () => "d".repeat(40), ladeLaeufe: () => [], ladeOffene: () => [], frischeOffene: () => [], dringlichKey: KEY, migrationKey: MKEY, jetzt: () => JETZT, projectToken: "t", legeIssueAn: (_t: string, b: string) => { texte.push(b); return "5"; }, sortiereEin: () => true, zeigeDatei: () => null, log: () => undefined }, trocken: false });
    expect(texte.join("\n")).toContain("Konfig neu");
  });
});
