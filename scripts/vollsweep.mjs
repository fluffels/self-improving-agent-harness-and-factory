// Kein Shebang (Konvention der Skripte, die ein Test importiert).
/**
 * Vollsweep (factory#280 L5/L7): je Regex-Literal und Bedingung einer Datei eine Mutation, den Test dazu fahren, `rot | grün | ungültig` ausgeben.
 * Ein `grün` ist eine Lücke des Tests; `ungültig` (die Mutation ist syntaktisch kaputt) zählt nicht als Beleg, weil sie nur wegen des Syntaxfehlers rot würde.
 * Der Umsetzer protokolliert die Zeilen als `<datei> | <Suchstring> → <Ersatz> | <Test> | Ergebnis` im Commit-Body (Skill `review-lenses`, Lens 3).
 *
 * Aufruf: `node scripts/vollsweep.mjs --wurzel <absoluter Worktree> --datei <pfad> --test <testdatei> [--zeilen a-b]`. Pfade lösen sich gegen die Wurzel auf.
 * Die Wurzel muss ein Worktree unter `.claude/worktrees/` sein (nie der Hauptcheckout), die Datei ohne ungesicherte Änderung (vorher committen):
 * der Sweep sichert sie im Speicher, schreibt sie in `finally` zurück und prüft am Ende `git diff --stat` der Datei (leer, sonst Exit 1). Kein Gate.
 *
 * Geschlossene Mutationsliste, Regex-Literale (beide Richtungen, jede Komponente einzeln):
 *  Anker      `^`, `$`, `\b` entfernen;
 *  Klasse     je Element entfernen (Bereich `a-z` und Escape `\d` sind je eines), Negation `[…]` ↔ `[^…]`;
 *  Quantor    `{n,m}`/`{n}`/`{n,}` je Grenze ±1, `+` ↔ `*`, `?` entfernen (auch das Lazy-Zeichen);
 *  Alternative je Zweig einer `|`-Kette streichen (Top-Level und je Gruppe);
 *  Gruppe     `(…)?` → `(…)`;
 *  Flags      jedes Flag einmal entfernen.
 * Bedingungen (nur in `--zeilen`): `if (<b>)` → `if (true)` und `if (false)` (die schon stehende Richtung entfällt).
 *
 * Ungültig: ein Regex, den `new RegExp` ablehnt (ohne Testlauf); in `.mjs`/`.js`/`.cjs` ein Fehlschlag von `node --check`; in jeder anderen Datei (`.ts`) ein
 * rot mit `SyntaxError`, `Transform failed` oder `Unexpected token` in der Testausgabe.
 *
 * Bewusste Grenzen (Regex-Heuristik, kein AST): Literale per `REGEX_LITERAL` (regex-lib.mjs) je Zeile, Kommentarzeilen ausgenommen, ein Literal in einem String
 * oder nach `=>` fehlt oder erzeugt Rauschen; `new RegExp("…")`, mehrzeilige Bedingungen und Bedingungen mit Klammern in Regex-Literalen fehlen; es gibt
 * keine Mutation `&&` ↔ `||`, Schwellen oder Rückgabewerte (die Lens prüft sie weiter von Hand). Mutationen werden nacheinander gefahren, ein Test mit
 * Seiteneffekten im Repo ist nicht isoliert.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, posix, relative, resolve } from "node:path";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { direktaufruf, flagsLesen } from "./flag-lib.mjs";
import { REGEX_LITERAL } from "./regex-lib.mjs";

const AUFRUF = "Aufruf: node scripts/vollsweep.mjs --wurzel <absoluter Worktree> --datei <pfad> --test <testdatei> [--zeilen a-b]";
const FLAGS = { wurzel: { type: "string" }, datei: { type: "string" }, test: { type: "string" }, zeilen: { type: "string" } };
const SYNTAX_MUSTER = [/SyntaxError/, /Transform failed/, /Unexpected token/];
const NODE_DATEI = /\.(?:mjs|cjs|js)$/;
const GRUPPEN_PRAEFIX = /\((?:\?(?:<[=!]|[:=!]|<[^>]*>))?/;
const KLASSEN_ELEMENT = /\\(?:x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)|[^\\]/gs;
const GRENZEN = /^\{(\d+)(?:(,)(\d*))?\}/;
const KOMMENTARZEILE = /^\s*(?:\/\/|\/\*|\*)/;
const WORKTREE_SEGMENT = /\/\.claude\/worktrees\/[^/]+/;

// ───────────────────────── Regex-Literale ─────────────────────────

/** Zerlegt Regex-Quelltext in Token `{ typ, von, bis, text }` (esc, klasse, gruppeAuf, gruppeZu, alt, anker, quant, zeichen). Pur. */
function naechstesToken(q, i) {
  const c = q[i];
  const roh = (typ, bis) => ({ typ, von: i, bis, text: q.slice(i, bis) });
  if (c === "\\") return roh("esc", Math.min(i + 2, q.length));
  if (c === "[") {
    let j = i + 1;
    while (j < q.length && q[j] !== "]") j += q[j] === "\\" ? 2 : 1;
    return roh("klasse", Math.min(j + 1, q.length));
  }
  if (c === "(") return roh("gruppeAuf", i + GRUPPEN_PRAEFIX.exec(q.slice(i))[0].length);
  if (c === ")") return roh("gruppeZu", i + 1);
  if (c === "|") return roh("alt", i + 1);
  if (c === "^" || c === "$") return roh("anker", i + 1);
  if ("*+?".includes(c)) return roh("quant", i + 1);
  const grenzen = c === "{" ? GRENZEN.exec(q.slice(i)) : null;
  return grenzen ? roh("quant", i + grenzen[0].length) : roh("zeichen", i + 1);
}

function scanne(q) {
  const tokens = [];
  for (let i = 0; i < q.length; ) {
    const t = naechstesToken(q, i);
    tokens.push(t);
    i = t.bis;
  }
  return tokens;
}

const edit = (von, bis, text, art) => ({ von, bis, text, art });

function ankerEdits(tok) {
  return tok.typ === "anker" || (tok.typ === "esc" && tok.text === "\\b") ? [edit(tok.von, tok.bis, "", "Anker entfernen")] : [];
}

/** Elemente einer Klasse ohne Klammern und `^`: Escape, Zeichen oder Bereich `a-z` je ein Element. */
function klassenElemente(body) {
  const einzeln = [...body.matchAll(KLASSEN_ELEMENT)].map((m) => m[0]);
  const elemente = [];
  for (let k = 0; k < einzeln.length; k++) {
    if (einzeln[k + 1] === "-" && k + 2 < einzeln.length) {
      elemente.push(einzeln.slice(k, k + 3).join(""));
      k += 2;
    } else {
      elemente.push(einzeln[k]);
    }
  }
  return elemente;
}

function klassenEdits(tok) {
  if (tok.typ !== "klasse" || !tok.text.endsWith("]") || tok.text.length < 2) return [];
  const inner = tok.text.slice(1, -1);
  const negiert = inner.startsWith("^");
  const body = negiert ? inner.slice(1) : inner;
  const elemente = klassenElemente(body);
  const neu = (text, art) => edit(tok.von, tok.bis, text, art);
  const edits = [neu(`[${negiert ? "" : "^"}${body}]`, "Klasse negieren")];
  if (elemente.length > 1) {
    elemente.forEach((_, k) => edits.push(neu(`[${negiert ? "^" : ""}${elemente.filter((__, j) => j !== k).join("")}]`, "Klasse Element entfernen")));
  }
  return edits;
}

function grenzenEdits(tok) {
  const m = GRENZEN.exec(tok.text);
  const n = Number(m[1]);
  const hatKomma = m[2] !== undefined;
  const mm = m[3] === "" || m[3] === undefined ? null : Number(m[3]);
  const form = (a, b) => `{${a}${hatKomma ? "," : ""}${b ?? ""}}`;
  const edits = [];
  if (n > 0) edits.push(form(n - 1, mm));
  edits.push(form(n + 1, mm));
  if (hatKomma && mm !== null) {
    if (mm > 0) edits.push(form(n, mm - 1));
    edits.push(form(n, mm + 1));
  }
  return edits.map((text) => edit(tok.von, tok.bis, text, "Quantor Grenze"));
}

function quantEdits(tokens, k) {
  const tok = tokens[k];
  if (tok.typ !== "quant") return [];
  if (tok.text.startsWith("{")) return grenzenEdits(tok);
  const tausch = { "+": "*", "*": "+" }[tok.text];
  if (tausch) return [edit(tok.von, tok.bis, tausch, `Quantor ${tok.text}↔${tausch}`)];
  return [edit(tok.von, tok.bis, "", tokens[k - 1]?.typ === "gruppeZu" ? "optionale Gruppe" : "Quantor ? entfernen")];
}

/** Zweige einer `|`-Kette je Ebene (Top-Level und jede Gruppe): jeder Zweig samt einem angrenzenden `|` wird gestrichen. */
function alternativenEdits(tokens, laenge) {
  const ebenen = [{ start: 0, bars: [] }];
  const edits = [];
  const abschliessen = (ebene, ende) => {
    const { start, bars } = ebene;
    const grenzen = [start, ...bars.flatMap((b) => [b.von, b.bis]), ende];
    for (let b = 0; b <= bars.length && bars.length > 0; b++) {
      const von = grenzen[2 * b];
      const bis = grenzen[2 * b + 1];
      const weg = b < bars.length ? [von, bars[b].bis] : [bars[b - 1].von, bis];
      edits.push(edit(weg[0], weg[1], "", "Alternative streichen"));
    }
  };
  for (const tok of tokens) {
    if (tok.typ === "gruppeAuf") ebenen.push({ start: tok.bis, bars: [] });
    else if (tok.typ === "alt") ebenen.at(-1).bars.push(tok);
    else if (tok.typ === "gruppeZu" && ebenen.length > 1) abschliessen(ebenen.pop(), tok.von);
  }
  while (ebenen.length > 0) abschliessen(ebenen.pop(), laenge);
  return edits;
}

/**
 * Pur: Mutationen eines Regex-Literals aus der geschlossenen Liste (Kopfkommentar) als `[{ quelle, flags, art }]`; keine gleicht dem Original, keine doppelt.
 */
export function mutationenRegex(quelle, flags) {
  const tokens = scanne(quelle);
  const edits = [...tokens.flatMap((t, k) => [...ankerEdits(t), ...klassenEdits(t), ...quantEdits(tokens, k)]), ...alternativenEdits(tokens, quelle.length)];
  const alle = edits.map((e) => ({ quelle: quelle.slice(0, e.von) + e.text + quelle.slice(e.bis), flags, art: e.art }));
  for (let i = 0; i < flags.length; i++) alle.push({ quelle, flags: flags.slice(0, i) + flags.slice(i + 1), art: `Flag ${flags[i]} entfernen` });
  const gesehen = new Set([`${quelle}/${flags}`]);
  return alle.filter((m) => !gesehen.has(`${m.quelle}/${m.flags}`) && gesehen.add(`${m.quelle}/${m.flags}`));
}

/** Pur: Regex-Literale je Zeile (Kommentarzeilen nicht) als `{ von, bis, zeile, quelle, flags }` mit Offsets im ganzen Text. */
export function regexLiterale(text) {
  const funde = [];
  let offset = 0;
  text.split("\n").forEach((zeile, k) => {
    if (!KOMMENTARZEILE.test(zeile)) {
      for (const m of zeile.matchAll(REGEX_LITERAL)) {
        const literal = m[0].slice(m[1].length);
        const ende = literal.lastIndexOf("/");
        const von = offset + m.index + m[1].length;
        funde.push({ von, bis: von + literal.length, zeile: k + 1, quelle: literal.slice(1, ende), flags: literal.slice(ende + 1) });
      }
    }
    offset += zeile.length + 1;
  });
  return funde;
}

/** Pur: lehnt `new RegExp` die Mutation ab, ist sie ungültig (zählt nicht als Beleg). */
export function regexUngueltig(quelle, flags) {
  try {
    new RegExp(quelle, flags);
    return false;
  } catch {
    return true;
  }
}

/** Pur: nennt die Testausgabe einen Syntaxfehler (geschlossene Musterliste)? */
export const ausgabeSyntaxfehler = (text) => SYNTAX_MUSTER.some((m) => m.test(String(text ?? "")));

// ───────────────────────── Bedingungen ─────────────────────────

/** Index der schließenden Klammer zur `(` an `auf` (Strings werden übersprungen), sonst -1. */
function klammerEnde(zeile, auf) {
  let tiefe = 0;
  let quote = null;
  for (let i = auf; i < zeile.length; i++) {
    const c = zeile[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
    } else if (c === "(") {
      tiefe++;
    } else if (c === ")" && --tiefe === 0) {
      return i;
    }
  }
  return -1;
}

/** Pur: `if (<b>)` einer Zeile als `[{ von, bis, such, ersatz }]` (Offsets in der Zeile): `if (true)` und `if (false)`, die schon stehende Richtung entfällt. */
export function mutationenBedingung(zeile) {
  const muss = [];
  for (const m of zeile.matchAll(/(?<![\w$])if\s*\(/g)) {
    const ende = klammerEnde(zeile, m.index + m[0].length - 1);
    if (ende === -1) continue;
    const such = zeile.slice(m.index, ende + 1);
    const bedingung = zeile.slice(m.index + m[0].length, ende).trim();
    for (const wert of ["true", "false"]) {
      if (bedingung !== wert) muss.push({ von: m.index, bis: ende + 1, such, ersatz: `if (${wert})` });
    }
  }
  return muss;
}

// ───────────────────────── Plan und Lauf ─────────────────────────

/** Pur: alle Mutationen einer Datei als `{ von, bis, such, ersatz, ungueltig }` (Offsets im Text); Bedingungen nur in `zeilen` (`{ a, b }`), Regexe in `zeilen` oder überall. */
export function planeMutationen(text, zeilen) {
  const innen = (z) => !zeilen || (z >= zeilen.a && z <= zeilen.b);
  const plan = [];
  for (const l of regexLiterale(text).filter((x) => innen(x.zeile))) {
    for (const m of mutationenRegex(l.quelle, l.flags)) {
      plan.push({ von: l.von, bis: l.bis, such: text.slice(l.von, l.bis), ersatz: `/${m.quelle}/${m.flags}`, ungueltig: regexUngueltig(m.quelle, m.flags) });
    }
  }
  if (zeilen) {
    let offset = 0;
    text.split("\n").forEach((zeile, k) => {
      if (innen(k + 1) && !KOMMENTARZEILE.test(zeile)) for (const b of mutationenBedingung(zeile)) plan.push({ von: offset + b.von, bis: offset + b.bis, such: b.such, ersatz: b.ersatz, ungueltig: false });
      offset += zeile.length + 1;
    });
  }
  return plan.sort((x, y) => x.von - y.von);
}

const fehler = (code, text) => ({ code, out: "", err: `✖ vollsweep: ${text}\n${AUFRUF}\n` });

/** Pur: `--zeilen a-b` oder `a` als `{ a, b }`; sonst `null`. */
function zeilenLesen(text) {
  const m = /^(\d+)(?:-(\d+))?$/.exec(text);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  return a >= 1 && a <= b ? { a, b } : null;
}

/** Prüft Wurzel, Pfade und `--zeilen`; liefert `{ fehler }` oder `{ wurzel, datei, test, zeilen }` (absolute Pfade, Schrägstriche). */
function eingaben(werte) {
  if (!isAbsolute(werte.wurzel)) return { fehler: fehler(2, `--wurzel muss ein absoluter Pfad sein (${werte.wurzel})`) };
  const wurzel = posix.normalize(werte.wurzel.replace(/\\/g, "/")).replace(/\/$/, "");
  if (!WORKTREE_SEGMENT.test(wurzel)) return { fehler: fehler(2, `--wurzel ist kein Worktree unter .claude/worktrees/ (der Hauptcheckout ist tabu): ${wurzel}`) };
  const zeilen = werte.zeilen === undefined ? null : zeilenLesen(werte.zeilen);
  if (werte.zeilen !== undefined && !zeilen) return { fehler: fehler(2, `--zeilen erwartet a oder a-b (1 ≤ a ≤ b), nicht „${werte.zeilen}“`) };
  const aufloesen = (p) => resolve(wurzel, p).replace(/\\/g, "/");
  const [datei, test] = [aufloesen(werte.datei), aufloesen(werte.test)];
  for (const pfad of [datei, test]) {
    if (relative(wurzel, pfad).startsWith("..")) return { fehler: fehler(2, `Pfad liegt außerhalb der Wurzel: ${pfad}`) };
  }
  return { wurzel, datei, test, zeilen };
}

function bewerte({ spawn, wurzel, datei, test }, m) {
  if (m.ungueltig) return "ungültig";
  if (NODE_DATEI.test(datei) && spawn("node", ["--check", datei], { cwd: wurzel }).status !== 0) return "ungültig";
  const r = spawn("node", [`${wurzel}/scripts/gate-befehl.mjs`, "testGezielt", test], { cwd: wurzel });
  if (r.status === 0) return "grün";
  return !NODE_DATEI.test(datei) && ausgabeSyntaxfehler(`${r.stdout}\n${r.stderr}`) ? "ungültig" : "rot";
}

/** Die CLI mit injiziertem `lies(pfad)`, `schreibe(pfad, text)` und `spawn(cmd, args, { cwd })` (Form von `spawnSync`); Ergebnis `{ code, out, err }`. */
export function lauf(argv, { lies, schreibe, spawn }) {
  const r = flagsLesen(argv, FLAGS, { pflicht: ["wurzel", "datei", "test"] });
  if (r.fehler) return fehler(2, r.fehler.text);
  const e = eingaben(r.werte);
  if (e.fehler) return e.fehler;
  const { wurzel, datei, test, zeilen } = e;
  const diff = () => spawn("git", ["-C", wurzel, "diff", "--stat", "--", datei], { cwd: wurzel }).stdout.trim();
  if (diff() !== "") return fehler(2, `${r.werte.datei} hat ungesicherte Änderungen: erst per Zwischen-Commit sichern (kein git checkout als Rückweg)`);
  const ctx = { spawn, wurzel, datei, test };
  const original = lies(datei);
  if (bewerte(ctx, { ungueltig: false }) !== "grün") return fehler(1, `der Test ${r.werte.test} ist schon ohne Mutation rot: erst grün machen, sonst belegt kein rot etwas`);
  const plan = planeMutationen(original, zeilen);
  const zaehler = { rot: 0, grün: 0, ungültig: 0 };
  const zeilenAus = [`vollsweep: ${plan.length} Mutationen in ${r.werte.datei} gegen ${r.werte.test}`];
  for (const m of plan) {
    let ergebnis;
    try {
      if (!m.ungueltig) schreibe(datei, original.slice(0, m.von) + m.ersatz + original.slice(m.bis));
      ergebnis = bewerte(ctx, m);
    } finally {
      schreibe(datei, original);
    }
    zaehler[ergebnis]++;
    zeilenAus.push(`${r.werte.datei} | ${m.such} → ${m.ersatz} | ${r.werte.test} | ${ergebnis}`);
  }
  zeilenAus.push(`Summe: rot ${zaehler.rot} · grün ${zaehler.grün} · ungültig ${zaehler.ungültig}`);
  if (diff() !== "") return { code: 1, out: `${zeilenAus.join("\n")}\n`, err: `✖ vollsweep: ${r.werte.datei} weicht nach dem Sweep vom Stand ab (git diff --stat nicht leer): Datei prüfen und zurücksetzen, die Ergebnisse oben gelten nicht\n` };
  return { code: 0, out: `${zeilenAus.join("\n")}\n`, err: "" };
}

/** Die echte Umgebung: Dateizugriff und `spawnSync`. */
export function echteUmgebung() {
  return {
    lies: (pfad) => readFileSync(pfad, "utf8"),
    schreibe: (pfad, text) => writeFileSync(pfad, text),
    spawn: (cmd, args, opt) => spawnSync(cmd, args, { ...opt, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
  };
}

if (istDirektaufruf(import.meta.url)) {
  direktaufruf(process.argv.slice(2), {
    pruefe: (argv) => ({ fehler: flagsLesen(argv, FLAGS, { pflicht: ["wurzel", "datei", "test"] }).fehler?.text }),
    fehlerErgebnis: (argv) => lauf(argv, {}),
    io: echteUmgebung,
    fuehreAus: (argv, io) => lauf(argv, io),
  });
}
