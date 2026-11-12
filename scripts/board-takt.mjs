#!/usr/bin/env node
// Kein weiterer Shebang-Zwang: wird vom Workflow gestartet UND von test/board-takt.test.ts importiert.
/**
 * Generischer Board-Takt (#1390, ursprünglich #1351/#1349): der Workflow `.github/workflows/board-takt.yml` ruft dieses Skript. Es pflegt
 *  1. das Status-Ticket „Langfuse-Status überprüfen“ (Entscheidung und Anlegen: scripts/langfuse-takt.mjs, ADR 0016) und
 *  2. das ungeclaimte Harness-Sammelticket „Harness-Härtung (gesammelt)“: ab `HARNESS_TAKT_KOMMENTARE` offenen Befund-Zeilen (Härtungs-Takt, Füllstand) an die Spitze des
 *     Boards holen (nur hinter 🚨/🔒-Notfällen, vor das Status-Ticket); unter der Schwelle schiebt der Takt nichts.
 *  3. das ungeclaimte Langfuse-Sammelticket „Langfuse-Befunde (gesammelt)“ (factory#379): ab `LANGFUSE_TAKT_KOMMENTARE` offener Befund-Zeile auf die erste Position hinter dem Kopf (Notfälle, Harness-Sammelticket, Status-Ticket), auf dem Board des Status-Tickets (`langfuseZiel`); zuletzt im Lauf.
 * Mit dem Config-Schlüssel `langfuseWochenbericht` (factory#314) legt der Takt das Status-Ticket nur bei einem Anlass an (`LANGFUSE_ANLASS` aus dem Dispatch-Input `langfuse_anlass`) oder nach
 * `wochenOhneLaufMax` Wochen ohne Status-Ticket am Montags-Cron; ohne den Schlüssel bleibt alles wie bisher (Entscheidung: scripts/langfuse-takt.mjs).
 * Im Bezieher (Sync-Stand vorhanden), dessen Factory-Board das Repo der Fabrik führt, legt der Takt nur das Status-Ticket im eigenen Repo an (`bezieherTakt`, factory#195); das Harness-Sammelticket pflegt dort die Fabrik. Das Langfuse-Sammelticket des Beziehers holt der Takt dort selbst; bei fremd geführtem Factory-Board entfällt der Schritt.
 * Die Entscheidungen sind pur und getestet (test/board-takt.test.ts, test/langfuse-takt.test.ts), nur die gh-Aufrufe in `main` sind es nicht.
 *
 * Idempotent und ohne gespeicherten Zähler: jedes Mal wird aus den offenen Issues, der Commit-Liste von main und der Board-Liste
 * abgeleitet, was zu tun ist. Zwei Läufe hintereinander (der Workflow serialisiert sie über seine Concurrency-Group) legen darum nie
 * zwei Tickets an und lassen die Position nicht springen. Die Board-Liste wird je Lauf EINMAL geladen und nach der Status-Aktion im
 * Speicher nachgezogen.
 *
 * Nur Node-Builtins, analog zu board-lib.mjs. `--dry-run` zeigt die Entscheidungen, ändert nichts. Exit 0 grün, 1 Fehler, 2 Aufruf-Fehler (vor jedem I/O).
 */
import { execFileSync } from "node:child_process";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { mitKontingent } from "./kontingent-lib.mjs";
import { fehlerMeldung, fehlerText, schreibrechtText } from "./gh-cli.mjs";
import { labelAus, ladeProjektConfig, langfuseZiel, zielRepoFuer } from "./projekt-config-lib.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";
import { gleichesRepo } from "./repo-form.mjs";
import {
  LANGFUSE_SAMMELTICKET_TITEL,
  REPO,
  SAMMELTICKET_TITEL,
  STATUS_TITEL,
  TAG_MS,
  addToBoardTodo,
  boardFuerRolle,
  boardRolleFuer,
  istKopfItem,
  alsDatum,
  frischeOffeneIssues,
  ghJson,
  itemsUeberIssues,
  kandidatenSammelticket,
  spitzenEnde,
  loadItems,
  loadOpenIssuePages,
  missingFromBoard,
  normalizeOffene,
  sammelticketItem,
  seitenListen,
  setPosition,
  todoItem,
  ungeclaimt,
  verschiebe,
  wirklichFehlend,
} from "./board-lib.mjs";

import { aufnahmePlan } from "./board-plan-lib.mjs";
import { issueKommentare } from "./fremdtext-lib.mjs";
import { WURZEL, bestaetigeAnlegen, entscheideTakt, fuehreStatusAus, statusSucheAnfrage, vorgaengerAusSuche, wochenberichtAus } from "./langfuse-takt.mjs";
import { HARNESS_TAKT_KOMMENTARE, PRODUKT_QUOTE, befundKommentare, fuellstandVon, harnessIssuesAnfrage, holeQuotenCommits, istHarnessCommit, quotenCommitLeser, quotenQuellen, sammelStand, zaehleTicketMerges } from "./produktquote-lib.mjs";

// Die Quote liegt in produktquote-lib.mjs (auch factory-kennzahlen.mjs braucht sie); die API dieses Skripts bleibt stabil.
export { HARNESS_TAKT_KOMMENTARE, PRODUKT_QUOTE, befundKommentare, istHarnessCommit, zaehleTicketMerges };

// Zwei Boards (ADR 0022 F11, #1729): Status-Ticket und Harness-Sammelticket laufen auf dem Factory-Board; der Wächter
// nimmt fehlende Issues nach der Trennregel (`boardRolleFuer`) auf ihrem Board auf.
const FACTORY_BOARD = boardFuerRolle("factory");

/**
 * Beginn des Aktivitätsfensters: 60 s nach `letzterAbschluss` (beim Status-Ticket das Anlegen des jüngsten Tickets, beim
 * Harness-Sammelticket der Abschluss des letzten; deren eigener Squash-Commit soll nicht zählen), ohne Wert 7 Tage vor `jetzt`.
 */
export function mergeFensterAb(letzterAbschluss, jetzt) {
  const j = alsDatum(jetzt, "jetzt");
  if (letzterAbschluss === null || letzterAbschluss === undefined) return new Date(j.getTime() - 7 * TAG_MS);
  return new Date(alsDatum(letzterAbschluss, "letzterAbschluss").getTime() + 60_000);
}

/** Produkt-Merges in einer Commit-Liste: Ticket-Merges (`zaehleTicketMerges`) ohne Harness-Commits (`istHarnessCommit`); mit `seit` nur ab diesem Zeitpunkt. Pur. */
export function zaehleProduktMerges(commits, seit = null, harnessIssues = null) {
  if (!Array.isArray(commits)) throw new Error("commits muss eine Liste sein.");
  return zaehleTicketMerges(commits.filter((c) => !istHarnessCommit(c, harnessIssues)), seit);
}

/**
 * Die Produktquote des Fensters als Zahlen und Zeile für das Protokoll: `harness` und `produkt` = Ticket-Merges (ohne Bots) mit bzw. ohne
 * Harness-Zuordnung (`istHarnessCommit`), `eingehalten` = höchstens 1 Harness auf `PRODUKT_QUOTE` Produkt-Merges (Notfälle und Security gelten als Harness, sofern ihr Issue das Harness-Label der Config trägt, und
 * zählen hier mit; das Protokoll ist Information, kein Gate). Pur.
 */
export function quotenBericht(commits, seit = null, harnessIssues = null) {
  const harness = zaehleTicketMerges(commits.filter((c) => istHarnessCommit(c, harnessIssues)), seit);
  const produkt = zaehleProduktMerges(commits, seit, harnessIssues);
  const eingehalten = harness * PRODUKT_QUOTE <= produkt;
  return { harness, produkt, eingehalten, zeile: `Produktquote: ${harness} Harness- auf ${produkt} Produkt-Merges im Fenster (Soll höchstens 1:${PRODUKT_QUOTE}), ${eingehalten ? "eingehalten" : "überschritten"}` };
}

/**
 * Harness-Sammelticket: `items` = Board in Reihenfolge (board-lib), `befundKommentare` = Füllstand des ungeclaimten Sammeltickets
 * (`befundKommentare`: offene Zeilen in Kommentaren vertrauter Nicht-Bot-Autoren). Eine Regel (factory#162): ab `HARNESS_TAKT_KOMMENTARE` kommt das erste
 * ungeclaimte Harness-Sammelticket an die Spitze des Boards, nur hinter den zusammenhängenden Notfall-Items ganz oben (🚨/🔒, `spitzenEnde`),
 * vor das Status-Ticket und alle übrigen Kopf-Items → `nach-oben`. Steht es dort schon, ist der Lauf idempotent. Ist ein Vorgänger
 * (offenes Sammelticket mit Assignee) in Arbeit, entfällt die Regel. Unter der Schwelle schiebt der Takt nie zurück: „still liegen“ leistet die
 * Auswahl (`naechstes-ticket`), die Anlage setzt es auf Position laut AGENTS.md (`sammelticket-anlegen`).
 * Liefert `{ aktion: "nach-oben" | "nichts", nr?, afterId?, grund }`. Ungültige Eingaben werfen. Pur.
 */
export function entscheideHarnessTakt({ items, befundKommentare: fuellstand }) {
  return entscheideSammelTakt(SAMMEL_ARTEN.harness, items, fuellstand);
}

/** Schwelle des Langfuse-Takts (factory#379): ab einer offenen Befund-Zeile holt der Takt das ungeclaimte Langfuse-Sammelticket hinter den Kopf. */
export const LANGFUSE_TAKT_KOMMENTARE = 1;

/**
 * Langfuse-Sammelticket (factory#379): verallgemeinert aus `entscheideHarnessTakt`, mit `fuellstand` = offene Befund-Zeilen des ungeclaimten Tickets. Ab `LANGFUSE_TAKT_KOMMENTARE`
 * kommt es auf die erste Position hinter dem Kopf: Notfälle und Status-Ticket (`istKopfItem`) sowie ein offenes Harness-Sammelticket an der Spitze zählen zum Kopf.
 * Steht es dort (geschlossene Items dazwischen stören nicht), ist der Lauf idempotent; ein offenes Langfuse-Sammelticket mit Assignee (Vorgänger in Arbeit) hält den Takt an.
 * Liefert `{ aktion: "verschieben" | "nichts", nr?, afterId?, grund }`. Pur.
 */
export function langfuseSammelEntscheidung(items, fuellstand) {
  return entscheideSammelTakt(SAMMEL_ARTEN.langfuse, items, fuellstand);
}

/** Ende des Kopfs für das Langfuse-Sammelticket: Index hinter den offenen Kopf-Items und dem offenen Harness-Sammelticket an der Spitze. Pur. */
function langfuseEnde(items) {
  let ende = 0;
  for (const [k, i] of items.entries()) {
    if (i.state !== "open") continue;
    if (!istKopfItem(i) && i.title !== SAMMELTICKET_TITEL) break;
    ende = k + 1;
  }
  return ende;
}

/**
 * Die Sammelticket-Arten des Takts (eine Entscheidungs- und eine Ausführungsfunktion für alle): `titel` des Sammeltickets, `schwelle` offener Befund-Zeilen, `ende(items)` = Index der Zielposition
 * (davor steht der Kopf), `aktion` (`nach-oben` | `verschieben`), `feld` = Name des Füllstand-Parameters in der Fehlermeldung, `name` für den Logtext der Ausführung und die Texte `zuWenig(fuellstand)`,
 * `steht(nr)`, `kommt(fuellstand, nr)` des Grunds. Ein drittes Sammelticket im Takt ist ein weiterer Eintrag, keine weitere Kopie.
 */
export const SAMMEL_ARTEN = {
  harness: {
    titel: SAMMELTICKET_TITEL,
    schwelle: HARNESS_TAKT_KOMMENTARE,
    ende: spitzenEnde,
    aktion: "nach-oben",
    feld: "befundKommentare",
    name: "Sammelticket",
    zuWenig: (f) => `Füllstand ${f}/${HARNESS_TAKT_KOMMENTARE} offene Befund-Zeilen (Schwelle ${HARNESS_TAKT_KOMMENTARE}), der Takt lässt es liegen`,
    steht: (nr) => `#${nr} steht schon an der Spitze (hinter den Notfall-Items)`,
    kommt: (f, nr) => `Füllstand ${f}/${HARNESS_TAKT_KOMMENTARE} offene Befund-Zeilen, #${nr} kommt an die Spitze`,
  },
  langfuse: {
    titel: LANGFUSE_SAMMELTICKET_TITEL,
    schwelle: LANGFUSE_TAKT_KOMMENTARE,
    ende: langfuseEnde,
    aktion: "verschieben",
    feld: "fuellstand",
    name: "Langfuse-Sammelticket",
    zuWenig: (f) => `Füllstand ${f}/${LANGFUSE_TAKT_KOMMENTARE} offene Befund-Zeilen, der Takt lässt es liegen`,
    steht: (nr) => `#${nr} steht schon hinter dem Kopf`,
    kommt: (f, nr) => `Füllstand ${f}/${LANGFUSE_TAKT_KOMMENTARE} offene Befund-Zeilen, #${nr} kommt hinter den Kopf`,
  },
};

/**
 * Die Entscheidung einer Sammelticket-Art (`art`, siehe `SAMMEL_ARTEN`): ohne ungeclaimtes Sammelticket, unter der Schwelle, mit einem Vorgänger in Arbeit (offenes Sammelticket mit Assignee)
 * oder wenn es schon hinter `art.ende(items)` steht (geschlossene Items dazwischen stören nicht) → `nichts`, sonst `art.aktion` mit `afterId` = Item vor der Zielposition. Ungültige Eingaben werfen. Pur.
 * Liefert `{ aktion, nr?, afterId?, grund }`.
 */
export function entscheideSammelTakt(art, items, fuellstand) {
  if (!Array.isArray(items)) throw new Error("items muss eine Liste sein.");
  if (!Number.isInteger(fuellstand) || fuellstand < 0) throw new Error(`${art.feld} muss eine ganze Zahl ≥ 0 sein, war ${String(fuellstand)}`);
  const offen = items.filter((i) => i.state === "open" && i.title === art.titel);
  const ticket = offen.find(ungeclaimt);
  if (!ticket) return { aktion: "nichts", grund: `kein ungeclaimtes „${art.titel}“` };
  if (fuellstand < art.schwelle) return { aktion: "nichts", grund: art.zuWenig(fuellstand) };
  const vorgaenger = offen.find((i) => !ungeclaimt(i));
  if (vorgaenger) return { aktion: "nichts", grund: `Vorgänger #${vorgaenger.number} in Arbeit, der Takt wartet auf dessen Abschluss` };
  const ende = art.ende(items);
  const idx = items.findIndex((i) => i.id === ticket.id);
  if (items.slice(ende, idx).every((i) => i.state !== "open")) return { aktion: "nichts", grund: art.steht(ticket.number) };
  return { aktion: art.aktion, nr: ticket.number, afterId: ende > 0 ? items[ende - 1].id : null, grund: art.kommt(fuellstand, ticket.number) };
}

/** Die Factory-Liste ohne Items, die auch auf dem Produkt-Board stehen und laut Trennregel dorthin gehören (`doppelt` aus `seitenListen`). Pur. */
export const factoryListe = (factory, doppelt, config) => factory.filter((i) => !(doppelt.includes(i.number) && boardRolleFuer(i.labels ?? [], config, { repo: i.repo }) !== "factory"));

/**
 * Zieht die im Speicher gehaltene Board-Liste nach einer Status-Aktion nach (statt sie neu zu laden): `ergebnis` = `{ nr, itemId }` aus
 * `fuehreStatusAus` bzw. null/ohne `itemId` (nichts bewegt). Das Status-Item steht danach an der Spitze, ein noch nicht gelistetes
 * (frisch angelegt, die REST-Liste liefert es verzögert) wird vorn ergänzt. Pur.
 */
export function ziehListeNach(items, ergebnis) {
  if (!ergebnis?.itemId) return items;
  const vorhanden = items.find((i) => i.id === ergebnis.itemId || i.number === ergebnis.nr);
  if (vorhanden) return verschiebe(items, vorhanden.id, null);
  return [todoItem({ id: ergebnis.itemId, number: ergebnis.nr, title: STATUS_TITEL }), ...items];
}

// ── gh-Anbindung (nur CLI, nicht Teil der getesteten Logik) ─────────────────

/**
 * Darf der Harness-Teil des Takts laufen? Er braucht die Board-Liste (Projekt-Scope des Tokens). Fehlt sie, entfällt NUR dieser Teil
 * (das Status-Ticket braucht sie nicht) und das wird als Warnung gemeldet (Exit 0, der Lauf ohne Token ist bekannt).
 * Liefert `{ ok: true }` oder `{ ok: false, meldung, fehler }`. Pur.
 */
export function harnessVoraussetzung({ items }) {
  if (!items) return { ok: false, fehler: false, meldung: "::warning::PROJECT_TOKEN fehlt: Harness-Sammelticket-Takt übersprungen (die Board-Liste braucht den Projekt-Scope)." };
  return { ok: true };
}

/**
 * Die Harness-Entscheidung mit Füllstand (Härtungs-Takt): lädt die Kommentare NUR für das ungeclaimte Sammelticket (`sammelticketItem`), zählt die
 * offenen Befund-Zeilen in Kommentaren vertrauter Nicht-Bot-Autoren (`befundKommentare`) und fragt `entscheideHarnessTakt`. Fail-closed: lässt sich der Füllstand
 * nicht laden, steht eine `::warning::` im Log und die Aktion ist `nichts` (der Lauf bleibt grün, der nächste versucht es erneut). Fehlt das
 * ungeclaimte Sammelticket in `items`, steht aber offen und ungeclaimt in `offene`, ist die Board-Liste im Verzug: Warnung statt stillem „keins“.
 * Liefert `{ ...Entscheidung, fuellstand }` (`fuellstand` null, wenn nicht geladen). `io.ladeKommentare(nr, repo)` liefert die flache Kommentar-Liste.
 */
export function entscheideMitFuellstand({ items, offene, repo, io }) {
  const kandidat = sammelticketItem(items);
  if (!kandidat) {
    const [offenes] = kandidatenSammelticket(offene, SAMMELTICKET_TITEL);
    if (offenes) io.log(`::warning::Board-Verzug: #${offenes.number} fehlt in der Board-Liste (REST hinkt oder Item fehlt), der Härtungs-Takt sieht das Sammelticket nicht.`);
    return { ...entscheideHarnessTakt({ items, befundKommentare: 0 }), fuellstand: null };
  }
  const r = fuellstandVon({ nr: kandidat.number, repo, ladeKommentare: io.ladeKommentare });
  if (r.fehler !== undefined) {
    io.log(`::warning::Härtungs-Takt: Füllstand von #${kandidat.number} nicht ladbar, keine Bewegung (fail-closed): ${r.fehler}`);
    return { aktion: "nichts", grund: `Füllstand von #${kandidat.number} nicht prüfbar`, fuellstand: null };
  }
  const fuellstand = r.wert;
  return { ...entscheideHarnessTakt({ items, befundKommentare: fuellstand }), fuellstand };
}

/** Entscheidung einer Sammelticket-Art ausführen (Position auf dem Board der Rolle `rolle`); true bei Erfolg. `setze` und `log` sind für den Test injizierbar. */
export function fuehreSammelAus(art, e, items, token, rolle, { setze = (id, afterId, opts) => setPosition(boardFuerRolle(rolle), id, afterId, opts), log = console.log } = {}) {
  try {
    setze(items.find((i) => i.number === e.nr).id, e.afterId, { token });
    log(`${art.name}-Position gesetzt.`);
    return true;
  } catch (err) {
    log(fehlerMeldung(err, { praefix: `${art.name}-Position nicht gesetzt: `, zusatz: "Die Wiederholung ist idempotent." }));
    return false;
  }
}

/** Harness-Entscheidung ausführen (Factory-Board); true bei Erfolg. `setze` und `log` sind für den Test injizierbar. */
export function fuehreHarnessAus(h, items, token, { setze = (id, afterId, opts) => setPosition(FACTORY_BOARD, id, afterId, opts), log = console.log } = {}) {
  return fuehreSammelAus(SAMMEL_ARTEN.harness, h, items, token, "factory", { setze, log });
}

/** Verschieben-Entscheidung des Langfuse-Takts ausführen (Position auf dem Board der Rolle `rolle`); true bei Erfolg. `setze` und `log` sind für den Test injizierbar. */
export function fuehreLangfuseAus(l, items, token, rolle, o = {}) {
  return fuehreSammelAus(SAMMEL_ARTEN.langfuse, l, items, token, rolle, o);
}

/**
 * Langfuse-Sammelticket-Teil des Takts (factory#379): Füllstand nur für das ungeclaimte Langfuse-Sammelticket laden (`fuellstandVon`), `langfuseSammelEntscheidung`,
 * ausführen und die Liste nachziehen. Fail-closed: nicht ladbar ⇒ Warnung, keine Bewegung. Ohne Board-Liste (`items` null) oder Ticket entfällt der Schritt.
 * `rolle` = Board des Status-Tickets (`langfuseZiel`). Liefert `{ fehler, items }`.
 */
function langfuseSchritt({ items, repo, io, dry, token, rolle }) {
  if (!items) return { fehler: false, items };
  const kandidat = items.find((i) => i.state === "open" && i.title === LANGFUSE_SAMMELTICKET_TITEL && ungeclaimt(i));
  if (!kandidat) return { fehler: false, items };
  const r = fuellstandVon({ nr: kandidat.number, repo, ladeKommentare: io.ladeKommentare });
  if (r.fehler !== undefined) {
    io.log(`::warning::Langfuse-Takt: Füllstand von #${kandidat.number} nicht ladbar, keine Bewegung (fail-closed): ${r.fehler}`);
    return { fehler: false, items };
  }
  const l = langfuseSammelEntscheidung(items, r.wert);
  io.log(`Langfuse-Sammelticket: ${l.aktion}${l.nr ? ` #${l.nr}` : ""} (${l.grund})`);
  if (dry || l.aktion === "nichts") return { fehler: false, items };
  if (!io.fuehreLangfuseAus(l, items, token, rolle)) return { fehler: true, items };
  return { fehler: false, items: verschiebe(items, kandidat.id, l.afterId) };
}

/**
 * Board-Wächter (#1628, zwei Boards #1729): offene Issues ohne Board-Item auf IRGENDEINEM Board (ein still gescheitertes Einsortieren, z.B.
 * #1608 stand einen Tag nicht im Board) nimmt der Takt als Todo am Ende des Boards laut Trennregel auf (`aufnahmePlan`: `rolle`). Die REST-Liste liefert frische Items verzögert: jeder Kandidat wird per GraphQL
 * per Zweitabfrage gegengeprüft (`wirklichFehlend`); ohne Kandidaten entfällt die Abfrage. Jede Aufnahme steht als `::warning::` mit Nummer im Log, jeder
 * Fehler setzt `fehler` (Lauf rot). `dry`: nur Meldung. `listen` = `{ produkt, factory }`; liefert `{ listen, fehler }` (die Liste der Zielseite um die aufgenommenen Todos ergänzt).
 */
export function nimmFehlendeAuf({ offene, listen, token, dry = false, repo = REPO, config }, io) {
  const kandidaten = missingFromBoard(offene.map((i) => i.number), [...listen.produkt, ...listen.factory]);
  if (kandidaten.length === 0) return { listen, fehler: false };
  let fehlend;
  try {
    fehlend = wirklichFehlend(kandidaten, [...io.itemsUeberIssues("produkt", kandidaten, { token, repo }), ...io.itemsUeberIssues("factory", kandidaten, { token, repo })]);
  } catch (err) {
    io.log(fehlerMeldung(err, { praefix: "Board-Wächter: GraphQL-Zweitabfrage fehlgeschlagen: " }));
    return { listen, fehler: true };
  }
  let neu = listen;
  let fehler = false;
  const alleAbgelehnt = [];
  for (const nr of fehlend) {
    try {
      const { aufnehmen, abgelehnt } = aufnahmePlan([nr], { [nr]: io.ghJson(["api", `repos/${repo}/issues/${nr}`]) }, { config, repo });
      alleAbgelehnt.push(...abgelehnt);
      for (const a of aufnehmen) {
        if (dry) {
          io.log(`Board-Wächter: #${a.number} fehlt im Board, würde als Todo aufgenommen (--dry-run).`);
          continue;
        }
        const id = io.addToBoardTodo(a.rolle, a.nodeId, { token, repo });
        io.log(`::warning::Board-Wächter: #${a.number} fehlte im Board, als Todo auf dem ${a.rolle}-Board aufgenommen.`);
        neu = { ...neu, [a.rolle]: [...neu[a.rolle], todoItem({ id, number: a.number, title: a.title })] };
      }
    } catch (err) {
      fehler = true;
      io.log(fehlerMeldung(err, { praefix: `Board-Wächter: #${nr} nicht aufgenommen: ` }));
    }
  }
  meldeAbgelehnte(alleAbgelehnt, io.log);
  return { listen: neu, fehler };
}

/** Eine Warnung je Ablehnungsgrund (#78): ein Issue mit Nummer wie bisher, mehrere zusammen mit Anzahl und Nummern statt je Issue bei jedem Takt. */
function meldeAbgelehnte(abgelehnt, log) {
  const nachGrund = Map.groupBy(abgelehnt, (a) => a.grund);
  for (const [grund, liste] of nachGrund) {
    log(liste.length === 1
      ? `::warning::Board-Wächter: #${liste[0].number} fehlt im Board, nicht aufgenommen: ${grund}.`
      : `::warning::Board-Wächter: ${liste.length} Issues fehlen im Board, nicht aufgenommen (${liste.map((a) => `#${a.number}`).join(", ")}): ${grund}.`);
  }
}

/**
 * Beginn des Zählfensters des Status-Tickets (#1628): das Anlegen des jüngsten Status-Tickets (offen oder geschlossen, `vorgaenger` = `{ createdAt, closedAt }` oder null),
 * ohne Ticket sein Abschluss; als ISO-String (`mergeFensterAb`). Pur.
 */
function statusFensterAb({ vorgaenger, offene, jetzt }) {
  const angelegt = [vorgaenger?.createdAt, ...offene.filter((i) => i.titel === STATUS_TITEL).map((i) => i.createdAt)]
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => !Number.isNaN(t));
  const fensterStart = angelegt.length > 0 ? new Date(Math.max(...angelegt)) : (vorgaenger?.closedAt ?? null);
  return mergeFensterAb(fensterStart, jetzt).toISOString();
}

/**
 * Der Status-Schritt des Takts (beide Wege): entscheiden, vor dem Anlegen per Zweitabfrage bestätigen (die REST-Liste hinkt bei frischen Tickets nach, fail-closed, #1866), ausführen und die
 * Board-Liste nachziehen. `label` = Label der Zweitabfrage (`null`: ohne Label), `ziel` (nur im Bezieher, factory#195) = `langfuseZiel` für Board und Label beim Anlegen. Liefert `{ fehler, items }`.
 */
function statusSchritt({ offene, commits, abStatus, vorgaenger, ausloeser, jetzt, repo, label, token, dry, config, io, items, ziel, anlass }) {
  const stundenSeitAbschluss = vorgaenger ? (jetzt.getTime() - new Date(vorgaenger.closedAt).getTime()) / (TAG_MS / 24) : null;
  const imFenster = commits.filter((c) => new Date(c?.commit?.committer?.date ?? 0).getTime() >= new Date(abStatus).getTime());
  const vorEntscheidung = entscheideTakt({ offene, mergesSeit: imFenster.length, ticketMerges: zaehleTicketMerges(commits, abStatus), ausloeser, stundenSeitAbschluss, jetzt, anlass, wochenbericht: wochenberichtAus(config) });
  const e = bestaetigeAnlegen(vorEntscheidung, { zweit: () => io.frischeOffeneIssues({ repo, label, anzahl: 50, mitBoard: false }) });
  for (const w of e.warnungen) io.log(`::warning::${w}`);
  io.log(`Status-Ticket (${ausloeser}): ${e.aktion}${e.nr ? ` #${e.nr}` : ""} (${e.grund}); Fenster ab ${abStatus}`);
  if (dry || e.aktion === "nichts") return { fehler: false, items };
  const r = io.fuehreStatusAus(e, { repo, vorgaenger, jetzt, token, items: items ?? [], config, start: io.ersterCommitDatum?.() ?? null, ...(ziel ? { ziel } : {}) });
  return { fehler: !r.ok, items: items ? ziehListeNach(items, r) : items };
}

/**
 * Der Vorgänger des Status-Tickets aus der Titelsuche (factory#195; im Bezieher fehlt das Harness-Label, nach dem die Liste der geschlossenen Issues sonst filtert).
 * Fail-closed: widersprechen sich Suche und offene Liste oder scheitert die Suche, ist `unklar` gesetzt (Text) und der Status-Schritt entfällt. Liefert `{ vorgaenger }` oder `{ unklar }`.
 */
function sucheVorgaenger({ repo, offene, io }) {
  try {
    const r = vorgaengerAusSuche({ antwort: io.ghJson(statusSucheAnfrage(repo)), offene });
    return r.unklar.length > 0
      ? { unklar: `Suche und offene Liste widersprechen sich (${r.unklar.map((n) => `#${n}`).join(", ")}: Suchindex oder Liste hinkt)` }
      : { vorgaenger: r.vorgaenger };
  } catch (e) {
    return { unklar: `Suche nach früheren Status-Tickets fehlgeschlagen: ${schreibrechtText(e, repo, "lesen") ?? fehlerText(e)}` };
  }
}

/**
 * Takt im Bezieher (factory#195, ADR 0031 Punkt 4): das Factory-Board führt das Repo der Fabrik. Status-Ticket (Board und Label laut `langfuseZiel`) und Board-Wächter laufen im eigenen Repo;
 * Harness-Sammelticket und Quotenzeile pflegt der Takt der Fabrik. Gezählt werden nur die Commits von main des eigenen Repos. Liefert `{ fehler }`.
 */
function bezieherTakt({ repo, jetzt, dry, token, config, io, ausloeser, fuehrt, anlass }) {
  let ziel;
  try {
    ziel = langfuseZiel(config, { bezieher: true });
  } catch (e) {
    io.log(`::warning::${fehlerText(e)}`);
    return nurWaechter({ repo, dry, token, config, io, fuehrt });
  }
  io.log(`Bezieher: Status-Ticket auf dem ${ziel.rolle}-Board von ${repo}; Harness-Sammelticket und Quote pflegt ${fuehrt}`);
  const gelesen = leseOffene(io, repo);
  if (gelesen.fehler) return { fehler: true };
  const { offene } = gelesen;
  const roh = token ? { produkt: io.loadItems("produkt", { token, repo }), factory: io.loadItems("factory", { token, repo }) } : null;
  let fehler = false;
  let items = roh ? roh[ziel.rolle] : null;
  const suche = sucheVorgaenger({ repo, offene, io });
  if (suche.unklar) io.log(`::warning::Status-Ticket ausgelassen (fail-closed): ${suche.unklar}`);
  else {
    const abStatus = statusFensterAb({ vorgaenger: suche.vorgaenger, offene, jetzt });
    const commits = holeQuotenCommits({ quellen: [{ repo, rolle: null }], lies: quotenCommitLeser({ gh: io.ghJson, repo, since: abStatus, env: io.env }) });
    const r = statusSchritt({ offene, commits, abStatus, vorgaenger: suche.vorgaenger, ausloeser, jetzt, repo, label: ziel.label, token, dry, config, io, items, ziel, anlass });
    ({ items } = r);
    fehler = r.fehler;
  }
  if (!roh) return { fehler };
  const w = nimmFehlendeAuf({ offene, listen: { ...roh, [ziel.rolle]: items }, token, dry, repo, config }, io);
  const lf = langfuseSchritt({ items: w.listen[ziel.rolle], repo, io, dry, token, rolle: ziel.rolle });
  return { fehler: w.fehler || lf.fehler || fehler };
}

/**
 * Fremdes Factory-Board (#76, ADR 0022 F10): führt das Factory-Board der Config die Issues eines anderen Repos als `repo`, pflegt der Takt dort
 * Status- und Sammelticket. Hier läuft nur der Board-Wächter; Status-Ticket, Harness-Sammelticket und Quotenzeile entfallen. Liefert `{ fehler }`.
 */
function nurWaechter({ repo, dry, token, config, io, fuehrt }) {
  io.log(`Factory-Teil übersprungen: Factory-Board führt ${fuehrt}, der Takt dort pflegt Status- und Sammelticket`);
  if (!token) return { fehler: false };
  const listen = { produkt: io.loadItems("produkt", { token, repo }), factory: io.loadItems("factory", { token, repo }) };
  const gelesen = leseOffene(io, repo);
  if (gelesen.fehler) return { fehler: true };
  return { fehler: nimmFehlendeAuf({ offene: gelesen.offene, listen, token, dry, repo, config }, io).fehler };
}

/**
 * Die offenen Issues des Repos `repo` (#97): ein Lesefehler (etwa ein Fremd-Repo ohne Lesezugriff des Tokens) wird als Zeile mit dem Weg zur Abhilfe
 * gemeldet (`schreibrechtText`, sonst der Fehlertext), nicht als Absturz. Liefert `{ offene }` oder `{ fehler: true }`.
 */
function leseOffene(io, repo) {
  try {
    return { offene: normalizeOffene(io.loadOpenIssuePages(repo)) };
  } catch (e) {
    io.log(`Offene Issues von ${repo} nicht lesbar: ${schreibrechtText(e, repo, "lesen") ?? fehlerText(e)}`);
    return { fehler: true };
  }
}

/**
 * Datum (ISO) des frühesten Root-Commits von HEAD (`git log --max-parents=0`), für den Zeitraum des ersten Status-Tickets (#101 L31); null, wenn git es nicht liefert
 * (flache Kopie, kein Repo, Fehler). `git` ist die Test-Naht (`args -> stdout`).
 */
export function ersterCommitDatum(git = (args) => execFileSync("git", args, { encoding: "utf8" })) {
  try {
    const daten = git(["log", "--max-parents=0", "--format=%cI", "HEAD"]).split(/\r?\n/).map((z) => z.trim()).filter((z) => !Number.isNaN(Date.parse(z)));
    daten.sort((x, y) => Date.parse(x) - Date.parse(y));
    return daten[0] ?? null;
  } catch {
    return null;
  }
}

/** Die echte I/O des Takts (gh, Board, Dateien); `fuehreTaktAus` nimmt sie injiziert, damit die Verdrahtung ohne Netz testbar ist. */
export const ECHTE_IO = {
  ghJson,
  frischeOffeneIssues: (a) => frischeOffeneIssues(a),
  itemsUeberIssues: (rolle, nummern, { repo, ...opts } = {}) => itemsUeberIssues(boardFuerRolle(rolle), nummern, opts, repo),
  addToBoardTodo: (rolle, nodeId, opts) => addToBoardTodo(boardFuerRolle(rolle), nodeId, opts),
  loadItems: (rolle, opts) => loadItems(boardFuerRolle(rolle), opts),
  loadOpenIssuePages,
  ladeKommentare: (nr, repo) => issueKommentare(nr, ghJson, repo),
  fuehreStatusAus,
  fuehreHarnessAus,
  fuehreLangfuseAus,
  log: (z) => console.log(z),
  env: process.env,
  ersterCommitDatum,
};

/** Der Harness-Sammelticket-Teil des Takts: Voraussetzung prüfen, Füllstand entscheiden, ausführen. Liefert `{ fehler, items }` (die Liste nach einer Verschiebung nachgezogen). */
function harnessSchritt({ items, offene, repo, io, commits, abHarness, harnessIssues, dry, token }) {
  const voraussetzung = harnessVoraussetzung({ items });
  if (!voraussetzung.ok) {
    io.log(voraussetzung.meldung);
    return { fehler: Boolean(voraussetzung.fehler), items };
  }
  const h = entscheideMitFuellstand({ items, offene, repo, io });
  io.log(`Harness-Sammelticket: ${h.aktion}${h.nr ? ` #${h.nr}` : ""} (${h.grund}); Füllstand ${h.fuellstand ?? "?"}/${HARNESS_TAKT_KOMMENTARE}; Fenster ab ${abHarness}`);
  io.log(quotenBericht(commits, abHarness, harnessIssues).zeile);
  if (dry || h.aktion === "nichts") return { fehler: false, items };
  if (!io.fuehreHarnessAus(h, items, token)) return { fehler: true, items };
  return { fehler: false, items: verschiebe(items, items.find((i) => i.number === h.nr).id, h.afterId) };
}

/**
 * Der ganze Lauf (#1428 Z23, vorher `main`): Fenster berechnen, Status-Ticket und Harness-Sammelticket entscheiden und ausführen.
 * `io` bündelt jeden Zugriff nach außen (siehe `ECHTE_IO`). Liefert `{ fehler }`; der Aufrufer setzt daraus den Exit-Code.
 */
export function fuehreTaktAus({ jetzt, dry = false, repo = REPO, ausloeser = "schedule", token, io = ECHTE_IO, config, bezieher = false, anlass }) {
  const harnessLabel = labelAus(config, "harness");
  const fuehrt = zielRepoFuer([harnessLabel], config); // das Repo, dessen Issues das Factory-Board führt
  if (!gleichesRepo(fuehrt, repo)) return (bezieher ? bezieherTakt : nurWaechter)({ repo, jetzt, dry, token, config, io, ausloeser, fuehrt, anlass });
  const gelesen = leseOffene(io, repo);
  if (gelesen.fehler) return { fehler: true };
  const offene = gelesen.offene;
  const seit = new Date(jetzt.getTime() - 90 * TAG_MS).toISOString();
  const geschlossen = io.ghJson(harnessIssuesAnfrage({ repo, label: harnessLabel, seit }))
    .flat()
    .filter((i) => !i.pull_request && typeof i.closed_at === "string")
    .sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at));
  // Die Nummern aller geschlossenen Harness-Issues: die Produktquote ordnet einen Commit über seine `#N`-Referenz zu (istHarnessCommit).
  const harnessIssues = new Set(geschlossen.map((i) => i.number));
  // Der Abschluss des letzten Harness-Sammeltickets beginnt das Fenster der Produktquote (Protokollzeile).
  const { abschluss } = sammelStand([
    ...geschlossen.map((i) => ({ number: i.number, title: i.title, state: "closed", closedAt: i.closed_at })),
    ...offene.map((i) => ({ number: i.number, title: i.titel, state: "open" })),
  ]);
  const letzter = (titel) => {
    const g = geschlossen.find((i) => i.title === titel);
    return g ? { number: g.number, closedAt: g.closed_at, createdAt: g.created_at } : null;
  };
  const vorgaenger = letzter(STATUS_TITEL);
  // Zählfenster (#1628): beginnt mit dem Anlegen des jüngsten Status-Tickets (offen oder geschlossen); jedes Anlegen setzt den Zähler auf 0.
  const abStatus = statusFensterAb({ vorgaenger, offene, jetzt });
  const abHarness = mergeFensterAb(abschluss?.closedAt ?? null, jetzt).toISOString();
  const fruehestens = abStatus < abHarness ? abStatus : abHarness;
  // Nach einem Umzug des Factory-Boards (#78) zählen die Commits beider Repos; ein fremdes Repo liest der Projekt-Token.
  const commits = holeQuotenCommits({
    quellen: quotenQuellen({ config, repo }),
    lies: quotenCommitLeser({ gh: io.ghJson, repo, since: fruehestens, env: io.env }),
  });
  // Beide Board-Listen einmal je Lauf (brauchen den Projekt-Scope des Tokens); Status- und Harness-Takt arbeiten auf der Factory-Liste.
  const roh = token ? { produkt: io.loadItems("produkt", { token, repo }), factory: io.loadItems("factory", { token, repo }) } : null;
  const doppelt = roh ? seitenListen(roh.produkt, roh.factory, config).doppelt : [];
  for (const nr of doppelt) io.log(`::warning::Board-Wächter: #${nr} steht auf beiden Boards, es zählt das Board laut Trennregel.`);
  let items = roh ? factoryListe(roh.factory, doppelt, config) : null;

  const s = statusSchritt({ offene, commits, abStatus, vorgaenger, ausloeser, jetzt, repo, label: harnessLabel, token, dry, config, io, items, anlass });
  let fehler = s.fehler;
  items = s.items;

  // Board-Wächter (#1628): offene Issues ohne Board-Item aufnehmen.
  if (items) {
    const w = nimmFehlendeAuf({ offene, listen: { produkt: roh.produkt, factory: items }, token, dry, repo, config }, io);
    items = w.listen.factory;
    if (w.fehler) fehler = true;
  }

  const sammel = sammelSchritte({ items, offene, repo, io, commits, abHarness, harnessIssues, dry, token, bezieher });
  return { fehler: fehler || sammel.fehler };
}

/**
 * Harness- und Langfuse-Sammelticket des Fabrik-Laufs (aus `fuehreTaktAus` herausgelöst, factory#379). Harness-Sammelticket: im Bezieher
 * entfällt es (factory#202 L20, ADR 0031), sonst Füllstand (eigenes Fenster) auf der nachgezogenen Liste. Langfuse-Sammelticket zuletzt,
 * damit Notfälle, Harness-Sammelticket und Status-Ticket vor ihm stehen.
 */
function sammelSchritte({ items, offene, repo, io, commits, abHarness, harnessIssues, dry, token, bezieher }) {
  let fehler = false;
  let liste = items;
  if (bezieher) io.log("Harness-Sammelticket: nichts (Bezieher, ADR 0031: nur im Factory-Repo)");
  else {
    const hs = harnessSchritt({ items: liste, offene, repo, io, commits, abHarness, harnessIssues, dry, token });
    if (hs.fehler) fehler = true;
    liste = hs.items;
  }
  const lf = langfuseSchritt({ items: liste, repo, io, dry, token, rolle: "factory" });
  return { fehler: fehler || lf.fehler };
}

/**
 * Einstieg: liest Aufruf und Umgebung, fährt den Takt und liefert den Exit-Code (0, 1 bei Fehler im Lauf, `AUFRUF_EXIT` bei falschem Aufruf).
 * `env` ist die einzige Quelle der Umgebung (Token, Event, Kontingent-Log) und geht auch als `io.env` an die Commit-Leser. Nähte (Tests): `argv`,
 * `io`, `kontingent`, `lauf`, `ladeConfig`, `err`, `jetzt`, `wurzel` (Wurzel für die Bezieher-Erkennung am Sync-Stand).
 */
export function main(env = process.env, { argv = process.argv.slice(2), io = ECHTE_IO, kontingent = (opt) => mitKontingent("board-takt", opt), lauf = fuehreTaktAus, ladeConfig = ladeProjektConfig, err = console.error, jetzt = () => new Date(), wurzel = WURZEL } = {}) {
  // Aufruf-Fehler vor jedem I/O: sonst schriebe `mitKontingent` seinen Hinweis vor den Fehler (#1817).
  const aufruf = flagsLesen(argv, { "dry-run": { type: "boolean" } });
  if (aufruf.fehler) {
    err(`board-takt: ${aufruf.fehler.text}\nAufruf: node scripts/board-takt.mjs [--dry-run]`);
    return AUFRUF_EXIT;
  }
  if (env.PROJECT_TOKEN) kontingent({ token: env.PROJECT_TOKEN });
  const { fehler } = lauf({
    jetzt: jetzt(),
    dry: aufruf.werte["dry-run"] === true,
    repo: REPO,
    ausloeser: env.GITHUB_EVENT_NAME || "schedule",
    anlass: env.LANGFUSE_ANLASS,
    token: env.PROJECT_TOKEN,
    io: { ...io, env },
    config: ladeConfig(),
    bezieher: istBezieher(wurzel), // Sync-Stand vorhanden: Bezieher (factory#195)
  });
  return fehler ? 1 : 0;
}

if (istDirektaufruf(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.log(fehlerMeldung(err));
    process.exitCode = 1;
  }
}
