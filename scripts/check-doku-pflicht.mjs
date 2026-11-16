// Kein Shebang: das Skript wird über `node scripts/check-doku-pflicht.mjs` (npm run check:dokupflicht) gestartet UND vom Test
// importiert; eine `#!`-Zeile bricht den Test-Import (wie bei check-lockfile.mjs).
/**
 * Doku-Pflicht-Wächter (factory#604 L3): ein Slice, der Verhalten ändert, ändert auch die Doku.
 *
 * Verhaltens-Pfade: `scripts/`, `.claude/agents/`, `.claude/skills/`, `.agents/skills/` und der Kern-Block der AGENTS.md (zwischen den
 * Besitz-Markern `kern`). Doku-Pfade: alles unter `docs/` und die README.md. Ein Diff gegen die Merge-Basis mit einem Verhaltens-Pfad
 * und ohne Doku-Pfad ist rot. Ausnahme: die Commit-Zeile `<praefixe.commitZeile>Doku-Override: #<nr> warum` im Slice (Pflicht-Begründung,
 * Mechanik und Stale-Meldung wie bei den anderen Slice-Gates, `scripts/slice-override.mjs`); die Präfix-Zeile kommt aus der Projekt-Config.
 *
 * Kern-Block: erkannt wird eine Änderung durch Vergleich des Blocks zwischen Basis und HEAD; fehlen die Marker oder ist die Basis-Fassung
 * nicht lesbar, zählt jede Änderung an der AGENTS.md als Verhaltens-Änderung (fail-closed).
 *
 * README-Teil (`pruefeReadme`, prüft immer den aktuellen Stand, nicht den Diff): die README verweist auf die Befehls- und die
 * Anlaufstellen-Seite (nur wenn die Zielseite im Repo existiert, damit kein Bezieher nach dem Sync rot wird) und trägt die H2-Abschnitte
 * aus `dokuPflicht.readmeAbschnitte` der Projekt-Config (ohne den Schlüssel keine Abschnittsprüfung).
 *
 * Verfall (ADR 0027): Prüftermin laut Registerzeile `verfall-doku-pflicht-604` des Änderungsregisters (Fangquote).
 *
 * Grenze (bewusst): die Pflicht prüft nur, DASS Doku mitläuft, nicht ob sie zur Änderung passt; das tun Review-Lens und `check:docdrift`.
 * Ein reiner Refactor in `scripts/` braucht darum eine Doku-Zeile oder den Override; die Fangquote steht im Änderungsregister.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBase } from "./check-basis.mjs";
import { blockSpanne } from "./besitz-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { QUELL_VERZEICHNIS, ZEIGER_WURZEL } from "./skill-pfade.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { commitZeilenAus, meldeUngueltigeOverrides, sliceOverride, staleOverrideHinweis, versetzteOverrideHinweis } from "./slice-override.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Pfad-Präfixe, deren Änderung Verhalten ändert (die AGENTS.md zählt nur mit geändertem Kern-Block, siehe `bewerte`). */
export const VERHALTENS_PRAEFIXE = ["scripts/", ".claude/agents/", `${ZEIGER_WURZEL}/`, `${QUELL_VERZEICHNIS}/`];

/** Seiten, auf die die README verweisen muss (sofern sie im Repo existieren). */
export const README_VERWEISE = ["docs/referenz/befehle.md", "docs/referenz/anlaufstellen.md"];

const istDoku = (p) => p.startsWith("docs/") || p === "README.md";
const istVerhalten = (p) => VERHALTENS_PRAEFIXE.some((x) => p.startsWith(x));

/** Hat sich der Kern-Block der AGENTS.md zwischen `alt` und `neu` geändert? Fehlt eine Seite oder ein Marker: ja (fail-closed). Pur. */
export function kernBlockGeaendert(alt, neu) {
  if (typeof alt !== "string" || typeof neu !== "string") return true;
  const a = blockSpanne(alt, "kern");
  const n = blockSpanne(neu, "kern");
  if (a === null || n === null) return true;
  return alt.slice(a[0], a[1]) !== neu.slice(n[0], n[1]);
}

/**
 * Urteil über die geänderten Dateien eines Slices. `override` ist der Grund aus der Commit-Zeile oder `null`.
 * `{ verhalten, doku, rot, allowed, stale }`: `rot` = Verhaltens-Pfad ohne Doku-Pfad und ohne Override, `allowed` = rot, aber per Override
 * durchgelassen, `stale` = Override ohne Bedarf. Pur.
 */
export function bewerte({ dateien, agentsKernGeaendert = false, override = null }) {
  const verhalten = dateien.filter(istVerhalten);
  if (agentsKernGeaendert && dateien.includes("AGENTS.md")) verhalten.push("AGENTS.md");
  const doku = dateien.filter(istDoku);
  const bedarf = verhalten.length > 0 && doku.length === 0;
  const hatOverride = override !== null;
  return { verhalten, doku, rot: bedarf && !hatOverride, allowed: bedarf && hatOverride, stale: !bedarf && hatOverride };
}

/** H2-Überschriften (`## Text`) des Markdown-Texts, getrimmt. Pur. */
const h2Aus = (text) => [...text.replace(/\r/g, "").matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)].map((m) => m[1]);

/**
 * README-Befunde (Textliste, leer = ok). `seitenVorhanden(pfad)` sagt, ob die Verweis-Zielseite im Repo liegt (nur dann ist der Verweis Pflicht),
 * `abschnitte` sind die konfigurierten H2-Überschriften. Ohne README (`readme === null`, etwa im Bezieher) gilt: Befund nur, wenn Abschnitte konfiguriert sind; die Verweise setzen eine README voraus. Pur.
 */
export function pruefeReadme({ readme, seitenVorhanden, abschnitte = [] }) {
  const verlangt = [...README_VERWEISE.filter((s) => seitenVorhanden(s)).map((s) => ({ art: "verweis", wert: s })), ...abschnitte.map((a) => ({ art: "abschnitt", wert: a }))];
  if (readme === null) return abschnitte.length > 0 ? ["README.md fehlt"] : [];
  const h2 = h2Aus(readme);
  const befunde = [];
  for (const v of verlangt) {
    if (v.art === "verweis" && !readme.includes(v.wert)) befunde.push(`README.md verweist nicht auf ${v.wert}`);
    if (v.art === "abschnitt" && !h2.includes(v.wert)) befunde.push(`README.md hat keinen Abschnitt „## ${v.wert}“`);
  }
  return befunde;
}

/** Geänderte Dateien des Slices (`<basis>...HEAD`) und ob der Kern-Block der AGENTS.md sich geändert hat. `null`, wenn der Diff nicht messbar ist. */
export function leseSlice(git, base) {
  let dateien;
  try {
    dateien = git(["diff", "--name-only", `${base}...HEAD`]).split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
  } catch {
    return null; // nicht messbar: kein falsches Rot (wie check:lockfile)
  }
  let agentsKernGeaendert = false;
  if (dateien.includes("AGENTS.md")) {
    const lies = (ref) => {
      try {
        return git(["show", `${ref}:AGENTS.md`]);
      } catch {
        return null;
      }
    };
    agentsKernGeaendert = kernBlockGeaendert(lies(base), lies("HEAD"));
  }
  return { dateien, agentsKernGeaendert };
}

/** Slice-Prüfung mit Override-Lesen; `skipped`, wenn keine Basis auflösbar oder der Diff nicht messbar ist. `runGit`/`env` injizierbar. */
export function checkDokuPflichtSlice({ runGit, env = process.env, zeilen } = {}) {
  const git = runGit ?? ((args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  const base = resolveBase(git, env);
  if (!base) return { skipped: true };
  const slice = leseSlice(git, base);
  if (slice === null) return { skipped: true };
  const { reason, invalid, versetzt } = sliceOverride(git, base, zeilen.dokuOverride);
  return { skipped: false, reason, invalidOverrides: invalid, versetzteOverrides: versetzt, ...bewerte({ ...slice, override: reason }) };
}

/** README-Prüfung gegen die echte Platte (`rootDir`): liest README.md und prüft die Verweisziele per `existsSync`. */
export function checkReadme({ rootDir = ROOT, abschnitte = [] } = {}) {
  const pfad = join(rootDir, "README.md");
  const readme = existsSync(pfad) ? readFileSync(pfad, "utf8") : null;
  return pruefeReadme({ readme, seitenVorhanden: (s) => existsSync(join(rootDir, s)), abschnitte });
}

/** README-Prüfung mit den Abschnitten aus der Projekt-Config (`dokuPflicht.readmeAbschnitte`, ohne den Schlüssel keine). */
export const checkReadmeAusConfig = (config, rootDir = ROOT) => checkReadme({ rootDir, abschnitte: config?.dokuPflicht?.readmeAbschnitte ?? [] });

/** Ein Lauf des Gates: Exit-Code (0 ok, 1 rot). Ausgabe über `log`/`err`, Git, Config und Wurzel injizierbar (Test); `paint(code, text)` färbt. */
export function laufe({ config, rootDir = ROOT, runGit, env = process.env, log = console.log, err = console.error, paint = (_c, s) => s } = {}) {
  const zeilen = commitZeilenAus(config);
  const red = (s) => paint("31", s);
  const dim = (s) => paint("2", s);
  let rot = false;

  for (const b of checkReadmeAusConfig(config, rootDir)) {
    err(red(`✖ ${b}`));
    rot = true;
  }

  const s = checkDokuPflichtSlice({ zeilen, runGit, env });
  if (!s.skipped) {
    meldeUngueltigeOverrides(s.invalidOverrides, { dim, log });
    if (s.stale) {
      err(red(staleOverrideHinweis(zeilen.dokuOverride, "der Slice ändert kein Verhalten ohne Doku")));
      rot = true;
    } else if (s.allowed) {
      log(dim(`• geduldet: Verhaltens-Änderung ohne Doku — bewusst durchgelassen: ${s.reason}`));
    } else if (s.rot) {
      err(red(`✖ Verhaltens-Pfade geändert (${s.verhalten.slice(0, 5).join(", ")}${s.verhalten.length > 5 ? ", …" : ""}), aber weder docs/ noch README.md.`));
      for (const h of versetzteOverrideHinweis(zeilen.dokuOverride, s.versetzteOverrides)) err(h);
      err(
        "\nFix: die betroffene Doku im selben Slice nachziehen (docs/ oder README.md). Ändert der Slice wirklich nichts, was Doku braucht\n" +
          `(z. B. ein reiner Refactor), mit Pflicht-Begründung als Commit-Zeile durchlassen:\n  git commit --allow-empty -m "chore: Doku unverändert (#<nr>)" -m "${zeilen.dokuOverride}: #<nr> warum"`,
      );
      rot = true;
    }
  }
  if (rot) return 1;
  log("✔ check:dokupflicht ok — Verhaltens-Änderungen tragen Doku, die README verweist auf die Referenzseiten.");
  return 0;
}

function main() {
  const tty = process.stdout.isTTY;
  process.exitCode = laufe({ config: ladeProjektConfig(), paint: (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s) });
}

if (istDirektaufruf(import.meta.url)) main();
