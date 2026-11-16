// Kein Shebang — wird per `node scripts/check-basis-nachlauf.mjs` (PR-CI) gestartet und von test/check-basis-nachlauf.test.ts importiert.
/**
 * Basis-Nachlauf (factory#499 L7): schließt das Fenster zwischen dem letzten Einmergen von main und dem Auto-Merge.
 *
 * Hintergrund: das Ruleset verlangt keinen aktuellen Stand („strict“ würde parallele Auto-Merges blockieren). Zwei je grüne PRs
 * können so zusammen main rot machen (semantischer Konflikt). Beleg: Der PR mit Base 711d224 mergte 40 s nach dem Vorgänger, main rot.
 * Der Schritt läuft als letzter Schritt des Required-Jobs `build-test`: er holt die aktuelle Basis, mergt sie runner-lokal in den
 * PR-Merge-Ref (nie pushen) und fährt `install` und `verifyKompakt` (ohne Coverage) mit `FACTORY_DIFF_BASE` auf dem neuen Tip.
 * Bewegt sich die Basis währenddessen weiter, wiederholt er bis `MAX_RUNDEN`; danach rot („Lauf neu starten“).
 *
 * Aufruf: `FACTORY_BASIS_REF=<Branch> [FACTORY_PR_DRAFT=true] node scripts/check-basis-nachlauf.mjs`
 * Exit: 0 grün oder entfällt (Entwurf, Basis unverändert), 1 rot (Konflikt, Gate rot, Basis bewegt sich weiter, git-Fehler), 2 Aufruf-Fehler.
 *
 * Grenzen: zwischen Schrittende und Merge bleibt ein Fenster von Sekunden (größer, wenn ein anderer Required-Check später fertig wird);
 * der Fetch braucht Lesezugriff ohne persistierte Credentials (öffentliches Repo); ein Re-Run nutzt denselben Merge-Ref.
 * Verfall: Prüftermin laut Registerzeile `verfall-basis-nachlauf-499` der Fabrik (ADR 0027).
 *
 * Reines Node-Skript (nur Builtins); die Entscheidung ist pur exportiert, die Seiteneffekte laufen über `io`.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";

export const MAX_RUNDEN = 3;

const WURZEL = fileURLToPath(new URL("../", import.meta.url));
const GUELTIGE_REF = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;

/** Pure Entscheidung je Runde: "fertig" (Basis getestet), "abbruch" (Obergrenze erreicht) oder "merge". */
export const naechsterSchritt = ({ getestet, aktuell, runde, max }) => {
  if (getestet === aktuell) return "fertig";
  return runde >= max ? "abbruch" : "merge";
};

const refGueltig = (ref) => typeof ref === "string" && GUELTIGE_REF.test(ref) && !ref.includes("..");

const neueGateUmgebung = (env, diffBasis) => {
  const kopie = { ...env, FACTORY_DIFF_BASE: diffBasis };
  delete kopie.FACTORY_COVERAGE;
  return kopie;
};

/** Merged `sha` runner-lokal. Liefert true bei Erfolg, sonst false (nach `merge --abort`). */
const mergeEin = (sha, io) => {
  try {
    io.git(["-c", "user.name=basis-nachlauf", "-c", "user.email=basis-nachlauf@invalid", "merge", "--no-edit", "--no-ff", sha]);
    return true;
  } catch {
    try {
      io.git(["merge", "--abort"]);
    } catch {
      /* kein Merge im Gang: nichts abzubrechen */
    }
    return false;
  }
};

/** Eine Runde mit neuer Basis: Merge, install, verifyKompakt. Liefert null bei Erfolg, sonst die Fehlermeldung. */
const pruefeNeueBasis = (aktuell, ref, env, io) => {
  if (!mergeEin(aktuell, io)) {
    return `Merge-Konflikt mit neuem ${ref} (${aktuell.slice(0, 7)}): origin/${ref} einmergen, Konflikt lösen, pushen.`;
  }
  const gateEnv = neueGateUmgebung(env, aktuell);
  if (io.gate("install", gateEnv) !== 0) return "install nach dem Merge der neuen Basis schlug fehl.";
  if (io.gate("verifyKompakt", gateEnv) !== 0) {
    return `semantischer Konflikt mit neuem ${ref} (${aktuell.slice(0, 7)}): verifyKompakt auf dem Stand mit der neuen Basis ist rot; origin/${ref} einmergen, Gate beheben, pushen.`;
  }
  return null;
};

const holeAktuell = (ref, io) => {
  io.git(["fetch", "--no-tags", "origin", "--", ref]);
  return io.git(["rev-parse", "FETCH_HEAD"]).trim();
};

const laufe = (ref, env, io) => {
  let getestet = io.git(["rev-parse", "HEAD^1"]).trim();
  io.git(["rev-parse", "HEAD^2"]);
  for (let runde = 0; ; runde++) {
    const aktuell = holeAktuell(ref, io);
    const schritt = naechsterSchritt({ getestet, aktuell, runde, max: MAX_RUNDEN });
    if (schritt === "fertig") {
      io.out(`Basis-Nachlauf: ${ref} bei ${aktuell.slice(0, 7)} ist getestet (${runde} Nachlauf-Runden).`);
      return 0;
    }
    if (schritt === "abbruch") {
      io.err(`✖ Basis bewegt sich weiter, Lauf neu starten (nach ${MAX_RUNDEN} Nachlauf-Runden).`);
      return 1;
    }
    const fehler = pruefeNeueBasis(aktuell, ref, env, io);
    if (fehler) {
      io.err(`✖ ${fehler}`);
      return 1;
    }
    getestet = aktuell;
  }
};

/** Einstieg mit injizierter io: { git(args) -> stdout (wirft bei Fehler), gate(befehl, env) -> Exit-Code, out, err }. */
export const fuehreAus = (env, io) => {
  const ref = env.FACTORY_BASIS_REF;
  if (!refGueltig(ref)) {
    io.err("✖ FACTORY_BASIS_REF fehlt oder ist ungültig (Branchname ohne führendes '-', '..' oder Leerraum).");
    return 2;
  }
  if (env.FACTORY_PR_DRAFT === "true") {
    io.out("Basis-Nachlauf entfällt (Entwurf), maßgeblich ist der Lauf nach ready_for_review.");
    return 0;
  }
  try {
    return laufe(ref, env, io);
  } catch (e) {
    io.err(`✖ Basis-Nachlauf fail-closed: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
};

/** Echte Seiteneffekte; `spawn` und `cwd` sind für den Test injizierbar. */
export const echteIo = (spawn = spawnSync, cwd = WURZEL) => ({
  git: (args) => {
    const r = spawn("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} schlug fehl: ${(r.stderr || "").trim()}`);
    return r.stdout;
  },
  gate: (befehl, env) => spawn(process.execPath, ["scripts/gate-befehl.mjs", befehl], { cwd, env, stdio: "inherit" }).status ?? 1,
  out: (z) => console.log(z),
  err: (z) => console.error(z),
});

if (istDirektaufruf(import.meta.url)) process.exit(fuehreAus(process.env, echteIo()));
