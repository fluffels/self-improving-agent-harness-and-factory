# Fortschreibung #298 (2026-11-11): Symmetrische Evidenz für Härten und Lockern, Verfallsdatum je neuer Regel

Ergänzt [ADR 0027](../0027-regeln-lockern.md): Härten und Lockern bekommen dieselbe Evidenz-Hürde, jede neue Regel bekommt einen Prüftermin, und die Bedingung (b) in Punkt 2 („keine echten Funde in drei Status-Läufen“) wird ersetzt. Teil des Epics factory#275.

## Kontext

- **Asymmetrie:** Lockern verlangt Evidenz, Härten bisher nicht; das Harness wächst, ohne dass eine Regel je ihren Nutzen belegen muss.
- **Laute Prüfung nie lockerbar:** eine Prüfung wie die Test-Lens findet bei der Gegenprobe nur 6 von 12 historischen Blockern wieder, bleibt aber bei „keine echten Funde“ durch Zufallstreffer im Bestand. Punkt 2 (b) macht sie damit nie lockerbar, obwohl sie nicht reproduzierbar ist.

## Entscheidung

Entscheidung: beide Richtungen verlangen Evidenz, und jede neue Regel trägt einen Prüftermin, weil sonst nur das Harness-Wachstum belegfrei bleibt und Fundfreiheit bei lauten Prüfungen nie eintritt.

- **Härten:** eine neue oder breitere Regel (Geltungsbereich Punkt 1) braucht einen belegten Fund (Defekt oder Schadensweg mit Fundstelle, Fehlerausgabe oder `Folge #`-Commit; eine Hypothese reicht nicht) oder gemessene Kosten mit Rohwerten (Quelle, Fenster, Zählung). Ein Änderungswunsch der Maintainerin ersetzt die Evidenz in beide Richtungen; der Prüftermin ist dann der erste Evidenzpunkt. Kein Härten in diesem Sinn: einen Ratchet nachziehen (Punkt 5) oder einen Defekt an einer bestehenden Regel beheben.
- **Punkt 2 (b) ersetzt:** (a) gemessene Kosten bleibt Pflicht. Dazu eines von beiden: (b1) **deterministischer Ersatz mit mindestens gleicher Garantie**: der Ersatz fängt die echten Funde der alten Prüfung aus einer festen Basismenge reproduzierbar (Red-Green je Fall) und läuft verpflichtend an derselben Stelle (Gate oder Required Check); (b2) **Gegenprobe belegt Nicht-Reproduzierbarkeit**: dieselbe Prüfung (Prompt, Modell, Effort) läuft auf einer festen Basismenge von mindestens 12 historischen Funden und findet höchstens die Hälfte wieder (Rohwerte: Fall-Liste, Modell, Datum, Zählung; Beispiel: 6 von 12). Der Weg für Prompt-Regeln (natives Verhalten, Gegenprobe) bleibt. „Wieder drei Läufe“ in Punkt 4 heißt jetzt: neue Evidenz nach dieser Fassung; der K1-Rückfall-Trigger zählt weiter über drei Status-Läufe, er ist ein Trigger und keine Lockern-Bedingung.
- **Verfallsdatum:** jede ab dem Merge neu eingeführte Regel bekommt im einführenden PR einen Prüftermin, Standard drei Monate nach Merge, als Eintrag in `.github/wiedervorlagen.json` des Repos, das die Regel trägt (eine Wiedervorlage je Fälligkeitsmonat, `id` `regeln-verfall-<JJJJ-MM>`, fällig am Monatsersten, der Text listet die Regeln mit Quelle). Am Termin entscheidet die Evidenz: belegter Fund seit Einführung, die Regel bleibt ohne weiteren Termin und ist Bestand für den Status-Lauf (Punkt 8); kein Fund, sie wird Lockern-Kandidat (Punkt 3 (1)); gelockert wird erst mit Evidenz nach Punkt 2. Kein stilles Löschen, keine Rückwirkung auf den Bestand.
- **Verteilung:** die Wiedervorlage-Mechanik gehört zum Kern, `.github/wiedervorlagen.json` ist projekt-eigen und steht nicht in `.factory/besitz.json`; der Eintrag liegt damit neutral in dem Repo, das die Regel trägt.
- **Abschnitt 6 (Negativfall):** sein Wortlaut bleibt unverändert. Regeln zu Sicherheit, Fremdtext, Anonymität, internen Bezügen, Datenverlust, Irreversiblem und Außenwirkung sowie deny-/ask-Listen sind über (b1) nur mit Nachweis gleicher Garantie lockerbar und über (b2) nie. Ihr Verfallsdatum greift nie über Fundfreiheit; am Termin zählt nur, ob ein Ersatz mit gleicher Garantie existiert. Beim Härten dort ist ein belegter Schadensweg ein Fund.

## Verworfen

- **Automatisches Löschen am Termin:** stilles Aufweichen.
- **Wiedervorlage je Regel:** ein Kopf-Ticket je Regel; ein Bündel je Fälligkeitsmonat reicht.
- **Feste Status-Lauf-Zahl als Bedingung:** macht laute Prüfungen nie lockerbar.
- **Wächter-Test für „Härten ohne Fund“:** der Fundbegriff ist Ermessen; die Doku-Lens prüft.

## Folgen

- Kein Ledger-Eintrag: das ist eine Änderung am Verfahren, keine Lockerung einer Regel. Erste absehbare Anwendung: factory#275.
- Glossar und AGENTS.md (Kein Grün-durch-Aufweichen) nennen die Symmetrie und verweisen hierher.

## Re-Evaluierung

Prüftermin dieser Fortschreibung: Merge plus drei Monate. Lösen zwei Rückfall-Trigger einer über (b2) gelockerten Sache binnen drei Monaten aus, wird (b2) verschärft. Enden die ersten zwölf erreichten Prüftermine ohne Lockern-Kandidat oder ohne belegte Entscheidung „bleibt“, werden Frist und Hürde geprüft.
