// Blatt-Modul ohne Importe (factory#519): Besitz-Profil als Wahl des Beziehers, Vorbild `modul-wahl-lib.mjs`.
// Eine Besitz-Einheit mit Manifest-Feld `profil: "voll"` wird nur an Bezieher verteilt, die in der Projekt-Config `"profil": "voll"` wählen oder den Schlüssel weglassen (Standard).
// Wählt ein Bezieher `"profil": "minimal"`, entfallen die Einheiten mit `profil: "voll"`; Einheiten ohne das Feld gehören immer zum Minimalprofil. Gelöscht wird im Ziel nie etwas.
// Sicherheit: kein Sicherheits-Gate und kein Sicherheits-Hook darf `profil` tragen, auch nicht über etwas, das er importiert. Die geschlossene Liste `SICHERHEITS_EINSTIEGE`
// nennt die Einstiege (Muster mit `*` für ein Pfadsegment, `**` für beliebig tief); der Wächter in `test/harness/kern-reinheit.test.ts` bildet ihre statische Import-Hülle
// und meldet jede Einheit darin, die `profil` trägt. Grenze: dynamische Importe und zur Laufzeit gebaute Pfade sieht die Hülle nicht; neue Sicherheits-Skripte müssen ins Muster passen oder hier ergänzt werden.

/** Wählbare Profile; `voll` ist der Stand vor factory#519. */
export const PROFILE = ["voll", "minimal"];
/** Profil ohne Schlüssel `profil` in der Config. */
export const PROFIL_STANDARD = "voll";
/** Einziger Wert des Manifest-Felds `profil`: die Einheit gehört nur zum Vollprofil. */
export const PROFIL_VOLL = "voll";

/** Einstiege der Sicherheits-Hülle (Muster auf Besitz-Pfade). Hooks aus `.claude/settings.json`, Gates, Guards, Risikostufe, Fremdtext, Review-Rollen und alle Workflows. */
export const SICHERHEITS_EINSTIEGE = [
  ".claude/settings.json",
  ".claude/agents/*",
  "**/review-lenses/**", // die Review-Skills (der Skill-Ordner steht als Literal nur in skill-pfade.mjs)
  ".github/workflows/*",
  "scripts/pretooluse-hook.mjs",
  "scripts/stop-verify-hook.mjs",
  "scripts/haupt-sync.mjs",
  "scripts/langfuse-abgleich-hook.mjs",
  "scripts/sandbox-doctor.mjs",
  "scripts/mcp-ausfall.mjs",
  "scripts/langfuse-vorbedingung.mjs",
  "scripts/check-*.mjs",
  "scripts/gate-befehl.mjs",
  "scripts/verify-lauf.mjs",
  "scripts/sicherheitspruefung*.mjs",
  "scripts/risikostufe*.mjs",
  "scripts/fremdtext*.mjs",
  "scripts/gh-guard-hook.mjs",
  "scripts/worktree-guard-*.mjs",
  "scripts/stdin-skript-guard.mjs",
  "scripts/holdout-*guard.mjs",
  "scripts/lens-*-guard.mjs",
];

const textOk = (w) => typeof w === "string" && PROFILE.includes(w);
const FIX = `profil auf einen der Werte ${PROFILE.map((p) => `"${p}"`).join(" oder ")} setzen oder den Schlüssel entfernen (Standard ${PROFIL_STANDARD})`;

/** Gewähltes Profil der Config; fehlender oder ungültiger Schlüssel ergibt den Standard (ungültig meldet `profilFormFehler`). */
export const gewaehltesProfil = (config) => (textOk(config?.profil) ? config.profil : PROFIL_STANDARD);

/** Wird die Einheit im gewählten Profil verteilt? Nur `profil: "voll"` fällt bei `minimal` weg. */
export const profilGewaehlt = (e, profil) => e.profil !== PROFIL_VOLL || profil !== "minimal";

/** Fehler der Form von `profil` in der Config (leer = in Ordnung). */
export function profilFormFehler(config) {
  if (config?.profil === undefined || textOk(config.profil)) return [];
  return [`profil muss einer der Werte ${PROFILE.map((p) => `"${p}"`).join(", ")} sein\nFix: ${FIX}`];
}

/** Darf `von` die Einheit `nach` importieren? Eine Einheit ohne `profil` importiert keine Einheit mit `profil` (sie fehlte im Minimalprofil). */
export const profilImportErlaubt = (von, nach) => nach.profil === undefined || von.profil !== undefined;

/** Manifest-Fehler des Felds `profil` an einer Einheit (leer = gültig oder nicht gesetzt): nur `"voll"`, nur an ganzen Dateien, nicht an Workflows, Pflicht-Check-Einheiten, Modul-Einheiten, Vorlagen und im Ring `oberflaeche`. */
export function profilFehler(e) {
  if (e.profil === undefined) return [];
  if (e.profil !== PROFIL_VOLL) return [`profil darf nur "${PROFIL_VOLL}" sein`];
  const f = [];
  if (e.block !== undefined || e.schluessel !== undefined) f.push("profil nur an einer ganzen Datei (kein block, kein schluessel)");
  if (e.art !== undefined) f.push("profil und art zugleich (eine Vorlage gehört keinem Profil)");
  if (e.modul !== undefined) f.push("profil und modul zugleich (ein Modul wird über module gewählt)");
  if (e.pflichtChecks !== undefined) f.push("profil nicht an einer Einheit mit pflichtChecks (ein Pflicht-Check darf nie wegfallen)");
  if (typeof e.pfad === "string" && e.pfad.startsWith(".github/workflows/")) f.push("profil nicht an einem Workflow (Workflows sind Sicherheits-Einstiege)");
  if (e.ring === "oberflaeche") f.push("profil nicht im Ring oberflaeche");
  return f;
}

const musterRegex = (m) => new RegExp(`^${m.split("**").map((t) => t.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*")}$`);

/** Trifft der Pfad einen Einstieg der Sicherheits-Hülle? */
export const istSicherheitsEinstieg = (pfad) => SICHERHEITS_EINSTIEGE.some((m) => musterRegex(m).test(pfad));
