/* Harness-Befunde-Wächter (factory#221, Fortschreibung zu ADR 0022, Form 4 aus factory#154): Der Kern-Block der AGENTS.md und die verteilten Agenten- und Skill-Texte
 * nennen für Harness-Befunde nur den Weg `node scripts/melden.mjs`; sie unterscheiden dort nicht nach Rolle (Fabrik oder Bezieher). Regeltext nur für die Fabrik
 * (das Anlegen des Sammeltickets, Position 4) gehört in den Projekt-Block der AGENTS.md.
 *
 * Scan-Umfang (geschlossen): (a) der Kern-Block der AGENTS.md, (b) jede verteilte Ganzdatei des Besitz-Manifests unter `.claude/agents/` und `.agents/skills/` (`.md`).
 * Einheit ist der Satzteil (Zeile, geteilt nach `.`, `;`, `!`, `?` und Leerraum). Ein Fund ist ein Satzteil mit einem TRIGGER-Wort (Harness-Befund, Sammelticket, `melden.mjs` …)
 * UND einem ROLLE-Wort (Bezieher, Fabrik, Factory-Repo, Factory-Board, upstream).
 * Grenzen: eine Heuristik mit zwei Wortlisten; eine Umschreibung ohne Listenwort fällt durch (auch das blanke „Sammelticket“ und `sammelticket-anlegen.mjs` sind kein TRIGGER; die Position des Anlegens sichert `sammelticketPosition`), zwei getrennte Sätze zählen nicht als Fund. Nicht gescannt: Factory-Seiten (`docs/`),
 * der Projekt-Block (Form 4 erlaubt dort Fabrik-Text) und `.mjs`-Laufzeittexte (die Inventur der übrigen Rollen-Texte ist factory#222).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";
import { ladeBesitzManifest } from "../support/besitz-anker";

const { blockSpanne, istVerteilteGanzdatei } = rawBesitz as unknown as {
  blockSpanne: (text: string, block: string) => [number, number] | null;
  istVerteilteGanzdatei: (e: { ring: string; block?: string; schluessel?: string }) => boolean;
};

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const WEG = "Harness-Befunde nur per `node scripts/melden.mjs`; Regeltext nur für die Fabrik gehört in den Projekt-Block (Form 4, Fortschreibung factory#154)";
const TRIGGER = /Harness-Befund|Kern-Befund|Harness-Sammelticket|Harness-Härtung \(gesammelt\)|Sammelticket-Zeile|melden\.mjs/;
const ROLLE = /Bezieher|Fabrik|Factory-Repo|Factory-Board|upstream/;
const TEXT_PFAD = /^(\.claude\/agents|\.agents\/skills)\/.*\.md$/;

/** Pur: Meldungen `<pfad>:<zeile>: nennt für Harness-Befunde eine Rolle: …` (leer = grün); `ab` ist die Zeilennummer der ersten Zeile von `text`. */
export function rollenFunde(pfad: string, text: string, ab = 1): string[] {
  return text.split("\n").flatMap((zeile, i) =>
    zeile.split(/(?<=[.;!?])\s+/).flatMap((teil) => (TRIGGER.test(teil) && ROLLE.test(teil) ? [`${pfad}:${ab + i}: nennt für Harness-Befunde eine Rolle („${teil.slice(0, 80)}“): ${WEG}`] : [])),
  );
}

const lies = (pfad: string) => readFileSync(`${WURZEL}${pfad}`, "utf8");

/** Der Kern-Block der AGENTS.md (Text und Zeilennummer seiner ersten Zeile). */
function kernBlock(): { text: string; ab: number } {
  const agents = lies("AGENTS.md");
  const s = blockSpanne(agents, "kern");
  if (s === null) throw new Error("AGENTS.md: Kern-Block nicht gefunden (Marker fehlen)");
  return { text: agents.slice(s[0], s[1]), ab: agents.slice(0, s[0]).split("\n").length };
}

/** Pur-nah: die verteilten Textdateien (ganze Datei, `.md` unter `.claude/agents` und `.agents/skills`) des Besitz-Manifests. */
type Eintrag = { pfad: string; ring: string; block?: string; schluessel?: string };
function umfang(eintraege: Eintrag[] = ladeBesitzManifest<Eintrag>().eintraege): string[] {
  return [...new Set(eintraege.filter((e) => istVerteilteGanzdatei(e) && TEXT_PFAD.test(e.pfad)).map((e) => e.pfad))].sort();
}

function scanne(): string[] {
  const k = kernBlock();
  return [...rollenFunde("AGENTS.md#kern", k.text, k.ab), ...umfang().flatMap((p) => rollenFunde(p, lies(p)))];
}

describe("Harness-Befunde nur per melden.mjs (factory#221)", () => {
  test("der echte Scan (Kern-Block und verteilte Agenten-/Skill-Texte) ist leer", () => {
    expect(scanne()).toEqual([]);
  });

  test("ein ROLLE-Wort mit einem Harness-Befund-Wort im selben Satzteil ist ein Fund", () => {
    for (const z of [
      "Harness-Befunde als Zeile im Sammelticket des Factory-Repos.",
      "Ein Bezieher meldet Kern-Befunde per `node scripts/melden.mjs`.",
      "das Harness-Sammelticket legt nur die Fabrik an",
      "Sammelticket-Zeile upstream melden",
    ]) {
      const f = rollenFunde("x.md", z);
      expect(f, z).toHaveLength(1);
      expect(f[0]).toContain("x.md:1: nennt für Harness-Befunde eine Rolle");
      expect(f[0]).toContain("node scripts/melden.mjs");
    }
  });

  test("jede Alternative der Wortlisten löst allein (mit genau einem Wort der Gegenliste) einen Fund aus", () => {
    for (const z of ["Harness-Befund beim Bezieher", "Kern-Befunde beim Bezieher", "Harness-Sammelticket beim Bezieher", "Harness-Härtung (gesammelt) beim Bezieher", "Sammelticket-Zeile beim Bezieher", "melden.mjs beim Bezieher"]) expect(rollenFunde("x.md", z), z).toHaveLength(1);
    for (const z of ["melden.mjs beim Bezieher", "melden.mjs in der Fabrik", "melden.mjs im Factory-Repo", "melden.mjs auf dem Factory-Board", "melden.mjs upstream"]) expect(rollenFunde("x.md", z), z).toHaveLength(1);
  });

  test("Satzende mit ! oder ? trennt die Satzteile", () => {
    expect(rollenFunde("x.md", "Ein Bezieher holt Updates! Harness-Befunde per melden.mjs.")).toEqual([]);
    expect(rollenFunde("x.md", "Holt ein Bezieher Updates? Harness-Befunde per melden.mjs.")).toEqual([]);
  });

  test("nur Markdown unter .claude/agents und .agents/skills zählt zur Scan-Menge", () => {
    const e = (pfad: string, ring = "kern") => ({ pfad, ring });
    const eintraege = [
      e(".claude/agents/a.md"),
      e(".claude/agents/a.md"), // doppelter Pfad: einmal gescannt
      e(".agents/skills/x/b.md"),
      e(".claude/agents/c.json"),
      e("docs/d.md"),
      e(".claude/agents/o.md", "oberflaeche"), // nur in der Fabrik: darf die Fabrik nennen
      { ...e(".claude/agents/blk.md"), block: "b" }, // nur ein Block der Datei
      e(".claude/agents/c.md.bak"),
      e("x/.claude/agents/e.md"),
    ];
    expect(umfang(eintraege)).toEqual([".agents/skills/x/b.md", ".claude/agents/a.md"]);
  });

  test("rollenneutral oder in getrennten Sätzen: kein Fund; die Zeilennummer zählt ab `ab`", () => {
    expect(rollenFunde("x.md", "Harness-Befunde per `node scripts/melden.mjs --zeile \"<Zeile>\"` eintragen.")).toEqual([]);
    expect(rollenFunde("x.md", "Ein Bezieher holt Updates. Harness-Befunde per melden.mjs.")).toEqual([]);
    expect(rollenFunde("x.md", "Ein Bezieher holt Updates; Harness-Befunde per melden.mjs.")).toEqual([]);
    expect(rollenFunde("x.md", "nichts\nHarness-Befund beim Bezieher", 10)[0]).toContain("x.md:11:");
  });

  test("Pflicht-Positivstelle: der Kern-Bullet „Harness-Befunde sind Zeilen“ nennt `node scripts/melden.mjs` (kein leeres Grün)", () => {
    const bullet = kernBlock().text.split("\n").find((z) => z.includes("Harness-Befunde sind Zeilen, keine Tickets"));
    expect(bullet).toBeDefined();
    expect(bullet).toContain("`node scripts/melden.mjs`");
  });

  test("fail-closed: die Scan-Menge enthält den Ticket-Ablauf und den Umsetzer-Agenten", () => {
    const u = umfang();
    expect(u).toContain(".agents/skills/factory/ablauf.md");
    expect(u).toContain(".claude/agents/factory-umsetzer.md");
    expect(kernBlock().text.length).toBeGreaterThan(1000);
  });
});
