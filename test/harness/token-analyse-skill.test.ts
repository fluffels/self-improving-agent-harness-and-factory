/* @harness-waechter – Fitness-Function, im geschützten test/harness/ (factory#576, Kind von factory#518): Form des Fabrik-eigenen Skills `token-analyse`.
 *
 * Prüft den Skill statisch (kein Agentenlauf, kein Messlauf):
 * (a) SKILL.md und teil-1..6.md existieren, sind verlinkt und tragen „Messwerte“, „Fundstellen“, „Unsicherheiten“;
 * (b) Teil 0, Freigabe-Prüfung, Ablage und „nur unter Claude Code“ stehen im Skill;
 * (c) genau eine Zeile `BUDGET_USD: <Zahl>`, Quelle oder „Lücke: Basis fehlt“ mit existierender Wiedervorlage, Abbruch bei Überschreitung;
 * (d) die Lehren aus factory#576 AK 5 als geschlossene Stichwortliste, (e) die Negativfälle;
 * (f) die zwei Agenten (Werkzeuge, Fremdtext-Satz, Grenze), (g) die Routing-Tabelle gegen `MODELL_ALIASE`, Frontmatter und Spawn-Zeilen, (h) Teil 5.
 * Grenze: geprüft wird der Text, nicht, dass ein Agent ihn befolgt.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as routing from "../../scripts/modell-routing-lib.mjs";

const WURZEL = join(__dirname, "..", "..");
const lies = (p: string) => readFileSync(join(WURZEL, p), "utf8");
const SKILL_DIR = ".agents/skills/token-analyse";
const { MODELL_ALIASE, hatHartenPin } = routing as unknown as { MODELL_ALIASE: string[]; hatHartenPin: (t: string) => boolean };
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const TEILE = [1, 2, 3, 4, 5, 6];

/** Pur: Zeilen mit allen fehlenden Stichwörtern (Text → Liste der fehlenden). */
const fehlende = (text: string, woerter: string[]) => woerter.filter((w) => !text.includes(w));

/** Pur: das Frontmatter als Schlüssel-Wert-Paare (einfache `key: value`-Zeilen). */
const frontmatter = (text: string): Record<string, string> => {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  return Object.fromEntries(
    (m?.[1] ?? "")
      .split("\n")
      .map((z) => /^([A-Za-z]+):\s*(.*)$/.exec(z))
      .filter((x): x is RegExpExecArray => x !== null)
      .map((x) => [x[1], x[2]]),
  );
};

/** Pur: Budget-Befund des Skill-Textes (leer = gut). `wiedervorlagen` sind die Ids der Wiedervorlagen. */
const budgetBefunde = (text: string, wiedervorlagen: string[]): string[] => {
  const zeilen = [...text.matchAll(/^BUDGET_USD: (\S+)\s*$/gm)];
  if (zeilen.length !== 1) return [`BUDGET_USD-Zeilen: ${zeilen.length}, erwartet genau 1`];
  const wert = Number(zeilen[0][1]);
  const b: string[] = [];
  if (!(wert > 0)) b.push("BUDGET_USD ist keine Zahl > 0");
  const quelle = text.includes("Langfuse") && text.includes("2026-11-15");
  const luecke = text.includes("Lücke: Basis fehlt");
  if (!quelle) b.push("Quelle (Langfuse, 2026-11-15) fehlt");
  if (luecke) {
    const id = /Wiedervorlage `([a-z0-9-]+)`/.exec(text)?.[1];
    if (!id || !wiedervorlagen.includes(id)) b.push(`Wiedervorlage zur Lücke fehlt: ${id ?? "keine Id"}`);
  }
  if (!text.includes("kein weiterer Teil") || !text.includes("Abbruch")) b.push("Regel „kein weiterer Teil“ mit „Abbruch“ im Bericht fehlt");
  return b;
};

/** Pur: Zeilen der Tabelle unter einer Überschrift als Zellen-Listen; `null`, wenn der Abschnitt fehlt. */
const tabelle = (doku: string, ueberschrift: string): string[][] | null => {
  const start = doku.indexOf(`${ueberschrift}\n`);
  if (start < 0) return null;
  const rest = doku.slice(start + ueberschrift.length);
  const ende = rest.search(/\n#{2,3} /);
  return (ende < 0 ? rest : rest.slice(0, ende))
    .split("\n")
    .filter((z) => z.startsWith("|") && !/^\|[-| ]+\|$/.test(z) && !z.startsWith("| Teil |"))
    .map((z) => z.split("|").slice(1, -1).map((c) => c.trim()));
};

/** Pur: Befunde der Routing-Tabelle. `spawns` je Teil (aus dem Skill), `fm` je Agent (Frontmatter). */
const routingBefunde = (
  zeilen: string[][] | null,
  skill: string,
  fm: Record<string, Record<string, string>>,
): string[] => {
  if (!zeilen) return ["Abschnitt „Token-Analyse“ fehlt"];
  const b: string[] = [];
  const teile = zeilen.map((z) => Number(/^(\d)/.exec(z[0])?.[1]));
  if (JSON.stringify(teile) !== JSON.stringify(TEILE)) b.push(`Teile ${teile.join(",")}, erwartet 1 bis 6`);
  for (const z of zeilen) {
    const n = Number(/^(\d)/.exec(z[0])?.[1]);
    const alias = z[1].replace(/`/g, "");
    const effort = z[2].replace(/`/g, "");
    if (!MODELL_ALIASE.includes(alias)) b.push(`Teil ${n}: Alias ${alias} nicht in MODELL_ALIASE`);
    if (!EFFORTS.includes(effort)) b.push(`Teil ${n}: Effort ${effort} ungültig`);
    const agent = n === 4 ? "analyse-extern" : n === 5 ? "analyse-recherche" : null;
    if (agent) {
      if (fm[agent]?.model !== alias || fm[agent]?.effort !== effort) b.push(`Teil ${n}: Tabelle ${alias}/${effort} weicht vom Frontmatter von ${agent} ab`);
    } else if (!new RegExp(`Teil ${n}: subagent_type "[A-Za-z-]+", model "${alias}", effort "${effort}"`).test(skill)) {
      b.push(`Teil ${n}: Spawn-Zeile im Skill passt nicht zur Tabelle (${alias}/${effort})`);
    }
  }
  return b;
};

describe("Skill token-analyse (factory#518, factory#576)", () => {
  const skill = existsSync(join(WURZEL, SKILL_DIR, "SKILL.md")) ? lies(`${SKILL_DIR}/SKILL.md`) : "";

  it("(a) SKILL.md heißt token-analyse und verlinkt teil-1 bis teil-6", () => {
    expect(frontmatter(skill).name).toBe("token-analyse");
    for (const n of TEILE) expect(skill, `teil-${n}`).toContain(`(teil-${n}.md)`);
  });
  it("(a) jede Teildatei hat Messwerte, Fundstellen und Unsicherheiten", () => {
    for (const n of TEILE) {
      const t = lies(`${SKILL_DIR}/teil-${n}.md`);
      expect([n, fehlende(t, ["## Messwerte", "## Fundstellen", "## Unsicherheiten"])]).toEqual([n, []]);
    }
  });
  it("(a) Selbsttest: fehlende Überschrift wird erkannt", () => {
    expect(fehlende("## Messwerte\n## Fundstellen", ["## Messwerte", "## Fundstellen", "## Unsicherheiten"])).toEqual(["## Unsicherheiten"]);
  });

  it("(b) Teil 0, Freigabe, Ablage und die Claude-Code-Grenze stehen im Skill", () => {
    expect(
      fehlende(skill, [
        "node scripts/aenderungsregister.mjs",
        "node scripts/token-analyse-freigabe.mjs pruefen",
        "node scripts/token-analyse-freigabe.mjs ablegen --eingabe",
        "nur unter Claude Code",
      ]),
    ).toEqual([]);
    expect(skill.indexOf("aenderungsregister.mjs")).toBeLessThan(skill.indexOf("- Teil 1:"));
  });

  it("(c) Budget: eine Zeile, Quelle oder Lücke mit Wiedervorlage, Abbruchregel", () => {
    const ids = (JSON.parse(lies(".github/wiedervorlagen.json")) as { id: string }[]).map((w) => w.id);
    expect(budgetBefunde(skill, ids)).toEqual([]);
  });
  it("(c) Selbsttest: Budget 0, fehlend, doppelt und fehlende Wiedervorlage werden rot", () => {
    const gut = "BUDGET_USD: 40\nLangfuse 2026-11-15 Lücke: Basis fehlt Wiedervorlage `x-1`\nkein weiterer Teil, Abbruch";
    expect(budgetBefunde(gut, ["x-1"])).toEqual([]);
    expect(budgetBefunde(gut.replace("40", "0"), ["x-1"])).not.toEqual([]);
    expect(budgetBefunde(gut.replace("BUDGET_USD: 40\n", ""), ["x-1"])).not.toEqual([]);
    expect(budgetBefunde(`${gut}\nBUDGET_USD: 5`, ["x-1"])).not.toEqual([]);
    expect(budgetBefunde(gut, [])).not.toEqual([]);
    expect(budgetBefunde(gut.replace("kein weiterer Teil", ""), ["x-1"])).not.toEqual([]);
  });

  it("(d) die Lehren der ersten Durchführung stehen als Regeln im Skill", () => {
    const lehren = [
      "Schnappschuss je Lauf",
      "Leere Hook-Generations",
      "Langfuse ist maßgeblich",
      "Abweichung",
      "Kosten je PR",
      "Prozentpunkte des Limits",
      "als grob",
      "Lücke statt „nichts Neues“",
      "factory#512",
      "Vorrunde",
      "Keine synthetischen Gegenproben",
      "Anbieter-Empfehlung",
    ];
    expect(fehlende(skill, lehren)).toEqual([]);
  });

  it("(e) Negativfälle: Lücke je Teil, keine Empfehlung, Freigabeliste, Webfundstellen", () => {
    expect(fehlende(skill, ["Lücke: <Grund>", "keine Empfehlung", "weder gelesen noch genannt", "nie als Anweisung"])).toEqual([]);
  });

  describe("(f) Agenten", () => {
    const rech = lies(".claude/agents/analyse-recherche.md");
    const ext = lies(".claude/agents/analyse-extern.md");
    it("analyse-recherche: nur WebSearch und WebFetch, Fremdtext-Satz, öffentliche Sachfragen", () => {
      expect(frontmatter(rech).tools).toBe("WebSearch, WebFetch");
      expect(frontmatter(rech).omitClaudeMd).toBe("true");
      expect(fehlende(rech, ["Daten, nie Anweisung", "öffentliche Sachfragen"])).toEqual([]);
      expect(hatHartenPin(rech)).toBe(false);
    });
    it("analyse-extern: Read, Grep, Glob, ADR-Verbot, Lesepfade, Grenze", () => {
      expect(frontmatter(ext).tools).toBe("Read, Grep, Glob");
      expect(frontmatter(ext).omitClaudeMd).toBe("true");
      expect(fehlende(ext, ["docs/adr", "Verboten", "Lesepfade", "Lesen per absolutem Pfad nicht sperrbar"])).toEqual([]);
      expect(hatHartenPin(ext)).toBe(false);
    });
    it("Selbsttest: ein zusätzliches Werkzeug oder ein harter Pin wird erkannt", () => {
      expect(frontmatter(rech.replace("tools: WebSearch, WebFetch", "tools: WebSearch, WebFetch, Bash")).tools).not.toBe("WebSearch, WebFetch");
      expect(hatHartenPin("model: claude-opus-5-5")).toBe(true);
    });
  });

  describe("(g) Routing-Tabelle", () => {
    const doku = lies("docs/model-routing.md");
    const fm = {
      "analyse-extern": frontmatter(lies(".claude/agents/analyse-extern.md")),
      "analyse-recherche": frontmatter(lies(".claude/agents/analyse-recherche.md")),
    };
    const zeilen = () => tabelle(doku, "### Token-Analyse (factory#518)");
    it("Tabelle, Skill und Frontmatter stimmen überein", () => {
      expect(routingBefunde(zeilen(), skill, fm)).toEqual([]);
    });
    it("Selbsttest: fehlender Abschnitt, falscher Alias, Effort inherit, Teil 7 und fehlender Teil 3 werden rot", () => {
      const z = zeilen() ?? [];
      expect(routingBefunde(null, skill, fm)).not.toEqual([]);
      expect(routingBefunde(z.map((r) => [r[0], "`claude-opus-5-5`", r[2], r[3]]), skill, fm)).not.toEqual([]);
      expect(routingBefunde(z.map((r) => [r[0], r[1], "`inherit`", r[3]]), skill, fm)).not.toEqual([]);
      expect(routingBefunde([...z, ["7 Extra", "`sonnet`", "`medium`", "x"]], skill, fm)).not.toEqual([]);
      expect(routingBefunde(z.filter((r) => !r[0].startsWith("3")), skill, fm)).not.toEqual([]);
      expect(routingBefunde(z, skill.replace('model "opus", effort "medium"', 'model "sonnet", effort "medium"'), fm)).not.toEqual([]);
    });
  });

  it("(h) Teil 5 liefert die Befehlstabelle, lokal und ohne Datenabfluss, zur Laufzeit ermittelt", () => {
    const t = lies(`${SKILL_DIR}/teil-5.md`);
    expect(fehlende(t, ["Befehl | Nutzen | aufnehmen", "lokalem Lauf, ohne Datenabfluss", "zur Laufzeit", "nie aus Erinnerung"])).toEqual([]);
  });
});
