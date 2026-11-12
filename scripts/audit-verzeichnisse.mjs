#!/usr/bin/env node
/**
 * npm audit je Lockfile-Verzeichnis (factory#395): die Wurzel plus die Verzeichnisse aus `audit.verzeichnisse` der Projekt-Config.
 * Ohne den Block prüft das Skript nur die Wurzel, wie das bisherige `npm audit`.
 *
 * Aufruf: node scripts/audit-verzeichnisse.mjs --audit-level <info|low|moderate|high|critical>
 * Exit: 0 alle Verzeichnisse sauber, 1 mindestens eines rot (alle werden geprüft, kein Abbruch beim ersten), 2 falsche Bedienung oder Config nicht lesbar.
 *
 * Die Bausteine (`auditVerzeichnisse`, `npmAuditJson`) stehen in `audit-verzeichnisse-lib.mjs`.
 */
import { istDirektaufruf } from "./direktaufruf.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { auditVerzeichnisse, npmAuditLauf } from "./audit-verzeichnisse-lib.mjs";

const STUFEN = ["info", "low", "moderate", "high", "critical"];
const EXIT_AUFRUF = 2;

function stufeAusArgv(argv) {
  const [flag, stufe, ...rest] = argv;
  return flag === "--audit-level" && STUFEN.includes(stufe) && rest.length === 0 ? stufe : undefined;
}

/** Einstieg. `deps` (Tests): `ladeConfig()`, `fuehreAus(verzeichnis, args)` (liefert den Exit-Code), `log`, `err`. Rückgabe: Exit-Code. */
export function main(argv = process.argv.slice(2), { ladeConfig = () => ladeProjektConfig(), fuehreAus = npmAuditLauf, log = console.log, err = console.error } = {}) {
  const stufe = stufeAusArgv(argv);
  if (!stufe) {
    err(`✖ Aufruf: node scripts/audit-verzeichnisse.mjs --audit-level <${STUFEN.join("|")}>`);
    return EXIT_AUFRUF;
  }
  let config;
  try {
    config = ladeConfig();
  } catch (e) {
    err(`✖ Projekt-Config nicht lesbar: ${e instanceof Error ? e.message : e}`);
    return EXIT_AUFRUF;
  }
  const rot = auditVerzeichnisse(config).filter((v) => {
    log(`npm audit (${v}), Stufe ${stufe}`);
    return fuehreAus(v, [`--audit-level=${stufe}`]) !== 0;
  });
  if (rot.length > 0) log(`✖ Advisories ab ${stufe} in: ${rot.join(", ")}`);
  return rot.length > 0 ? 1 : 0;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = main();
