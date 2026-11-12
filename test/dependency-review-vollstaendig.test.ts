import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/dependency-review-vollstaendig.mjs";

type Vuln = { severity: string; advisory_ghsa_id: string; advisory_summary: string; advisory_url: string };
type Eintrag = { change_type: string; manifest: string; ecosystem: string; name: string; version: string; scope: string; vulnerabilities: Vuln[] };
type Deps = { env: Record<string, string | undefined>; ladeVergleich: (repo: string, basis: string, kopf: string) => unknown; log: (t: string) => void; err: (t: string) => void };
const D = raw as unknown as {
  befundeAusVergleich: (eintraege: unknown, o: { schwere: string }) => { manifest: string; name: string; ghsa: string; schwere: string }[];
  main: (argv: string[], deps: Deps) => number;
};

const BASIS = "a".repeat(40);
const KOPF = "b".repeat(40);
const vuln = (severity: string, ghsa = "GHSA-aaaa-bbbb-cccc"): Vuln => ({ severity, advisory_ghsa_id: ghsa, advisory_summary: "s", advisory_url: `https://github.com/advisories/${ghsa}` });
const eintrag = (o: Partial<Eintrag> = {}): Eintrag => ({ change_type: "added", manifest: "package-lock.json", ecosystem: "npm", name: "p", version: "1.0.0", scope: "runtime", vulnerabilities: [], ...o });
const sauber = eintrag();
const pom = (o: Partial<Eintrag> = {}) => eintrag({ manifest: "backend/app/pom.xml", ecosystem: "maven", name: "org.apache.tomcat:tomcat", vulnerabilities: [vuln("high")], ...o });

describe("befundeAusVergleich (factory#395 L4)", () => {
  test("Negativfall: Advisory nur im zweiten Manifest wird gefunden", () => {
    const b = D.befundeAusVergleich([sauber, pom()], { schwere: "high" });
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ manifest: "backend/app/pom.xml", name: "org.apache.tomcat:tomcat", ghsa: "GHSA-aaaa-bbbb-cccc", schwere: "high" });
  });

  test("entfernte Abhängigkeit und Dev-Scope sind kein Befund, unknown-Scope schon", () => {
    expect(D.befundeAusVergleich([pom({ change_type: "removed" })], { schwere: "high" })).toEqual([]);
    expect(D.befundeAusVergleich([pom({ scope: "development" })], { schwere: "high" })).toEqual([]);
    expect(D.befundeAusVergleich([pom({ scope: "unknown" })], { schwere: "high" })).toHaveLength(1);
  });

  test("Schwelle: moderate unter high kein Befund, critical über high schon, Schwelle moderate nimmt moderate", () => {
    expect(D.befundeAusVergleich([pom({ vulnerabilities: [vuln("moderate")] })], { schwere: "high" })).toEqual([]);
    expect(D.befundeAusVergleich([pom({ vulnerabilities: [vuln("critical")] })], { schwere: "high" })).toHaveLength(1);
    expect(D.befundeAusVergleich([pom({ vulnerabilities: [vuln("moderate")] })], { schwere: "moderate" })).toHaveLength(1);
  });

  test("unbekannte Schwere zählt als Treffer (fail-closed), auch ein Objekt-Eigenschaftsname", () => {
    expect(D.befundeAusVergleich([pom({ vulnerabilities: [vuln("constructor")] })], { schwere: "high" })).toHaveLength(1);
    expect(D.befundeAusVergleich([pom({ vulnerabilities: [vuln("seltsam")] })], { schwere: "high" })).toHaveLength(1);
  });

  test("Eintrag ohne vulnerabilities-Liste ist kein Befund; keine Liste wirft", () => {
    expect(D.befundeAusVergleich([{ ...sauber, vulnerabilities: undefined }], { schwere: "high" })).toEqual([]);
    expect(() => D.befundeAusVergleich({ message: "Not Found" }, { schwere: "high" })).toThrow(/keine Liste/);
  });
});

describe("main", () => {
  const lauf = (argv: string[], antwort: unknown, env: Record<string, string | undefined> = { GITHUB_REPOSITORY: "o/r", BASIS, KOPF }) => {
    const log: string[] = [];
    const aufrufe: string[][] = [];
    const ladeVergleich = (repo: string, basis: string, kopf: string) => {
      aufrufe.push([repo, basis, kopf]);
      if (antwort instanceof Error) throw antwort;
      return antwort;
    };
    const code = D.main(argv, { env, ladeVergleich, log: (t) => log.push(t), err: (t) => log.push(t) });
    return { code, log: log.join("\n"), aufrufe };
  };

  test("Negativfall: Advisory nur im zweiten Manifest ist rot (Exit 1) und im Log benannt", () => {
    const l = lauf(["--schwere", "high"], [sauber, pom()]);
    expect(l.code).toBe(1);
    expect(l.log).toContain("backend/app/pom.xml");
    expect(l.log).toContain("GHSA-aaaa-bbbb-cccc");
    expect(l.aufrufe).toEqual([["o/r", BASIS, KOPF]]);
  });

  test("sauberer Vergleich: Exit 0", () => {
    expect(lauf(["--schwere", "high"], [sauber, pom({ vulnerabilities: [] })]).code).toBe(0);
  });

  test("Antwort keine Liste oder Abfrage scheitert: Exit 2 (fail-closed)", () => {
    expect(lauf(["--schwere", "high"], { message: "x" }).code).toBe(2);
    expect(lauf(["--schwere", "high"], new Error("403")).code).toBe(2);
  });

  test.each([
    ["BASIS kein 40-hex", { GITHUB_REPOSITORY: "o/r", BASIS: "main", KOPF }],
    ["KOPF kein 40-hex", { GITHUB_REPOSITORY: "o/r", BASIS, KOPF: "$(x)" }],
    ["Repo nicht owner/name", { GITHUB_REPOSITORY: "o/r/../x", BASIS, KOPF }],
    ["Repo fehlt", { BASIS, KOPF }],
  ])("%s: Exit 2, kein Aufruf", (_n, env) => {
    const l = lauf(["--schwere", "high"], [], env);
    expect(l.code).toBe(2);
    expect(l.aufrufe).toEqual([]);
  });

  test.each([[[]], [["--schwere"]], [["--schwere", "unbekannt"]], [["--schwere", "constructor"]], [["--schwere", "high", "x"]]])("falsche Bedienung %j: Exit 2", (argv) => {
    const l = lauf(argv, []);
    expect(l.code).toBe(2);
    expect(l.aufrufe).toEqual([]);
  });
});
