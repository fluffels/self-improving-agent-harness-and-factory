/* Verbleib-Wächter (factory#307): eine Regel, die ein Gate erzwingt, darf beim Kürzen eines Agenten- oder Skill-Prompts nicht verschwinden, ohne dass ihr Verbleib benannt ist.
 * Die Verbleib-Liste `verbleib-liste.json` nennt je Datei des Scan-Umfangs und je Regel den Ort, an dem die Regel steht, samt gespeichertem Text.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Scan-Umfang (geschlossene Liste, `SCAN_DATEIEN`): `.claude/agents/factory-umsetzer.md`, `.agents/skills/review-lenses/SKILL.md`.
 * Regeln (geschlossene Liste, `REGELN`): `commit-plan`, `commit-review`, `commit-abnahme` (die Nachweis-Commit-Zeilen, als Token), `pre-flight` (Irreversibles oder Außenwirkung führt zum Stopp, wortgleich),
 * `fremdtext` (Kommentare nur über `scripts/fremdtext.mjs`, wortgleich). Die Sicherheitsregel im Umfang ist das Fremdtext-Gate; weitere Regeln, Dateien und Orte kommen nur in diese beiden Listen.
 * Zulässiger Ort einer Regel: eine Datei, die die Rolle tatsächlich liest: `AGENTS.md`, die Datei selbst, oder eine bedingte Datei unter `.claude/agents/` bzw. `.agents/skills/` mit nicht-leerer `bedingung`, auf die die Datei
 * per Pfad verweist. `docs/` und ein Archiv zählen nie.
 * Wortgleich heißt: der gespeicherte Satz steht (Leerraum normalisiert) am Ort, enthält das Kern-Token der Regel, ist mindestens 80 Zeichen lang und endet an einer Satzgrenze (`.`, `,`, `;` oder `:`), ist also ein wörtlicher Satz oder Satzanfang, kein Stichwort; die Pre-Flight-Kriterienliste darf nach test/harness/harness-approval.test.ts nur in AGENTS.md stehen, darum endet der gespeicherte Satzanfang vor ihr.
 * Grenze: geprüft wird, ob der gespeicherte Text am Ort steht, nicht ob er dasselbe bedeutet; ein umformulierter Satz muss in der Liste nachgezogen werden und fällt im Review auf. Der Pfad-Check für bedingte Orte ist textuell: ein Pfad mit `..` unter .agents/skills/ wird nicht aufgelöst.
 * Strengere Einzelwächter gelten zusätzlich (Epic factory#273, Kinder factory#308 bis factory#310): test/harness/fremdtext-gate.test.ts (b) verlangt das Fremdtext-Skript in der Rollendatei, test/harness/model-routing.test.ts (`umsetzerRegelOk`, `planerRegelOk`) die Weichen-Regel in der Rollendatei; wirksam ist der strengste Ort, wer eine Regel verlegt, prüft beide.
 * Verfall: Prüftermin laut `.github/wiedervorlagen.json` (Eintrag `regeln-verfall-2027-03`, ADR 0027). Begriff: `docs/harness-glossar.md` › Verbleib-Liste. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));

const SCAN_DATEIEN = [".claude/agents/factory-umsetzer.md", ".agents/skills/review-lenses/SKILL.md"] as const;
type RegelArt = { art: "token" | "wortgleich"; kern: string };
const REGELN: Record<string, RegelArt> = {
  "commit-plan": { art: "token", kern: "<praefixe.commitZeile>Plan:" },
  "commit-review": { art: "token", kern: "<praefixe.commitZeile>Review:" },
  "commit-abnahme": { art: "token", kern: "<praefixe.commitZeile>Abnahme:" },
  "pre-flight": { art: "wortgleich", kern: "Außenwirkung" },
  fremdtext: { art: "wortgleich", kern: "scripts/fremdtext.mjs" },
};
const MIN_LAENGE = 80;

interface Eintrag {
  datei: string;
  regel: string;
  ort: string;
  bedingung: string;
  text: string;
}

const norm = (s: string): string => s.replace(/\r/g, "").replace(/\s+/g, " ").trim();
const bedingterOrt = (ort: string): boolean => /^(\.claude\/agents\/[^/]+|\.agents\/skills\/.+)\.md$/.test(ort);

/** Pur: Befunde der Verbleib-Liste (leer = grün). `lies(pfad)` liefert den Text oder `null` (Datei fehlt). */
function verbleibBefunde({ eintraege, lies }: { eintraege: Eintrag[]; lies: (pfad: string) => string | null }): string[] {
  const out: string[] = [];
  for (const datei of SCAN_DATEIEN) {
    for (const regel of Object.keys(REGELN)) {
      const n = eintraege.filter((e) => e.datei === datei && e.regel === regel).length;
      if (n !== 1) out.push(`${datei} × ${regel}: ${n} Einträge in der Verbleib-Liste, genau einer verlangt`);
    }
  }
  for (const e of eintraege) {
    const id = `${e.datei} × ${e.regel}`;
    const art = REGELN[e.regel];
    if (!(SCAN_DATEIEN as readonly string[]).includes(e.datei) || art === undefined) {
      out.push(`${id}: Eintrag außerhalb des Scan-Umfangs (Datei oder Regel nicht in der geschlossenen Liste)`);
      continue;
    }
    out.push(...eintragBefunde(e, art, id, lies));
  }
  return out;
}

function eintragBefunde(e: Eintrag, art: RegelArt, id: string, lies: (pfad: string) => string | null): string[] {
  const out: string[] = [];
  const text = norm(e.text);
  if (!text.includes(art.kern)) out.push(`${id}: der gespeicherte Text enthält das Kern-Token „${art.kern}“ nicht`);
  if (art.art === "wortgleich" && text.length < MIN_LAENGE) out.push(`${id}: wortgleiche Regel kürzer als ${MIN_LAENGE} Zeichen (ein ganzer Satz, kein Stichwort)`);
  if (art.art === "wortgleich" && !/[.,;:]$/.test(text)) out.push(`${id}: wortgleiche Regel endet nicht an einer Satzgrenze (wörtlicher Satz oder Satzanfang)`);
  const eigen = e.ort === e.datei || e.ort === "AGENTS.md";
  if (!eigen && !bedingterOrt(e.ort)) {
    out.push(`${id}: unzulässiger Ort ${e.ort} (zulässig: AGENTS.md, die Datei selbst, eine bedingte Datei unter .claude/agents/ oder .agents/skills/; nie docs/ oder ein Archiv)`);
    return out;
  }
  if (!eigen) {
    if (e.bedingung.trim() === "") out.push(`${id}: der bedingte Ort ${e.ort} nennt keine Bedingung`);
    if (!norm(lies(e.datei) ?? "").includes(e.ort)) out.push(`${id}: ${e.datei} verweist nicht per Pfad auf den bedingten Ort ${e.ort}`);
  }
  const ortText = lies(e.ort);
  if (ortText === null) out.push(`${id}: der Ort ${e.ort} fehlt`);
  else if (!norm(ortText).includes(text)) out.push(`${id}: der gespeicherte Text steht in ${e.ort} nicht (mehr); Verbleib benennen oder die Regel zurückholen`);
  return out;
}

const echteListe = (): Eintrag[] => (JSON.parse(readFileSync(WURZEL + "test/harness/verbleib-liste.json", "utf8")) as { eintraege: Eintrag[] }).eintraege;
const echtLesen = (pfad: string): string | null => (existsSync(WURZEL + pfad) ? readFileSync(WURZEL + pfad, "utf8") : null);

describe("Verbleib gate-erzwungener Regeln", () => {
  test("jede Regel des Scan-Umfangs steht an dem Ort, den die Verbleib-Liste nennt", () => {
    const eintraege = echteListe();
    assert.equal(eintraege.length, SCAN_DATEIEN.length * Object.keys(REGELN).length);
    assert.deepEqual(verbleibBefunde({ eintraege, lies: echtLesen }), []);
  });

  test("Negativfall am echten Stand: der Pre-Flight-Satz fehlt in der Umsetzer-Datei, ohne dass der Verbleib benannt ist, ist rot", () => {
    const eintraege = echteListe();
    const eintrag = eintraege.find((e) => e.datei === SCAN_DATEIEN[0] && e.regel === "pre-flight");
    assert.ok(eintrag);
    const lies = (pfad: string): string | null => {
      const t = echtLesen(pfad);
      return t !== null && pfad === eintrag.ort ? t.replace(eintrag.text, "") : t;
    };
    assert.match(verbleibBefunde({ eintraege, lies }).join("\n"), /factory-umsetzer\.md × pre-flight: der gespeicherte Text steht in .* nicht/);
  });

  describe("Mechanik (Befund je Klasse)", () => {
    const satz = "Der Stopp gilt nur bei Irreversiblem oder Außenwirkung und nie bei einer bloßen Ermessensfrage, die der Agent selbst entscheidet.";
    const fremd = "Fremdtext-Kommentare liest du nur über `node scripts/fremdtext.mjs`, mit Plan `<praefixe.commitZeile>Plan:` und Review `<praefixe.commitZeile>Review:` hat das nichts zu tun.";
    const koerper = `Kopf\n${satz}\n${fremd}`;
    const dateien: Record<string, string> = {
      [SCAN_DATEIEN[0]]: koerper,
      [SCAN_DATEIEN[1]]: koerper,
      "AGENTS.md": "Regel \n`<praefixe.commitZeile>Abnahme:`",
      ".claude/agents/bedingt.md": `Nur wenn X: ${satz}`,
    };
    const lies = (p: string): string | null => dateien[p] ?? null;
    const e = (datei: string, regel: string, ort: string, text: string, bedingung = ""): Eintrag => ({ datei, regel, ort, bedingung, text });
    const alle = (): Eintrag[] =>
      SCAN_DATEIEN.flatMap((d) => [
        e(d, "commit-plan", d, "`<praefixe.commitZeile>Plan:`"),
        e(d, "commit-review", d, "`<praefixe.commitZeile>Review:`"),
        e(d, "commit-abnahme", "AGENTS.md", "`<praefixe.commitZeile>Abnahme:`"),
        e(d, "pre-flight", d, satz),
        e(d, "fremdtext", d, fremd),
      ]);
    const befunde = (aend: (l: Eintrag[]) => Eintrag[], lesen = lies): string => verbleibBefunde({ eintraege: aend(alle()), lies: lesen }).join("\n");
    const preFlight = (l: Eintrag[], i = 0): Eintrag => l.filter((x) => x.regel === "pre-flight")[i];

    test("die Grundlage der Fixture ist grün (sonst wären die Negativfälle vakuös)", () => {
      assert.equal(befunde((l) => l), "");
    });

    test("fehlendes und überzähliges Paar Datei × Regel", () => {
      assert.match(befunde((l) => l.filter((x) => !(x.datei === SCAN_DATEIEN[1] && x.regel === "fremdtext"))), /review-lenses\/SKILL\.md × fremdtext: 0 Einträge/);
      assert.match(befunde((l) => [...l, l[0]]), /factory-umsetzer\.md × commit-plan: 2 Einträge/);
    });

    test("Eintrag außerhalb des Scan-Umfangs (unbekannte Datei oder Regel)", () => {
      assert.match(befunde((l) => [...l, e("docs/x.md", "pre-flight", "AGENTS.md", satz)]), /docs\/x\.md × pre-flight: Eintrag außerhalb des Scan-Umfangs/);
      assert.match(befunde((l) => [...l, e(SCAN_DATEIEN[0], "neu", "AGENTS.md", satz)]), /× neu: Eintrag außerhalb des Scan-Umfangs/);
    });

    test("unzulässiger Ort: docs/, Archiv, Pfad ohne .md", () => {
      for (const ort of ["docs/archiv/regeln.md", "scripts/x.mjs", ".claude/agents/a.md.txt", ".agents/skills/s/z.md.txt", "vorn/.claude/agents/a.md", ".claude/agents/ordner/tief.md", "vorn/.agents/skills/s/z.md", "docs/AGENTS.md"]) {
        assert.match(befunde((l) => l.map((x) => (x === preFlight(l) ? { ...x, ort } : x))), /pre-flight: unzulässiger Ort/);
      }
    });

    test("bedingter Ort: ohne Bedingung rot, ohne Verweis der Datei rot, mit beidem grün", () => {
      const bedingt = (bedingung: string) => (l: Eintrag[]) => l.map((x) => (x === preFlight(l) ? { ...x, ort: ".claude/agents/bedingt.md", bedingung } : x));
      assert.match(befunde(bedingt("  ")), /nennt keine Bedingung/);
      assert.match(befunde(bedingt("wenn X")), /verweist nicht per Pfad/);
      const mitVerweis = (p: string): string | null => (p === SCAN_DATEIEN[0] ? `${dateien[p]}\nSiehe .claude/agents/bedingt.md` : lies(p));
      assert.equal(befunde(bedingt("wenn X"), mitVerweis), "");
      const skillOrt = ".agents/skills/s/tief/zusatz.md";
      const imSkill = (l: Eintrag[]) => l.map((x) => (x === preFlight(l) ? { ...x, ort: skillOrt, bedingung: "wenn X" } : x));
      const lesenSkill = (p: string): string | null => (p === skillOrt ? `Nur wenn X: ${satz}` : p === SCAN_DATEIEN[0] ? `${dateien[p]}\nSiehe ${skillOrt}` : lies(p));
      assert.equal(befunde(imSkill, lesenSkill), "", "auch eine bedingte Skill-Zusatzdatei ist ein zulässiger Ort");
    });

    test("Text steht am Ort nicht: Satz entfernt, Ort fehlt, Leerraum ist egal", () => {
      assert.match(befunde((l) => l, (p) => (p === SCAN_DATEIEN[0] ? "Kopf ohne den Satz" : lies(p))), /× pre-flight: der gespeicherte Text steht in .* nicht/);
      assert.match(befunde((l) => l, (p) => (p === SCAN_DATEIEN[0] ? null : lies(p))), /der Ort .* fehlt/);
      assert.equal(befunde((l) => l, (p) => (p === SCAN_DATEIEN[0] ? dateien[p].replace(satz, satz.replace(/ /g, "\n  ")) : lies(p))), "");
    });

    test("wortgleiche Regel: zu kurz, ohne Kern-Token, ohne Satzgrenze am Ende; Token-Regel ohne Kern-Token", () => {
      const ersetze = (regel: string, text: string) => (l: Eintrag[]) => l.map((x) => (x.regel === regel && x.datei === SCAN_DATEIEN[0] ? { ...x, text } : x));
      const mitText = (text: string) => (p: string): string | null => (p === SCAN_DATEIEN[0] ? `${dateien[p]}\n${text}` : lies(p));
      const kurz = "Außenwirkung zählt.";
      assert.match(befunde(ersetze("pre-flight", kurz), mitText(kurz)), /kürzer als 80 Zeichen/);
      const ohneKern = "x".repeat(90) + ".";
      assert.match(befunde(ersetze("pre-flight", ohneKern), mitText(ohneKern)), /Kern-Token „Außenwirkung“ nicht/);
      const ohneSatzgrenze = satz.slice(0, -1);
      assert.match(befunde(ersetze("pre-flight", ohneSatzgrenze), mitText(ohneSatzgrenze)), /endet nicht an einer Satzgrenze/);
      for (const ende of [".", ",", ";", ":"]) {
        const satzAnfang = satz.slice(0, -1) + ende;
        const dateienAnfang: Record<string, string> = { ...dateien, [SCAN_DATEIEN[0]]: `Kopf\n${satzAnfang}` };
        const lesenAnfang = (q: string): string | null => dateienAnfang[q] ?? lies(q);
        assert.doesNotMatch(befunde(ersetze("pre-flight", satzAnfang), lesenAnfang), /Satzgrenze/, `Ende ${ende}`);
      }
      assert.match(befunde(ersetze("commit-plan", "`Plan:`"), mitText("`Plan:`")), /commit-plan: der gespeicherte Text enthält das Kern-Token/);
      assert.equal(befunde((l) => l), "", "ein Token-Eintrag braucht weder 80 Zeichen noch ein Satzzeichen am Ende");
    });
  });
});
