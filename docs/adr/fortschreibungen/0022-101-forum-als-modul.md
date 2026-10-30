# Fortschreibung #101 (2026-10-30): Forum bleibt Modul

Ergänzt [ADR 0022](../0022-dark-factory-kern-und-verteilung.md) (F10); die Fortschreibung steht als Datei (siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)).

- **Entscheidung (Forum ist Modul, nicht Besitz):** Forum-Action, Forum-Skill und Quarantäne-Leser (`forum-leser`) stehen nicht im Besitz-Manifest; ein Projekt, das ein Forum führt, baut sie selbst und hält die Regeln des Kerns ein. Die Doku sagt dazu einheitlich „Modul: gilt für Projekte, die es führen; nicht im Besitz-Manifest“ statt „Stand im Factory-Repo: nicht portiert“, weil „nicht portiert“ einen offenen Rest nahelegte, der keiner ist.
- **`labels.forum` bleibt Pflicht:** das Label ist der Fremdeingang-Marker des Fremdtext-Gates (ein Issue mit diesem Label setzt kein Lauf automatisch um), nicht Teil des Moduls.
- **Prüfauftrag erledigt:** der Eintrag `forum` in `NOTFAELLE` (`scripts/board-lib.mjs`) nennt als `quelle` eine `forum-inbox.yml`, die hier nicht existiert; er bleibt unverändert, weil Tests und Board-Platzierung ihn als Marker kennen und er für Projekte mit Forum gilt.
