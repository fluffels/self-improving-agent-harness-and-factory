# Fortschreibung #166 (2026-11-05): Ziel-Besitz der Factory-Seiten (F10)

Ergänzt [ADR 0022](../0022-dark-factory-kern-und-verteilung.md) (F10, Factory-Seiten und Herkunftsbezug) und beantwortet die offene Frage aus [factory#132](0022-132-anker-stubs.md) und [factory#167](0022-167-anker-stubs-im-sync.md); die Fortschreibung steht als Datei (siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)).

## Ausgangslage

Kern-Einheiten verlinken auf Factory-Seiten ohne Besitz-Einheit (`docs/referenz/anlaufstellen.md`, `docs/referenz/befehle.md`, `docs/ticket-reihenfolge.md` und andere). Im Bezieher deckt ein Anker-Stub diese Links: die Seite trägt die Überschrift und darunter einen Factory-Link auf `pfad#anker` am Sync-Tag ([factory#132](0022-132-anker-stubs.md)); fehlende Seiten legt der Sync an ([factory#167](0022-167-anker-stubs-im-sync.md)). Offen waren: werden die Seiten Besitz (welcher Ring), der Sync ergänzt keine Anker in vorhandenen Stubs, und eine Weiterleitung im Stub ([ADR 0031](../0031-fabrik-ohne-zugriff-auf-bezieher.md) Punkt 5).

## Optionen

- **A, ganze Seite als Besitz (Ring `kern`):** verworfen. Die Seiten mischen Projektwerte mit Kernwissen (nach der Fortschreibung zu ADR 0022 „kein Ring `kern` für gemischte Dateien“), Index-Seiten gehören je Projekt dem Projekt (`docs/erstbezug.md`), Besitz überschriebe auf den Projektanteil gekürzte Seiten (das Gegenteil des Vertrags aus factory#167), eine Projektzeile würde in `check:factorydrift` rot, und der Bezieher trüge ganze Seiten im Kontext.
- **B, Überschriften-Gerüst als Besitz-Block:** verworfen. Es bräuchte Marker in Quelle und Ziel; ein Block mit Abschnittstext wäre Option A im Kleinen, und jede gekürzte Projektseite brauchte einmalig einen Handschritt für die Marker.
- **C, Stub bleibt, Handschritt bei Anker-Änderungen:** verworfen als einzige Lösung. Jede umbenannte Überschrift bricht den Sync mit `anker-tot`, jeder neue Kern-Anker braucht Handarbeit, obwohl der Stub reine Sync-Ausgabe ist.
- **D, Stub bleibt, reine Stubs erneuert der Sync (gewählt).**

## Entscheidungen

- **Besitz oder Stub:** Stub. Die Seiten werden keine Besitz-Einheiten, kein Manifest-Eintrag, **kein Ring**. Stub-Ziele bleiben Projektdateien.
- **Anker-Pflege:** eine Seite, die ausschließlich aus Sync-Ausgabe besteht (reiner Stub), erneuert `factory-sync --tag` bei jedem Lauf aus dem Tag (`planeAnkerStubs` mit `reineStubs`, in `scripts/factory-links-lib.mjs`): umbenannte Überschriften, neue Kern-Anker und der Tag der Links stimmen danach ohne Handschritt. Ein erneuerter Stub ist abgeleitete Sync-Ausgabe wie der Link-Index (Ausnahme vom Besitz-Prinzip wie in factory#131). Hat ein reiner Stub keinen Kern-Link mehr, bleibt die Minimalform (erste Ebene-1-Überschrift und Hinweis).
- **Reiner Stub (strukturelle Erkennung, `istReinerStub`):** genau eine Hinweiszeile (`Anker-Stub: …`), sonst nur Überschriften und Kern-Zeilen (`Kern: [..](https://..)`), und auf jede Überschrift außer der ersten Ebene-1-Überschrift folgt eine Kern-Zeile; CRLF-neutral. Kein Neu-Render-Vergleich, damit auch ein Stub eines älteren Tags erkannt wird. Jede andere Zeile (Projektzeile, Absatz, zweiter Hinweis) macht die Seite zur Bezieher-Seite.
- **Nie überschreiben (AK3):** eine Bezieher-Seite, auch eine auf den Projektanteil gekürzte oder ein Stub mit einer Projektzeile, bleibt byte-gleich; einzige Änderung dort bleibt der Ref der Factory-Links, den der Link-Schritt je Tag setzt (factory#131). Symlinks, Ordner, Dateien des Sync-Plans und Einheiten des Stands sind nie Kandidat; `factoryLinks.ausnahmen` gilt weiter.
- **Weiterleitung:** keine. Reine Stubs brauchen sie nicht, die Zuordnung alt nach neu wäre ein neues gepflegtes Artefakt; in Bezieher-Seiten bleibt der laute `anker-tot`-Abbruch das Signal (ADR 0031 Punkt 5).
- **Form:** Fortschreibung zu ADR 0022 statt neuer ADR; Umsetzung im selben Ticket, sonst beschriebe die Doku nicht den Ist-Zustand.

## Folgen für Wächter und Sync

- `check:factorylinks` prüft unverändert (`stub-ziel`, `stub-anker`, `stub-link`); er meldet Bezieher-Seiten weiter samt Soll-Zeile als Handschritt. Der Code des Wächters ändert sich nicht.
- Sync: neue Ausgabezeile `geändert (Anker-Stub): <pfad>` und Hinweis `Anker-Stubs: <n> Seiten erneuert am Tag <tag>` (nur bei Änderung; ein zweiter Sync am selben Tag erneuert nichts). Die Erneuerung steht vor `planeFactoryLinks`; geschrieben wird im Zeilenende-Stil der Zieldatei. Reine Stubs der Version aus factory#167 erfüllen die Definition, eine Migration entfällt.

## Probe (Rohwerte, nur lesend, Scratchpad)

Quelle = Klon dieses Standes mit Tag `vProbe1`, leeres Ziel (`git init`, `.factory/projekt.json` aus dieser Config ohne `berechtigungen`/`sandbox`, `package.json` mit leeren Skripten, `AGENTS.md` mit leerem Kern-Block), danach in der Quelle die Überschrift `Am Ticket-Ende` in `docs/ticket-reihenfolge.md` zu `Am Ende des Tickets` umbenannt, der Kern-Link in `AGENTS.md` angepasst, Tag `vProbe2`.

- **Positiv:** `factory-sync --tag vProbe1`: Exit 0, 211 geändert. `--tag vProbe2`: Exit 0, 9 Zeilen `geändert (Anker-Stub)` (`agent-harness-faq`, `agent-harness`, `harness-glossar`, `model-routing`, `anlaufstellen`, `befehle`, `repo-landkarte`, `sicherheit-agenten`, `ticket-reihenfolge`), „9 Seiten erneuert“, „12 geändert, 199 unverändert“. `check-factory-links --wurzel`: Exit 0, „26 Factory-Links auf 9 Ziele am Sync-Tag und 36 Anker-Stubs ohne Befund“. `auditDocDrift`: `deadLinks` 0, `deadAnchors` 0. Heute (ohne diese Änderung) endet derselbe Lauf mit Exit 1 und `anker-tot`.
- **Negativ (AK3):** gleicher Ablauf, aber `docs/ticket-reihenfolge.md` trägt nach dem ersten Sync eine Projektzeile: `--tag vProbe2` Exit 1, `[anker-tot] …#am-ticket-ende`, „nichts geschrieben“, Hash des Ziel-Baums vorher und nachher `968a49129e47`.
- Die Zahlen der Probe aus factory#132 (6 rote Stubs, 3 bleiben) werden nicht neu gemessen (kein Zugriff auf Bezieher, [ADR 0031](../0031-fabrik-ohne-zugriff-auf-bezieher.md)).

## Bekannte Grenzen

- Ein reiner Stub, dessen Seite es am Tag nicht mehr gibt, bricht mit `pfad-tot` ab; Weg: die Seite im Bezieher löschen.
- Auf Bezieher-Seiten (mit Projektzeile oder auf den Projektanteil gekürzt) bleiben neue Kern-Anker und umbenannte Überschriften ein Handschritt; der Wächter nennt die Soll-Zeile.
- Ein Stub, den der Bezieher von Hand um eine Projektzeile, einen Absatz, eine zweite Ebene-1-Überschrift oder Text vor oder hinter einer Kern-Zeile ergänzt, ist keine Sync-Ausgabe mehr und wird nie wieder erneuert (gewollt: kein Datenverlust). Zwei Ergänzungen bleiben ein reiner Stub und gehen beim nächsten Sync verloren: eine von Hand ergänzte Überschrift samt nachfolgender `Kern:`-Zeile, auf die kein Kern-Link zeigt, und Text, der an die Hinweiszeile angehängt wird (geprüft wird nur ihr Anfang). Fällt dadurch ein Anker weg, auf den ein Projektlink zeigt, meldet ihn `check:docdrift`, nicht der Sync.

## Bezieher-Schritte

Die drei roten Stubs aus factory#132 (`docs/referenz/repo-landkarte.md` 1, `docs/referenz/anlaufstellen.md` 2) sind Projektseiten: einmalig je eine `Kern:`-Zeile mit der Soll-URL aus der Meldung von `check:factorylinks` ergänzen; danach stellt der Sync die Refs je Tag selbst um. Reine Stubs brauchen nichts.

## Re-Evaluierung

Wenn Bezieher je Sync wiederholt Handschritte auf denselben Projektseiten melden oder eine Factory-Seite projektfrei wird (dann wäre Besitz für diese Seite neu zu prüfen).
