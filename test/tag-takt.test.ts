import { describe, expect, it } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/tag-takt.mjs";
import { FREMD } from "./support/fremd-config";

type Commit = { sha: string; datum: string; betreff: string; body: string; dateien: string[]; pr?: string };
type Offen = { number: number; titel: string; assignees: string[]; body?: string };
type Entscheidung = { aktion: string; grund: string; warnungen: string[]; nummer?: number; ausloeser?: string[] };
type Io = Record<string, unknown>;
const T = raw as unknown as {
  TAG_MARKER: string;
  tagTitel: (t: string) => string;
  commitsAusLog: (t: string) => Commit[];
  besitzCommits: (c: Commit[], m: unknown) => Commit[];
  naechsterTag: (t: string, c: Commit[]) => string;
  dringlichSignal: (b: Commit[], k: string) => { grund: string; sha: string } | null;
  entscheideTagTakt: (a: { letzterTag: string | null; besitz: Commit[]; jetzt: Date; offene: Offen[]; dringlichKey: string }) => Entscheidung;
  bestaetigeTagAnlegen: (e: Entscheidung, a: { zweit: () => unknown }) => Entscheidung;
  ciZustand: (l: unknown) => { zustand: string; url: string | null };
  tagBody: (a: Record<string, unknown>) => string;
  lauf: (a: { io: Io; trocken?: boolean }) => number;
};

const KEY = `${FREMD.praefixe.commitZeile}Sync-Dringlich`;
const JETZT = new Date("2026-06-20T12:00:00Z");
const TAG_MS = 86_400_000;
const MANIFEST = { eintraege: [{ pfad: "scripts/a.mjs", ring: "kern" }, { pfad: "docs/x", ring: "kern" }, { pfad: "scripts/cockpit/c.mjs", ring: "oberflaeche" }] };
const vor = (tage: number) => new Date(JETZT.getTime() - tage * TAG_MS).toISOString();
const commit = (o: Partial<Commit> = {}): Commit => ({ sha: "a".repeat(40), datum: vor(1), betreff: "fix: x (#5)", body: "fix: x (#5)", dateien: ["scripts/a.mjs"], ...o });
const reihe = (n: number, o: Partial<Commit> = {}) => T.besitzCommits(Array.from({ length: n }, (_, i) => commit({ sha: String(i).repeat(40), betreff: `fix: x (#${i + 1})`, ...o })), MANIFEST);
const entscheide = (o: Partial<Parameters<typeof T.entscheideTagTakt>[0]> = {}) => T.entscheideTagTakt({ letzterTag: "v1.2.3", besitz: reihe(1), jetzt: JETZT, offene: [], dringlichKey: KEY, ...o });
const tagOffen = (o: Partial<Offen> = {}): Offen => ({ number: 40, titel: "🏷️ Tag v1.2.4 setzen und syncen", assignees: [], body: "alt", ...o });

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
  it("ohne Release-Tag entsteht nichts", () => {
    expect(entscheide({ letzterTag: null, besitz: reihe(5) }).aktion).toBe("nichts");
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
    for (const teil of ["#1 fix: x", "#3 fix: x", "CI-Status dieses Commits: grün", "https://example.invalid/run/1", `git tag -a v1.3.0 ${"b".repeat(40)}`, "git push origin v1.3.0", "Trockenlauf-Sync in einem Bezieher", "ja, taggen", "Cross-Repo-Token", "--tag v1.3.0"]) {
      expect(body, teil).toContain(teil);
    }
    expect(T.tagTitel("v1.3.0")).toBe("🏷️ Tag v1.3.0 setzen und syncen");
    expect(T.tagTitel("v1.3.0").startsWith(T.TAG_MARKER)).toBe(true);
  });
  it("begrenzt die PR-Liste auf 50 Zeilen und bereinigt Zellen", () => {
    const viele = T.besitzCommits(Array.from({ length: 53 }, (_, i) => commit({ betreff: i === 0 ? "fix: a|b`c (#1)" : `fix: n (#${i + 2})` })), MANIFEST);
    const b = T.tagBody({ tag: "v1.3.0", letzterTag: "v1.2.3", sha: "b".repeat(40), prs: viele, aeltestes: { datum: vor(2), sha: "c".repeat(40) }, ausloeser: ["x"], ci: { zustand: "unbekannt", url: null } });
    expect(b).toContain("… und 3 weitere");
    expect(b).toContain("fix: a b c (#1)");
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
  it("ein werfender CI-Leser legt trotzdem an, mit Status unbekannt", () => {
    const text: string[] = [];
    T.lauf({ io: io({ ladeLaeufe: () => { throw new Error("403"); }, legeIssueAn: (_t: string, b: string) => { text.push(b); return "5"; } }) });
    expect(text[0]).toContain("CI-Status dieses Commits: unbekannt");
    expect(text[0]).toContain(`Älteste ungetaggte Änderung: ${vor(3).slice(0, 10)}`);
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
    const gemischt = T.besitzCommits([commit({ datum: vor(8) }), commit({ datum: vor(1), sha: "b".repeat(40) })], MANIFEST);
    expect(entscheide({ besitz: gemischt }).aktion).toBe("anlegen");
    const junge = T.besitzCommits([commit({ datum: vor(1) }), commit({ datum: vor(20), sha: "b".repeat(40) })].slice(0, 1), MANIFEST);
    expect(entscheide({ besitz: junge }).aktion).toBe("nichts");
  });
  it("istAktuell: Titel allein oder Body allein abweichend führt zur Aktualisierung", () => {
    let soll = { titel: "", body: "" };
    logZeilen({ ladeOffene: () => [tagOffen()], aktualisiere: (_n: number, t: string, b: string) => { soll = { titel: t, body: b }; } });
    for (const abw of [{ titel: "🏷️ Tag v9.9.9 anders" }, { body: "anderer Body" }]) {
      const aufrufe: string[] = [];
      logZeilen({ ladeOffene: () => [tagOffen({ ...soll, ...abw, titel: abw.titel ?? soll.titel })], aktualisiere: () => aufrufe.push("a") });
      expect(aufrufe, JSON.stringify(abw)).toEqual(["a"]);
    }
  });

  it("CI-Text: rot, läuft, unbekannt, Link nur mit URL", () => {
    expect(bodyVon({ ci: { zustand: "rot", url: "https://example.invalid/r" } })).toContain("CI-Status dieses Commits: ROT ([Lauf](https://example.invalid/r))");
    expect(bodyVon({ ci: { zustand: "laeuft", url: null } })).toContain("läuft noch");
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
  ])("Versionsgrenze %j → %s", (text, erwartet) => {
    expect(T.naechsterTag("v1.2.3", [commit({ betreff: text.split("\n")[0], body: text })])).toBe(erwartet);
  });
  it("ciZustand: neuester Lauf zuerst, Null-Einträge tolerant, URL nur als String", () => {
    const ci = (conclusion: string, extra = {}) => ({ path: ".github/workflows/ci.yml", status: "completed", conclusion, ...extra });
    expect(T.ciZustand([ci("failure"), ci("success")]).zustand).toBe("rot");
    expect(T.ciZustand([null, ci("success")]).zustand).toBe("gruen");
    expect(T.ciZustand([ci("success", { html_url: 5 })]).url).toBeNull();
  });
  it("besitzCommits mit kaputtem Manifest: nur das Manifest selbst zählt, kein Absturz", () => {
    for (const m of [{}, null]) {
      expect(T.besitzCommits([commit({ dateien: [".factory/besitz.json"] }), commit()], m)).toHaveLength(1);
    }
  });
});
