/* Statusline-Weiche (#1358): Snapshot ablegen, persönliche Statusline unverändert durchreichen, nie werfen. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, test } from "vitest";

// Alle direkten Aufrufe unten erben diesen Verlaufspfad: kein Test schreibt ins echte Home.
const VERLAUF_DIR = mkdtempSync(join(tmpdir(), "statusline-verlauf-"));
process.env.FACTORY_ABO_KONTINGENT_VERLAUF = join(VERLAUF_DIR, "verlauf.jsonl");
afterAll(() => rmSync(VERLAUF_DIR, { recursive: true, force: true }));
const KOPIE = 'node -e "process.stdin.pipe(process.stdout)"';
const PAYLOAD = JSON.stringify({
  model: { display_name: "Ä-Modell" },
  rate_limits: { five_hour: { used_percentage: 12, resets_at: 1792098000 }, seven_day: { used_percentage: 34, resets_at: 1792184400 } },
});

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

function lauf(stdin: string, kommando: string | null, env: Record<string, string> = {}) {
  dir = mkdtempSync(join(tmpdir(), "statusline-"));
  const settings = join(dir, "settings.json");
  writeFileSync(settings, JSON.stringify(kommando === null ? {} : { statusLine: { type: "command", command: kommando } }));
  const snapshot = join(dir, "snap.json");
  const verlauf = join(dir, "verlauf.jsonl");
  const r = spawnSync(process.execPath, ["scripts/statusline.mjs"], {
    input: stdin,
    env: { ...process.env, FACTORY_USER_SETTINGS: settings, FACTORY_RATE_LIMITS_SNAPSHOT: snapshot, FACTORY_ABO_KONTINGENT_VERLAUF: verlauf, FACTORY_STATUSLINE_DURCHREICHEN: "", ...env },
  });
  return { code: r.status, out: r.stdout.toString("utf8"), snapshot, verlauf };
}

describe("scripts/statusline.mjs", () => {
  test("reicht die persönliche Statusline byte-gleich durch und legt den Snapshot ab", () => {
    const r = lauf(PAYLOAD, KOPIE);
    expect(r.code).toBe(0);
    expect(r.out).toBe(PAYLOAD);
    const s: unknown = JSON.parse(readFileSync(r.snapshot, "utf8"));
    expect(s).toMatchObject({ quelle: "statusline", sevenDay: { pct: 34, resetsAt: 1792184400 }, fiveHour: { pct: 12 } });
  });

  test("ohne rate_limits bleibt ein vorhandener Snapshot unberührt", () => {
    dir = mkdtempSync(join(tmpdir(), "statusline-"));
    const snapshot = join(dir, "snap.json");
    writeFileSync(snapshot, '{"alt":true}');
    const settings = join(dir, "s.json");
    writeFileSync(settings, "{}");
    const r = spawnSync(process.execPath, ["scripts/statusline.mjs"], {
      input: '{"model":"x"}',
      env: { ...process.env, FACTORY_USER_SETTINGS: settings, FACTORY_RATE_LIMITS_SNAPSHOT: snapshot },
    });
    expect(r.status).toBe(0);
    expect(readFileSync(snapshot, "utf8")).toBe('{"alt":true}');
  });

  test("Teil-Snapshot ohne 7-Tage-Fenster ersetzt keinen vorhandenen Wochenstand, mit Wochenstand schon", () => {
    dir = mkdtempSync(join(tmpdir(), "statusline-"));
    const snapshot = join(dir, "snap.json");
    const settings = join(dir, "s.json");
    writeFileSync(settings, "{}");
    const alt = '{"stand":1,"quelle":"probe","sevenDay":{"pct":5,"resetsAt":1792184400}}';
    writeFileSync(snapshot, alt);
    const env = { ...process.env, FACTORY_USER_SETTINGS: settings, FACTORY_RATE_LIMITS_SNAPSHOT: snapshot };
    spawnSync(process.execPath, ["scripts/statusline.mjs"], { input: '{"rate_limits":{"five_hour":{"used_percentage":9,"resets_at":1792098000}}}', env });
    expect(readFileSync(snapshot, "utf8")).toBe(alt);
    spawnSync(process.execPath, ["scripts/statusline.mjs"], { input: PAYLOAD, env });
    expect(JSON.parse(readFileSync(snapshot, "utf8"))).toMatchObject({ quelle: "statusline", sevenDay: { pct: 34 } });
  });

  test("Teil-Snapshot wird geschrieben, wenn noch kein Wochenstand da ist (fehlt oder ohne sevenDay)", () => {
    const teil = '{"rate_limits":{"five_hour":{"used_percentage":9,"resets_at":1792098000}}}';
    const r = lauf(teil, null);
    expect(JSON.parse(readFileSync(r.snapshot, "utf8"))).toMatchObject({ fiveHour: { pct: 9 } });
    writeFileSync(r.snapshot, '{"stand":1,"quelle":"probe","fiveHour":{"pct":1,"resetsAt":1}}');
    spawnSync(process.execPath, ["scripts/statusline.mjs"], {
      input: teil,
      env: { ...process.env, FACTORY_USER_SETTINGS: join(dir, "settings.json"), FACTORY_RATE_LIMITS_SNAPSHOT: r.snapshot },
    });
    expect(JSON.parse(readFileSync(r.snapshot, "utf8"))).toMatchObject({ quelle: "statusline", fiveHour: { pct: 9 } });
  });

  test("ohne persönliche Statusline: leere Ausgabe, Exit 0, Snapshot trotzdem da", () => {
    const r = lauf(PAYLOAD, null);
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
    expect(existsSync(r.snapshot)).toBe(true);
  });

  test("kaputtes stdin: Exit 0, Durchreichung läuft, kein Snapshot", () => {
    const r = lauf("{kein json", KOPIE);
    expect(r.code).toBe(0);
    expect(r.out).toBe("{kein json");
    expect(existsSync(r.snapshot)).toBe(false);
  });

  test("Kontingent-Verlauf: gleicher Stand erzeugt keine neue Zeile, geänderter eine, beide Fenster samt Reset stehen drin", () => {
    const r = lauf(PAYLOAD, null);
    const zeilen = () => readFileSync(r.verlauf, "utf8").split("\n").filter(Boolean);
    expect(JSON.parse(zeilen()[0] ?? "")).toMatchObject({ sevenDay: { pct: 34, resetsAt: 1792184400 }, fiveHour: { pct: 12, resetsAt: 1792098000 } });
    const env = { ...process.env, FACTORY_USER_SETTINGS: join(dir, "settings.json"), FACTORY_RATE_LIMITS_SNAPSHOT: r.snapshot, FACTORY_ABO_KONTINGENT_VERLAUF: r.verlauf };
    spawnSync(process.execPath, ["scripts/statusline.mjs"], { input: PAYLOAD, env });
    expect(zeilen()).toHaveLength(1);
    spawnSync(process.execPath, ["scripts/statusline.mjs"], { input: PAYLOAD.replace('"used_percentage":34', '"used_percentage":35'), env });
    expect(zeilen()).toHaveLength(2);
  });

  test("Kontingent-Verlauf: ohne rate_limits entsteht keine Zeile", () => {
    const r = lauf('{"model":"x"}', null);
    expect(existsSync(r.verlauf)).toBe(false);
  });

  test("Kontingent-Verlauf nicht schreibbar: Exit 0, Ausgabe byte-gleich, Snapshot trotzdem da", () => {
    const r = lauf(PAYLOAD, KOPIE, { FACTORY_ABO_KONTINGENT_VERLAUF: VERLAUF_DIR }); // ein Verzeichnis ist nicht beschreibbar
    expect(r.code).toBe(0);
    expect(r.out).toBe(PAYLOAD);
    expect(existsSync(r.snapshot)).toBe(true);
  });

  test("Schleifenschutz: im Kind (FACTORY_STATUSLINE_DURCHREICHEN=1) wird nichts durchgereicht", () => {
    const r = lauf(PAYLOAD, KOPIE, { FACTORY_STATUSLINE_DURCHREICHEN: "1" });
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
  });

  test("persönliches Kommando mit Exit 1: dessen Ausgabe erscheint, Exit 0", () => {
    const r = lauf(PAYLOAD, 'node -e "process.stdout.write(\'zeile\'); process.exit(1)"');
    expect(r.code).toBe(0);
    expect(r.out).toBe("zeile");
  });
});
