/**
 * Verweis auf eine Factory-Seite in Laufzeitmeldungen (#90 Z26). Ein Projekt, das den Harness per Sync bezieht, trägt die Factory-Seiten
 * (`docs/agent-harness.md` & Co.) nicht selbst; eine Meldung mit lokalem Pfad liefe dort ins Leere. Darum: mit Sync-Stand
 * (`.factory/sync-stand.json` › `quelle.tag`) und Factory-Board-Repo (Board mit Rolle `factory` › `repo`, ohne Schlüssel das Config-Repo)
 * ein GitHub-Link auf den gesyncten Tag, sonst der lokale Pfad (Upstream selbst, fehlende oder kaputte Daten). Die Link-Wächter-Erweiterung
 * (Link statt Pfad prüfen) steht in #93; der Wächter `test/harness/factory-seite.test.ts` prüft die Literal-Aufrufe von `factorySeiteIn`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { boardRepo, ladeProjektConfig } from "./projekt-config-lib.mjs";

/** Pur: `https://github.com/<repo>/blob/<tag>/<pfad>#<anker>` mit `repo` und `tag`, sonst `<pfad>#<anker>`; ohne Anker ohne `#`. */
export function factorySeite({ pfad, anker, repo, tag }) {
  const ziel = anker ? `${pfad}#${anker}` : pfad;
  return repo && tag ? `https://github.com/${repo}/blob/${tag}/${ziel}` : ziel;
}

/** Liest `quelle.tag` des Sync-Stands; `undefined` bei fehlender oder kaputter Datei. */
function syncTag(wurzel) {
  try {
    const tag = JSON.parse(readFileSync(join(wurzel, ".factory", "sync-stand.json"), "utf8"))?.quelle?.tag;
    return typeof tag === "string" && tag !== "" ? tag : undefined;
  } catch {
    return undefined;
  }
}

/** Liest das Repo des Factory-Boards; `undefined` bei fehlender oder ungültiger Config. */
function factoryRepo(wurzel) {
  try {
    const config = ladeProjektConfig({ rootDir: wurzel, pruefen: false });
    const board = config?.boards?.find((b) => b?.rolle === "factory");
    return board ? boardRepo(board, config) : undefined;
  } catch {
    return undefined;
  }
}

/** Verweis auf `pfad#anker` der Factory-Seite, bezogen auf die Wurzel eines Projekts. Wirft nie; bei fehlenden Daten der lokale Pfad. */
export function factorySeiteIn(wurzel, pfad, anker) {
  const tag = syncTag(wurzel);
  return factorySeite({ pfad, anker, tag, repo: tag ? factoryRepo(wurzel) : undefined });
}
