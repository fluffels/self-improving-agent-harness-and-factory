/* Selbstbeschreibungs-Wächter der Fabrik (factory#490, ADR 0022 Fortschreibung quellprojekt#1714).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Der Harness ist „source-available“ (alle Rechte vorbehalten), nicht Open Source. Dieser Test
 * macht jede UNVERNEINTE Selbstbezeichnung als offene Quelle in den Selbstbeschreibungs-Flächen
 * rot. Der Test bleibt fabrik-eigen: er steht nicht im Besitz-Manifest, Bezieher bekommen ihn nicht.
 *
 * Grenzen (bewusst): ADRs, Tests und Historie liegen außerhalb der Flächenliste; Kürzel und
 * Umschreibungen (OSS, FOSS, freie Software) werden nicht erkannt; eine Verneinung weiter als
 * drei Wörter davor oder in einem früheren Satz zählt nicht; „offene Quelle“ ist keine
 * Behauptung im Sinn des Tests (die Doku benutzt sie beschreibend); ein Fragesatz mit der
 * Wendung zählt als Treffer; Flächen sind eine feste Liste, kein Scan des ganzen Repos.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WURZEL = resolve(__dirname, '..', '..');

/** Die Behauptung: englische Wendung (getrennt, mit Bindestrich oder zusammen) und das deutsche Wort dafür. */
const BEHAUPTUNG = /\bopen[\s-]?source\b|\bquelloffen\w*/gi;
const VERNEINUNG = /^(nicht|kein\w*|not|no|non)$/i;

/** Treffer der Behauptung ohne Verneinung in den drei Wörtern davor (gleicher Satz). */
function offeneQuelleBehauptungen(roh: string): string[] {
  const text = roh.replace(/[*_`]/g, '').replace(/\s+/g, ' ');
  const treffer: string[] = [];
  for (const m of text.matchAll(BEHAUPTUNG)) {
    const davor = text.slice(0, m.index);
    const satz = davor.slice(Math.max(davor.lastIndexOf('. '), davor.lastIndexOf('! '), davor.lastIndexOf('? ')) + 1);
    const woerter = satz
      .split(' ')
      .map((w) => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))
      .filter(Boolean)
      .slice(-3);
    if (!woerter.some((w) => VERNEINUNG.test(w))) treffer.push(m[0]);
  }
  return treffer;
}

const FLAECHEN = [
  /^README\.md$/,
  /^LICENSE$/,
  /^package\.json$/,
  /^docs\/agent-harness[^/]*\.md$/,
  /^docs\/harness-[^/]*\.md$/,
  /^\.claude\/agents\/[^/]+\.md$/,
  /^\.agents\/skills\/.+\.md$/,
];

function flaechen(): string[] {
  const alle = execFileSync('git', ['ls-files', '-z'], { cwd: WURZEL, encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\0')
    .filter(Boolean);
  return alle.filter((p) => FLAECHEN.some((re) => re.test(p)));
}

describe('offeneQuelleBehauptungen', () => {
  it('findet eine unverneinte Behauptung', () => {
    expect(offeneQuelleBehauptungen('Der Harness ist Open Source.')).toHaveLength(1);
    expect(offeneQuelleBehauptungen('Das Projekt ist quelloffen.')).toHaveLength(1);
    expect(offeneQuelleBehauptungen('Ein open-source Werkzeug und ein opensource Werkzeug.')).toHaveLength(2);
  });
  it('lässt verneinte Treffer zu', () => {
    expect(offeneQuelleBehauptungen('Er ist nicht Open Source.')).toEqual([]);
    expect(offeneQuelleBehauptungen('Es wird KEINE\nOpen-Source-Lizenz gewährt.')).toEqual([]);
    expect(offeneQuelleBehauptungen('It is not open-source.')).toEqual([]);
    expect(offeneQuelleBehauptungen('Markdown **nicht** _Open_ Source.')).toEqual([]);
  });
  it('zählt eine Verneinung im vorigen Satz oder weiter als drei Wörter davor nicht', () => {
    expect(offeneQuelleBehauptungen('Das ist nicht gemeint. Der Harness ist Open Source.')).toHaveLength(1);
    expect(offeneQuelleBehauptungen('Nicht dass jemand glaubt: a b c d Open Source.')).toHaveLength(1);
  });
  it('hält Wörter, die nur wie eine Verneinung beginnen, für keine Verneinung', () => {
    expect(offeneQuelleBehauptungen('Er ist noch Open Source.')).toHaveLength(1);
    expect(offeneQuelleBehauptungen('Die Note: Open Source.')).toHaveLength(1);
    expect(offeneQuelleBehauptungen('Er ist keinesfalls Open Source.')).toEqual([]);
  });
  it('wertet nur ein ganzes Wort als Verneinung, kein Wort mit Verneinung am Ende', () => {
    expect(offeneQuelleBehauptungen('Das Kasino ist Open Source.')).toHaveLength(1);
    expect(offeneQuelleBehauptungen('Ein Piano ist Open Source.')).toHaveLength(1);
  });
  it('erkennt die Satzgrenzen „! “ und „? “', () => {
    expect(offeneQuelleBehauptungen('Kein Wort! Open Source.')).toHaveLength(1);
    expect(offeneQuelleBehauptungen('Kein Wort? Open Source.')).toHaveLength(1);
  });
  it('ignoriert die beschreibende „offene Quelle“', () => {
    expect(offeneQuelleBehauptungen('Die offene Quelle wird beschrieben.')).toEqual([]);
  });
});

describe('Selbstbeschreibung der Fabrik', () => {
  const dateien = flaechen();

  it('die Flächenliste ist nicht leer und enthält README und LICENSE', () => {
    expect(dateien).toEqual(expect.arrayContaining(['README.md', 'LICENSE']));
    expect(dateien.length).toBeGreaterThan(10);
  });

  it('keine Fläche behauptet unverneint, offene Quelle zu sein', () => {
    const funde = dateien.flatMap((p) =>
      offeneQuelleBehauptungen(readFileSync(resolve(WURZEL, p), 'utf8')).map((t) => `${p}: ${t}`),
    );
    expect(funde).toEqual([]);
  });

  it.each(FLAECHEN.map((re) => [String(re), re] as const))('Flächenmuster %s trifft mindestens eine Datei', (_name, re) => {
    expect(dateien.some((p) => re.test(p))).toBe(true);
  });

  it.each(['README.md', 'LICENSE'])('%s nennt „source-available“', (datei) => {
    expect(readFileSync(resolve(WURZEL, datei), 'utf8')).toMatch(/source-available/i);
  });
});
