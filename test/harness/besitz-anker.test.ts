/* Test-Hilfe `besitzAnker` (#1933): der Leerlauf-Schutz der Kern-Tests liefert verteilte Besitz-Pfade und wirft, wenn keiner passt.
 *
 * @harness-waechter – Kern-Test: Gegenstand ist das Besitz-Manifest und der Helfer, der es für Scans liest.
 */
import { afterEach, describe, test, vi } from "vitest";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { besitzAnker, ladeBesitzManifest } from "../support/besitz-anker";
import { fixture } from "../support/tmp-fixture";

const E = (pfad: string, ring = "kern") => ({ pfad, ring });
const M = (pfad: string, modul: string) => ({ pfad, ring: "kern", modul });
const WURZEL = fileURLToPath(new URL("../../", import.meta.url));

describe("besitzAnker", () => {
  test("liefert eindeutige, sortierte Pfade der verteilten Einträge, die das Prädikat erfüllen", () => {
    const eintraege = [E("b/zwei.md"), E("a/eins.md"), E("a/eins.md"), E("c/drei.txt")];
    assert.deepEqual(besitzAnker((p) => p.endsWith(".md"), eintraege), ["a/eins.md", "b/zwei.md"]);
  });

  test("Einträge des Rings oberflaeche werden nicht verteilt und zählen nicht als Anker", () => {
    const eintraege = [E("nur/factory.md", "oberflaeche"), E("verteilt.md", "kern-nach-entkopplung")];
    assert.deepEqual(besitzAnker(() => true, eintraege), ["verteilt.md"]);
  });

  test("Negativfall: passt kein Pfad, wirft der Helfer mit „Leerlauf-Schutz“", () => {
    assert.throws(() => besitzAnker((p) => p.startsWith("gibt/es/nicht"), [E("a.md")]), /Leerlauf-Schutz/);
    assert.throws(() => besitzAnker(() => true, [E("nur/factory.md", "oberflaeche")]), /Leerlauf-Schutz/);
    assert.throws(() => besitzAnker(() => true, []), /Leerlauf-Schutz/);
  });

  test("ohne Manifest-Argument liest der Helfer das echte Besitz-Manifest (nicht leer)", () => {
    assert.ok(besitzAnker(() => true).length > 0);
  });
});

describe("besitzAnker und Modul-Wahl (factory#146)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const eintraege = [E("kern.md"), M("m/a.yml", "a"), M("m/b.yml", "b")];

  test("zählt Einträge ohne modul und solche mit gewähltem Modul, nicht die anderer Module", () => {
    assert.deepEqual(besitzAnker(() => true, eintraege, ["a"]), ["kern.md", "m/a.yml"]);
    assert.deepEqual(besitzAnker(() => true, eintraege, []), ["kern.md"]);
  });

  test("Negativfall: filtert die Wahl alles weg, wirft der Helfer und nennt die gewählten Module", () => {
    const nurModul = [M("m/a.yml", "a")];
    assert.throws(() => besitzAnker(() => true, nurModul, []), /gewählte Module: keine/);
    assert.throws(() => besitzAnker(() => true, nurModul, ["b"]), /gewählte Module: b\)/);
  });

  test("echtes Manifest bei Wahl dependabot-inbox: kein Pfad eines nicht gewählten Moduls, alle des gewählten", () => {
    const alle = ladeBesitzManifest<{ pfad: string; ring: string; modul?: string }>().eintraege;
    const abgewaehlt = alle.filter((e) => e.modul !== undefined && e.modul !== "dependabot-inbox").map((e) => e.pfad);
    assert.ok(abgewaehlt.length > 0, "Leerlauf-Schutz: das Manifest hat Einträge anderer Module");
    const anker = besitzAnker(() => true, undefined, ["dependabot-inbox"]);
    for (const p of abgewaehlt) assert.ok(!anker.includes(p), `${p} darf nicht zählen`);
    for (const e of alle.filter((x) => x.modul === "dependabot-inbox")) assert.ok(anker.includes(e.pfad), `${e.pfad} fehlt`);
  });

  test("Wahl mit zizmor enthält den zizmor-Workflow", () => {
    assert.ok(besitzAnker(() => true, undefined, ["dependabot-inbox", "zizmor"]).includes(".github/workflows/zizmor.yml"));
  });

  test("ohne Wahl-Argument gilt die Projekt-Config (Standard ohne Schlüssel, sonst der Schlüssel module)", () => {
    const mit = (config: object) => {
      const pfad = join(fixture({ "projekt.json": JSON.stringify(config) }), "projekt.json");
      vi.stubEnv("FACTORY_PROJEKT_CONFIG", pfad);
      vi.stubEnv("FACTORY_PROJEKT_WURZEL", WURZEL);
      return besitzAnker(() => true);
    };
    const standard = mit({});
    assert.deepEqual(standard, besitzAnker(() => true, undefined, ["dependabot-inbox"]));
    assert.ok(!standard.includes(".github/workflows/zizmor.yml"));
    const gewaehlt = mit({ module: ["zizmor"] });
    assert.ok(gewaehlt.includes(".github/workflows/zizmor.yml"));
    assert.ok(!gewaehlt.includes(".github/workflows/dependabot-inbox.yml"));
  });
});

describe("ladeBesitzManifest", () => {
  test("liefert das echte Manifest mit Version und Einträgen, jeder Eintrag mit Pfad und Ring", () => {
    const m = ladeBesitzManifest();
    assert.equal(m.version, 3);
    assert.ok(m.eintraege.length > 50);
    assert.ok(m.eintraege.every((e) => typeof e.pfad === "string" && e.pfad !== "" && typeof e.ring === "string"));
  });
});
