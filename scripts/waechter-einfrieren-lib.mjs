/* Eingefrorene Wächter (factory#611, Regel-Verfall 4/4 von factory#517): die zulässige Einfrier-Liste aus dem Änderungsregister.
 *
 * Quelle ist die Verfall-Zeile mit Feld `eingefroren`. Diese Datei prüft fail-closed, was `vite.config.ts` ins `test.exclude` übernehmen darf:
 * kein Sicherheits-Ausnahme-Ziel (ADR 0027 Punkt 6), kein Durch-Wächter einer Regel, kein verteilter Wächter (kern-test), keiner der
 * Selbstschutz-Wächter. Die Config wirft bei einem Verstoß, statt still abzuschalten. Die Existenz der Datei prüft
 * `test/harness/waechter-einfrieren.test.ts`. Pure Funktionen, kein Netz, kein Env. Hier und nicht in `aenderungsregister-lib.mjs`,
 * weil `regel-verfall-lib.mjs` diese schon importiert (sonst Import-Zyklus). */
import { artVon } from "./besitz-extraktion.mjs";
import { EINZELWAECHTER } from "./aenderungsregister-lib.mjs";
import { SICHERHEITS_AUSNAHMEN, istSicherheitsAusnahme } from "./regel-verfall-lib.mjs";

/** Diese Wächter schützen den Einfrier-Hebel selbst und werden nie eingefroren. */
export const SELBSTSCHUTZ = ["test/harness/waechter-einfrieren.test.ts", "test/harness/regel-verfall.test.ts", "test/harness/aenderungsregister.test.ts"];

/** Pur: die eingefrorenen Ziele (Verfall-Zeilen mit Feld `eingefroren`) in Registerreihenfolge. */
export const eingefroreneAusRegister = (zeilen) =>
  zeilen.filter((z) => z.art === "verfall" && z.eingefroren !== undefined).map((z) => ({ id: String(z.id), ziel: String(z.ziel) }));

/** Pur: Verstöße (leer = zulässig) der eingefrorenen Zeilen gegen Ausnahmeliste, durch, Verteilung und Selbstschutz. */
export function pruefeEingefroreneZiele({ zeilen, extraktion, ausnahmen = SICHERHEITS_AUSNAHMEN }) {
  const verfall = zeilen.filter((z) => z.art === "verfall");
  const durchIds = new Set(verfall.flatMap((z) => (Array.isArray(z.durch) ? z.durch : [])));
  const durchZiele = new Set(verfall.filter((z) => durchIds.has(z.id)).map((z) => String(z.ziel)));
  const aus = [];
  for (const { id, ziel } of eingefroreneAusRegister(zeilen)) {
    if (!EINZELWAECHTER.test(ziel)) aus.push(`${id}: ${ziel} ist kein einzelner Wächter test/harness/<name>.test.ts`);
    if (istSicherheitsAusnahme(ziel, ausnahmen)) aus.push(`${id}: ${ziel} steht in der Sicherheits-Ausnahmeliste und darf nicht eingefroren werden`);
    if (durchZiele.has(ziel)) aus.push(`${id}: ${ziel} ist Durch-Wächter einer Regel und darf nicht eingefroren werden`);
    if (artVon({ eintraege: extraktion }, ziel) === "kern-test") aus.push(`${id}: ${ziel} ist verteilt (kern-test) und darf in der Fabrik nicht eingefroren werden`);
    if (SELBSTSCHUTZ.includes(ziel)) aus.push(`${id}: ${ziel} schützt den Einfrier-Hebel selbst und darf nicht eingefroren werden`);
  }
  return aus;
}

/** Pur: `exclude`-Liste für Vitest = Standardliste plus die eingefrorenen Ziele; wirft bei einem Verstoß (fail-closed). */
export function excludeListe(standard, zeilen, extraktion, ausnahmen = SICHERHEITS_AUSNAHMEN) {
  const verstoesse = pruefeEingefroreneZiele({ zeilen, extraktion, ausnahmen });
  if (verstoesse.length > 0) throw new Error(`Einfrieren unzulässig:\n${verstoesse.join("\n")}`);
  return [...standard, ...eingefroreneAusRegister(zeilen).map((x) => x.ziel)];
}
