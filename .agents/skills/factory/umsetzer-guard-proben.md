# Umsetzer: Guard-Proben (Negativtest, Red-Green)

Bedingte Datei des Umsetzers (Kern: `.claude/agents/factory-umsetzer.md`): lies sie, sobald dein Diff Guard- oder Gate-Code, eine neue Regex oder einen neuen Test enthält oder `node scripts/anker-liste.mjs` mindestens einen Anker nennt.

**Negativtest und Red-Green (Schritt 2):** Jede neue Regel in Guard- oder Gate-Code bekommt vor dem Review ihren eigenen Negativtest, der genau diese Regel verfälscht. Jeder neue Test bekommt seine Red-Green-Probe nach AGENTS.md § Tests gegen False Positives absichern: den Anker vorher auf genau einen Treffer zählen, die geprüfte Eigenschaft testweise brechen, Rot sehen, zurücksetzen. Ein Rot zählt nur, wenn der Test genau an dieser Eigenschaft scheitert (ein Test, der „im selben Takt“ behauptet, ist vakuös, wenn `exec` den Takt selbst hochzählt). Mehrere Guards sabotierst du nach dem Zwischen-Commit per Scratchpad-Skript (Anker zählen, ersetzen, Test fahren, in `finally` zurückschreiben), nie per `git checkout`.

**Vollsweep:** den Vollsweep je Regex (jede Komponente beidseitig sabotiert) fährt die Test-Lens in Runde 1 selbst (`.agents/skills/review-lenses/brille-test-adaequanz.md`); dein Anteil sind Negativtest und Red-Green je neue Regel.

**Zahl in einer Regel:** Eine Zahl in einer Regel als Konstante ableiten und die Konsumenten per Grep prüfen.
