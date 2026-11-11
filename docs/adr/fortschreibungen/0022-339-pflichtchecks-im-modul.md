# Fortschreibung #339 (2026-11-11): Ein Sicherheits-Modul darf `pflichtChecks` tragen

Ergänzt [ADR 0022](../0022-dark-factory-kern-und-verteilung.md). Löst den Teil „nicht mit `pflichtChecks`“ der Entscheidung „Regeln am Feld“ aus der [Fortschreibung #119](0022-119-sicherheits-module.md) ab und erledigt deren Re-Evaluierung; die Fortschreibung steht als Datei (siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)).

- **Auslöser:** Dependency Review ist seit factory#335 Required Check. Als Moduleinheit durfte `dependency-review.yml` kein `pflichtChecks` tragen, der Doctor meldete einem Bezieher mit gewähltem Modul also nicht, wenn sein Ruleset den Check nicht nannte (Folgerung aus der [Fortschreibung #335](0009-335-sicherheits-checks-merge-pflicht.md)).
- **Entscheidung:** `modulFehler` lässt `pflichtChecks` an einer Moduleinheit zu. Der Doctor verlangt den Check nur, wenn die Workflow-Datei im Repo liegt (`kernPflichtChecks` filtert nach vorhandener Datei, unverändert): ein abgewähltes Modul (Datei fehlt) erzeugt keine Forderung. `dependency-review.yml` trägt `pflichtChecks: ["Abhängigkeiten prüfen (Dependency Review)"]`.
- **Bezieher-Folge:** Ein Bezieher mit gewähltem Modul `dependency-review` und ohne die Zeile im Ruleset sieht nach dem Sync eine Doctor-Lücke. Das ist gewollt; die Fabrik schreibt nicht in Bezieher (ADR 0031).
- **Verworfen:** eine eigene Modul-Pflichtcheck-Liste neben `pflichtChecks`, weil `kernPflichtChecks` die Bedingung „Datei im Repo“ schon kennt.
