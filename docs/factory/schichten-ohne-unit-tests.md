# Schichten ohne Unit-Tests und das e2e-Gate-Profil

> 🧭 **Fachlich geprüft am: 2026-11-12.**

Kern-Politik (factory#246): Wie ein Projekt mit Schichten umgeht, die sich nicht sinnvoll unit-testen lassen (Oberfläche, Einstieg, Framework-Anbindung), und wie es optional ein e2e-Gate zuschaltet. Konkrete Zahlen, Frameworks und Werkzeuge sind Projektwerte; diese Seite nennt keine.

## Geltung

Eine **Schicht ohne Unit-Tests** ist eine Schicht, deren Diff-Floor im Coverage-Prüfer `null` ist: Ihre Abdeckung wird gemessen und berichtet, aber nicht gegatet. Das ist die Ausnahme, nicht die Regel. Logik gehört in testbare Schichten; die Politik unten hält den Druck dorthin aufrecht.

## Floor

- **Diff-Floor:** `scripts/check-diffcoverage.mjs` kennt je Schicht einen Mindestwert für die geänderten Zeilen. Für Schichten ohne Unit-Tests steht dort `null`, also nur berichtend. Die Werte sind Kern-Konstanten, kein Projektschlüssel.
- **Aggregat-Floor:** In der Test-Config des Projekts steht ein expliziter Floor über 0, niedrig, aber nicht 0 (kein stilles Absacken); trennt die Test-Config Schichten, steht er je Schicht, sonst einer für das ganze Repo. Die Zahl ist ein Projektwert.

## Ratchet

- Es gilt die Regel „Kein Grün-durch-Aufweichen“ der Arbeitsanweisung; hier konkret: Ein Floor wird nur per reviewtem Commit **angehoben**, nie gesenkt, um ein Rot grün zu bekommen; eine automatische Nachführung des Floors bleibt aus.
- Das Ventil ist die Commit-Zeile `Diffcov-Override: #<nr> warum` (mit dem Commit-Zeilen-Präfix des Projekts), nur mit offenem Ticket und Begründung.
- Eine Schicht geht erst von `null` auf einen harten Diff-Floor, wenn sie Unit-Tests hat. Vorher wäre der Floor eine Zahl ohne Aussage.

## Größenschwelle

Für Dateien dieser Schichten gilt eine Schwelle **strenger** als das allgemeine Budget von `check:size`. Sie zwingt Logik aus der Oberfläche in testbare Schichten, bevor eine Datei groß wird. Die Zahl ist ein Projektwert. Ehrlich: Der Kern erzwingt nur das allgemeine Budget; die engere Schwelle setzt ein Projekt-Gate oder das Review durch (der Kern hat dafür kein Gate).

## Netz

Was Unit-Tests nicht abdecken, fangen drei Netze:

1. **e2e-Smoke in der CI:** wenige Pfade, die zeigen, dass die Schicht startet und die Hauptfunktion antwortet (optional, siehe unten).
2. **Browser-Prüfung im Lauf:** der Agent prüft Sicht- und Bedienbares per Playwright-MCP, nicht nur „sollte gehen“.
3. **Holdout-Abnahme:** eine frische Instanz prüft das Ergebnis gegen die Akzeptanzkriterien durch Beobachtung, ohne Code zu lesen.

## e2e-Gate-Profil

Opt-in, laufzeitneutral (CI plus Läufer, kein Claude- oder Codex-Adapter nötig).

**Config:** zwei Teile, die zusammengehören.

```json
{
  "e2e": { "browser": ["<name>", "<name>"] },
  "befehle": { "e2e": "<Befehlszeile des Projekts>" }
}
```

- `e2e.browser`: nicht leere Liste von Namen aus Kleinbuchstaben, Ziffern und `-`, beginnend mit einem Buchstaben, ohne Doppelte (z. B. `a`, `b`); keine weiteren Schlüssel.
- `befehle.e2e`: die Befehlszeile, die der Läufer `node scripts/gate-befehl.mjs e2e` startet.
- Ein Teil ohne den anderen ist ein Config-Fehler mit `Fix:` (fail-closed); ein halb konfiguriertes Profil ist nie still.

**Adapter-Vertrag:** Der Befehl liest den Browser-Namen aus der Umgebungsvariable `FACTORY_E2E_BROWSER`. Wie er damit sein Werkzeug startet, ist Projektsache.

**CI-Rezept:** Der Kern verteilt keinen Workflow; das Projekt legt die beiden Jobs in seine eigene CI. Actions per Commit-SHA pinnen (Platzhalter unten). Kein `${{ }}` in einer `run:`-Zeile, nur über `env:`.

```yaml
jobs:
  e2e-matrix:
    runs-on: ubuntu-latest
    outputs:
      aktiv: ${{ steps.profil.outputs.aktiv }}
      browser: ${{ steps.profil.outputs.browser }}
    steps:
      - uses: actions/checkout@<sha> # <version>
        with:
          persist-credentials: false
      - uses: actions/setup-node@<sha> # <version>
      - id: profil
        run: node scripts/e2e-profil.mjs matrix >> "$GITHUB_OUTPUT"

  e2e:
    needs: e2e-matrix
    if: needs.e2e-matrix.outputs.aktiv == 'true'
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        browser: ${{ fromJSON(needs.e2e-matrix.outputs.browser) }}
    steps:
      - uses: actions/checkout@<sha> # <version>
        with:
          persist-credentials: false
      - uses: actions/setup-node@<sha> # <version>
      - run: node scripts/gate-befehl.mjs install
      - run: node scripts/gate-befehl.mjs e2e
        env:
          FACTORY_E2E_BROWSER: ${{ matrix.browser }}
```

Ob der Job `e2e` ein Required-Check wird, entscheidet der Bezieher in seinem Ruleset (Pre-Flight-Klärung, Außenwirkung).

## Ohne Profil

Ohne Block `e2e` und ohne `befehle.e2e` gibt es keinen Job, keine Prüfung und keinen Hinweis; `node scripts/gate-befehl.mjs e2e` meldet nur „nicht eingerichtet“ (Exit 0), `node scripts/e2e-profil.mjs matrix` gibt `aktiv=false` und `browser=[]` aus. Für Bezieher ohne Profil ändert sich nichts.

## Grenzen

- Die Diff-Floors sind Kern-Konstanten, kein Projektschlüssel.
- Kein Doctor-Punkt: Ein Block ohne CI-Job bleibt wirkungslos.
- Die Größenschwelle hat kein Kern-Gate.
- Wer das Profil nutzt, braucht eigene Erfahrung vor dem Härten (Härten braucht dieselbe Evidenz wie Lockern, ADR 0027).
