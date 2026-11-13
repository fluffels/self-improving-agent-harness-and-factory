// Einstieg: soll von Codex per `node scripts/codex-hook.mjs` (Registrierung `.codex/hooks.json`, erzeugt von codex-setup) als PreToolUse-Hook gestartet werden; Grenze: Codex 0.168.0 (CLI-TUI) lädt die lokale Datei nicht (factory#458), über `-c`-Flags geladen lief er in factory#367.
// Adapter-Logik, Payload-Format und Grenzen: scripts/codex-hook-lib.mjs und docs/codex/einstieg.md § Codex-Hook-Schnittstelle.
/** Codex-Hook-Adapter (factory#364): liest das Payload von stdin, gibt ein Deny-JSON oder nichts aus; Exit-Code immer 0 (Deny steht im JSON). Reines Node-Skript (nur Builtins). */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { entscheide } from "./codex-hook-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { emit, readStdin } from "./hook-io.mjs";

if (istDirektaufruf(import.meta.url)) emit(await entscheide(readStdin(), dirname(dirname(fileURLToPath(import.meta.url)))));
