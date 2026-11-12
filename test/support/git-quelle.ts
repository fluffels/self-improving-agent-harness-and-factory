import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type GitHuelle = (cwd: string, ...args: string[]) => unknown;

/** Naht für Tests des Helfers: Ordner anlegen, Datei schreiben. */
export interface QuelleNaehte {
  mkdir: (pfad: string) => void;
  schreibe: (pfad: string, text: string) => void;
}

const ECHT: QuelleNaehte = { mkdir: (p) => void mkdirSync(p, { recursive: true }), schreibe: (p, t) => writeFileSync(p, t) };

/**
 * Quell-Repo mit einem Commit und davon ein Bare-Klon (`ziel`) für die Arbeitsplatz-Tests.
 * Der Commit startet sonst `git maintenance run --auto --quiet --detach`, dessen Commit-Graph-Schreiben
 * (`commit-graphs/tmp_graph_*`) mit dem folgenden lokalen Klon um Hardlinks läuft (factory#383);
 * `maintenance.auto=false` und `gc.auto=0` verhindern den Start (beide, damit ältere Git-Stände ruhig bleiben).
 * `git` ist die Hülle des Aufrufers (Hook- und Identitäts-Umgebung), `(cwd, ...args)`.
 */
export const quelleMitBareKlon = (git: GitHuelle, quelle: string, ziel: string, naehte: QuelleNaehte = ECHT): void => {
  naehte.mkdir(quelle);
  git(quelle, "init", "-q", "-b", "main");
  naehte.schreibe(join(quelle, "README.md"), "x\n");
  git(quelle, "add", "-A");
  git(quelle, "-c", "maintenance.auto=false", "-c", "gc.auto=0", "commit", "-q", "-m", "init");
  git(dirname(quelle), "clone", "-q", "--bare", quelle, ziel);
};
