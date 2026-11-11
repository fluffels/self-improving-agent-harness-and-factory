#!/usr/bin/env node
/**
 * Factory-Kennzahlen (ADR 0022 §6, F14): Lauf-Ergebnis, Nacharbeit und Kosten je Ticket als ein Markdown-Block
 * für den Bericht-Kommentar des Wochen-Status-Tickets, dazu die Abnahme-Quote im ersten Durchgang. Fehlende Daten erscheinen als Lücke mit Grund, nie als 0.
 *
 *   node scripts/factory-kennzahlen.mjs --von <ISO> --bis <ISO> [--langfuse] [--json] [--datenbasis]
 *
 * Verkettung über Unterprozesse mit `--json` (Einstiegsskripte importieren einander nicht): `lauf-ergebnis.mjs` für
 * Lauf-Ergebnis und Nacharbeit, `token-baseline.mjs` je Ticket für die Kosten (Standard: Transkript, `--langfuse`
 * ausdrücklich), `naechstes-ticket.mjs --maengel` für den Abschnitt „Spezifikation“. Ticket → Session über die Claim-Zeile im lokalen Transkript. Definitionen und Grenzen:
 * docs/model-routing.md (Fabrik) › Factory-Kennzahlen.
 *
 * Abschnitt „Abo-Kontingent je Ticket“ (factory#285): Prozentpunkte des 7-Tage-Fensters je gemergtem Ticket aus dem Kontingent-Verlauf der Statusline
 * (`abo-kontingent-lib.mjs`, Claims per GraphQL); fehlt der Verlauf, gh oder das Lauf-Ergebnis, erscheint eine Lücke mit Grund, der Exit-Code bleibt.
 *
 * Abschnitt „Tokens je Abo-Prozentpunkt“ (factory#290): die Tokens der lokalen Transkripte (alle Projektordner, das Limit gilt kontoweit) zwischen zwei Punkten
 * desselben Verlaufs, je Tag und Woche (`tokens-je-prozentpunkt-lib.mjs`); ohne Verlauf oder Transkripte eine Lücke mit Grund, der Exit-Code bleibt.
 *
 * `--datenbasis` (factory#258) ist die Vorprüfung des Status-Laufs und läuft allein: je Ticket-Lauf des Zeitraums (`lauf-ergebnis`) die
 * Sessions mit Claim-Zeile im lokalen Transkript zählen; kein token-baseline, kein Audit, keine Nacharbeit. Stand: `leer` (kein Lauf),
 * `erfüllt` (alle), `teilweise` (normal bei zwei Maschinen), `verletzt` (0 von n). Grenze: Codex-Läufe zählen als ohne Transkript
 * (`transkript.mjs` liest nur Claude-Transkripte, Codex hat keinen Langfuse-Exporter).
 *
 * Exit 0 ok (auch mit Kosten-Lücken), 1 Aufruffehler, 2 Lauf-Ergebnis fehlt oder verletzt den Vertrag (Block erscheint trotzdem),
 * 3 nur mit `--datenbasis`: Vorbedingung verletzt (keine Transkripte der Ticket-Läufe auf dieser Maschine).
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { flagsLesen } from "./flag-lib.mjs";
import { toolEventsFromTranscript } from "./brain-metrics.mjs";
import { REPO } from "./board-lib.mjs";
import { fehlerText, ghJson } from "./gh-cli.mjs";
import { aboKontingent, aboKontingentAbschnitt, claimAbfrage, claimsAusAntwort, verlaufAus } from "./abo-kontingent-lib.mjs";
import { verlaufPfad } from "./budget-lib.mjs";
import { claimNummer, median } from "./mess-lib.mjs";
import { PRODUKT_QUOTE, harnessIssuesAnfrage, harnessIssuesAus, holeQuotenCommits, istHarnessCommit, quotenCommitLeser, quotenQuellen, sammelStand, zaehleTaktMerges, zaehleTicketMerges } from "./produktquote-lib.mjs";
import { MAX_REVIEW_PAESSE, MAX_ZUSATZPAESSE } from "./nachweis-lib.mjs";
import { labelAus, ladeProjektConfig } from "./projekt-config-lib.mjs";
import { callsAus, tokensJeProzentpunkt, tokensJeProzentpunktAbschnitt } from "./tokens-je-prozentpunkt-lib.mjs";
import { ladeSessions, projekteWurzel, projektOrdner } from "./transkript.mjs";

/** Nacharbeitsfenster von `lauf-ergebnis.mjs` (NACHARBEIT_TAGE dort; ein Einstiegsskript importiert das andere nicht, Test `vertrag` hält beide gleich). */
export const NACHARBEIT_TAGE = 14;
const TAG_MS = 24 * 3600 * 1000;
export const AUFRUFHILFE = "Aufruf: node scripts/factory-kennzahlen.mjs --von <ISO> --bis <ISO> [--langfuse] [--json] [--datenbasis]";

const gueltig = (iso) => Number.isFinite(Date.parse(String(iso ?? "")));

/** Argumente; ein fehlendes oder ungültiges `--von`/`--bis` setzt `fehler`. Pure. */
export function parseArgs(argv) {
  const iso = "--von und --bis brauchen je ein gültiges ISO-Datum.";
  const meldung = { "ohne-wert": iso, fehlt: iso };
  const optionen = { von: { type: "string" }, bis: { type: "string" }, langfuse: { type: "boolean" }, json: { type: "boolean" }, datenbasis: { type: "boolean" } };
  const { werte, fehler } = flagsLesen(argv, optionen, { pflicht: ["von", "bis"], meldung });
  const a = { von: werte.von, bis: werte.bis, langfuse: werte.langfuse === true, json: werte.json === true, datenbasis: werte.datenbasis === true, fehler: fehler?.text ?? null };
  if (!gueltig(a.von) || !gueltig(a.bis)) a.fehler ??= "--von und --bis brauchen je ein gültiges ISO-Datum.";
  return a;
}

/** PRs, deren Nacharbeitsfenster im Zeitraum `[von, bis]` abläuft: gemergt in `[von − 14 T, bis − 14 T]`. Pure. */
export function nacharbeitFenster(von, bis) {
  const iso = (t) => new Date(Date.parse(t) - NACHARBEIT_TAGE * TAG_MS).toISOString();
  return { von: iso(von), bis: iso(bis) };
}

/**
 * Ticket → Sessions mit Claim-Zeile (`gh issue edit <nr> … --add-assignee`) in Haupt- und Subagenten-Zeilen, je Session der früheste Claim.
 * `sessions` darf ein Generator sein (`ladeSessions`). Liefert `Map<ticket, [{session, ts}]>`, je Ticket nach `ts` sortiert. Pure.
 */
export function claimSessions(sessions) {
  const karte = new Map();
  for (const s of sessions) {
    const zeilenSaetze = [s.main, ...(s.subagents ?? []).map((a) => a.zeilen)];
    for (const zeilen of zeilenSaetze) {
      for (const ev of toolEventsFromTranscript(zeilen)) {
        if (ev.tool !== "Bash" && ev.tool !== "PowerShell") continue;
        const nr = claimNummer(ev.input?.command);
        if (!nr || !gueltig(ev.ts)) continue;
        const liste = karte.get(nr) ?? [];
        const vorhanden = liste.find((e) => e.session === s.id);
        if (!vorhanden) liste.push({ session: s.id, ts: ev.ts });
        else if (Date.parse(ev.ts) < Date.parse(vorhanden.ts)) vorhanden.ts = ev.ts;
        karte.set(nr, liste);
      }
    }
  }
  for (const liste of karte.values()) liste.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return karte;
}

/** Je Ticket der zuletzt gemergte PR (bei Gleichstand die größere PR-Nummer); PRs ohne Ticket werden nur gezählt. Pure. */
export function ticketLaeufe(zeilen) {
  const je = new Map();
  let ohneTicket = 0;
  for (const z of zeilen) {
    if (!z.ticket) {
      ohneTicket += 1;
      continue;
    }
    const alt = je.get(z.ticket);
    if (!alt || Date.parse(z.gemergt) > Date.parse(alt.gemergt) || (z.gemergt === alt.gemergt && z.pr > alt.pr)) je.set(z.ticket, z);
  }
  return { tickets: [...je.values()].sort((a, b) => a.ticket - b.ticket), ohneTicket };
}

/** Kosten eines Tickets aus der `token-baseline`-JSON-Ausgabe oder dem Fehlertext des Unterprozesses → `{ kosten }` oder `{ luecke }`. Nie 0 für fehlende Daten. Pure. */
export function kostenAus({ json, fehler }) {
  if (fehler !== undefined && fehler !== null) {
    const zeile = String(fehler).split(/\r?\n/).find((l) => l.trim()) ?? "token-baseline ohne Meldung";
    return { luecke: /^--langfuse braucht/.test(zeile) ? "kein Langfuse-Zugang" : zeile.trim() };
  }
  const total = json?.total;
  if (!total || typeof total.cost !== "number" || !Number.isFinite(total.cost)) return { luecke: "token-baseline ohne total.cost" };
  if (!(total.calls > 0)) return { luecke: "keine Calls im Ticket-Fenster" };
  if (!json.hasCost) return { luecke: "Calls ohne Preis" };
  if (json.unpriced > 0) {
    const modelle = Object.entries(json.unpricedModels ?? {}).map(([m, n]) => `${m} (${n})`).join(", ");
    return { luecke: `${json.unpriced} Calls ohne Preis${modelle ? `: ${modelle}` : ""}` };
  }
  return { kosten: total.cost };
}

const ABNAHME_FELDER = ["gemessen", "ersterDurchgang", "entfaellt", "override", "ohne"];
/** Abnahme-Feld einer Zeile von `lauf-ergebnis.mjs`: null, "entfaellt", "override" oder { durchgaenge: Ganzzahl ≥ 1 }. */
const abnahmeGueltig = (a) => a === null || a === "entfaellt" || a === "override" || (typeof a === "object" && Number.isInteger(a.durchgaenge) && a.durchgaenge >= 1);

const FELDER = ["prs", "ohneNacharbeit", "nachweisbareFenster", "nacharbeitOffen", "ciFixSumme", "festgefahrenSumme", "runde1MitBlocker", "mitBlockerFeld"];

/** Prüft die JSON-Ausgabe von `lauf-ergebnis.mjs` gegen den Vertrag; Verstoß → `{ luecke }`, sonst `{ daten }`. Pure. */
export function vertragPruefen(json) {
  if (!json || !Array.isArray(json.zeilen) || !json.kennzahlen) return { luecke: "lauf-ergebnis: Ausgabe ohne zeilen/kennzahlen (Vertrag verletzt)" };
  const fehlt = FELDER.filter((f) => !Number.isFinite(json.kennzahlen[f]));
  if (fehlt.length > 0) return { luecke: `lauf-ergebnis: Kennzahl-Feld fehlt: ${fehlt.join(", ")} (Vertrag verletzt)` };
  const ab = json.kennzahlen.abnahme;
  if (!ab || typeof ab !== "object") return { luecke: "lauf-ergebnis: Kennzahl-Feld fehlt: abnahme (Vertrag verletzt)" };
  const abFehlt = ABNAHME_FELDER.filter((f) => !Number.isFinite(ab[f]));
  if (abFehlt.length > 0) return { luecke: `lauf-ergebnis: Kennzahl-Feld fehlt: ${abFehlt.map((f) => `abnahme.${f}`).join(", ")} (Vertrag verletzt)` };
  const kaputt = json.zeilen.find((z) => !z || !Number.isFinite(z.pr) || !Number.isFinite(z.ciFix) || !gueltig(z.gemergt) || typeof z.nacharbeit !== "string" || typeof z.fristAbgelaufen !== "boolean" || !abnahmeGueltig(z.abnahme));
  if (kaputt !== undefined) return { luecke: "lauf-ergebnis: Zeile ohne pr/ciFix/gemergt/nacharbeit/fristAbgelaufen/abnahme (Vertrag verletzt)" };
  return { daten: json };
}

const anteil = (a, b, leer = "–") => (b === 0 ? leer : `${Math.round((a / b) * 100)} % (${a}/${b})`);
const dollar = (x) => `${x.toFixed(2).replace(".", ",")} $`;

function laufAbschnitt(lauf) {
  if (lauf.luecke) return [`- Lücke: ${lauf.luecke}`];
  const { zeilen, kennzahlen: k } = lauf.daten;
  const { tickets, ohneTicket } = ticketLaeufe(zeilen);
  const ohneCiFix = zeilen.filter((z) => z.ciFix === 0).length;
  return [
    `- PRs: ${k.prs} (Tickets: ${tickets.length}, ohne Ticket: ${ohneTicket})`,
    `- Ohne CI-Fix: ${anteil(ohneCiFix, zeilen.length)}`,
    `- Runde 1 mit Blocker: ${anteil(k.runde1MitBlocker, k.mitBlockerFeld)}`,
    `- Σ CI-Fix-Runden: ${k.ciFixSumme}, Σ festgefahren: ${k.festgefahrenSumme}`,
  ];
}

function nacharbeitAbschnitt(n, fenster) {
  const kopf = `Fenster: PRs gemergt ${fenster.von.slice(0, 10)} bis ${fenster.bis.slice(0, 10)}, ${NACHARBEIT_TAGE} T Nacharbeitsfrist abgelaufen`;
  if (n.luecke) return [kopf, `- Lücke: ${n.luecke}`];
  const k = n.daten.kennzahlen;
  const treffer = n.daten.zeilen.filter((z) => z.nacharbeit === "revert" || z.nacharbeit === "folge");
  return [
    kopf,
    `- Ohne Nacharbeit: ${anteil(k.ohneNacharbeit, k.nachweisbareFenster, "– (kein Fenster fällig)")}`,
    ...treffer.map((z) => `- Nacharbeit (${z.nacharbeit}): PR #${z.pr}${z.ticket ? `, Ticket #${z.ticket}` : ""}`),
    ...(k.nacharbeitOffen > 0 ? [`- Fenster noch offen: ${k.nacharbeitOffen}`] : []),
  ];
}

function kostenAbschnitt(tickets, quelle) {
  if (tickets.length === 0) return ["- Lücke: keine Tickets im Zeitraum"];
  const gemessen = tickets.filter((t) => t.ergebnis.kosten !== undefined);
  const med = median(gemessen.map((t) => t.ergebnis.kosten));
  return [
    "| Ticket | PR | Kosten |",
    "|---|---|---|",
    ...tickets.map((t) => `| #${t.ticket} | #${t.pr} | ${t.ergebnis.kosten !== undefined ? dollar(t.ergebnis.kosten) : `Lücke: ${t.ergebnis.luecke}`} |`),
    "",
    `- Quelle: ${quelle}; gemessen: ${gemessen.length} von ${tickets.length}`,
    `- Median Kosten/Ticket: ${med === null ? "–" : dollar(med)}`,
  ];
}

/** Abnahme-Quote im ersten Durchgang aus dem Lauf-Ergebnis; ohne Urteil im Zeitraum eine Lücke mit Grund, nie 0 %. */
function abnahmeAbschnitt(lauf) {
  if (lauf.luecke) return [`- Lücke: kein Lauf-Ergebnis (${lauf.luecke})`];
  const a = lauf.daten.kennzahlen.abnahme;
  const overrides = lauf.daten.zeilen.filter((z) => z.abnahme === "override").map((z) => `#${z.pr}`);
  return [
    a.gemessen === 0 ? "- Lücke: keine PR mit Abnahme-Urteil im Zeitraum" : `- ${a.ersterDurchgang} von ${a.gemessen} im ersten Durchgang (${Math.round((a.ersterDurchgang / a.gemessen) * 100)} %)`,
    `- Nicht in der Quote: entfällt ${a.entfaellt}, Override ${a.override}${overrides.length > 0 ? ` (PR ${overrides.join(", ")})` : ""}, ohne gültige Abnahme-Zeile ${a.ohne}`,
  ];
}

/** Die Ticketarten der Kosten- und Abnahme-Auswertung, in Anzeigereihenfolge. */
export const TICKETARTEN = ["Produkt", "Harness", "Sammelticket"];

/** Die Art eines Tickets: Sammelticket (Titel aus `SAMMELTICKET_TITEL_LISTE`, trägt oft auch das Harness-Label) vor Harness (`labels.harness`) vor Produkt. Pure. */
export function ticketArt(nr, { sammelIssues, harnessIssues }) {
  if (sammelIssues.has(nr)) return "Sammelticket";
  return harnessIssues.has(nr) ? "Harness" : "Produkt";
}

/**
 * Median der Kosten und Abnahme im ersten Durchgang je Ticketart: `{ gruppen: [{ art, tickets, gemessen, median, abnahmeGemessen, abnahmeErster }] }`
 * oder `{ luecke }`, wenn die Zuordnung nicht möglich ist (Harness-Issues oder Sammeltickets nicht geladen): dann keine geratene Aufteilung. `tickets` = `[{ ticket, pr, ergebnis }]`,
 * `zeilen` = PR-Zeilen von `lauf-ergebnis.mjs`; PRs ohne Ticket und Kosten-Lücken zählen nicht in den Median (nie 0 $). Pure.
 */
export function artGruppen({ tickets, zeilen, sammelIssues, harnessIssues, harnessLuecke = null }) {
  if (!(harnessIssues instanceof Set)) return { luecke: harnessLuecke ?? "Harness-Issues nicht geladen" };
  if (!(sammelIssues instanceof Set)) return { luecke: "Sammeltickets nicht geladen" };
  const art = (nr) => ticketArt(nr, { sammelIssues, harnessIssues });
  const gruppen = TICKETARTEN.map((name) => {
    const meine = tickets.filter((t) => art(t.ticket) === name);
    const gemessen = meine.filter((t) => t.ergebnis.kosten !== undefined);
    const urteile = zeilen.filter((z) => z.ticket && art(z.ticket) === name && typeof z.abnahme === "object" && z.abnahme !== null);
    return { art: name, tickets: meine.length, gemessen: gemessen.length, median: median(gemessen.map((t) => t.ergebnis.kosten)), abnahmeGemessen: urteile.length, abnahmeErster: urteile.filter((z) => z.abnahme.durchgaenge === 1).length };
  });
  return { gruppen };
}

/** Abschnitt „Ticketarten“ (Tabelle je Art; Median ohne Messung und Abnahme ohne Urteil als „–“, nie 0); eine Lücke zeigt den Grund. Pure. */
export function artenAbschnitt(arten) {
  if (arten.luecke) return [`- Lücke: ${arten.luecke}`];
  return [
    "| Art | Tickets | Gemessen | Median Kosten | Abnahme im 1. Durchgang |",
    "|---|---|---|---|---|",
    ...arten.gruppen.map((g) => `| ${g.art} | ${g.tickets} | ${g.gemessen} | ${g.median === null ? "–" : dollar(g.median)} | ${anteil(g.abnahmeErster, g.abnahmeGemessen)} |`),
  ];
}

/** Höchstens so viele Tickets mit Mangel zeigt der Abschnitt einzeln (der Rest als Zahl). */
export const MAENGEL_ZEILEN_MAX = 10;

/** Abschnitt „Spezifikation“: Zahl der freien, vertrauten, unblockierten Tickets mit Mangel (`holeMaengel`) samt Liste; eine Lücke zeigt den Grund, nie 0. Pure. */
export function spezifikationAbschnitt(s) {
  if (s.luecke) return [`- Lücke: ${s.luecke}`];
  return [
    `- ${s.anzahl} ${s.anzahl === 1 ? "Ticket" : "Tickets"} mit Mangel`,
    ...s.maengel.slice(0, MAENGEL_ZEILEN_MAX).map((m) => `- #${m.nr} ${m.titel}: ${m.fehlt.join("; ")}`),
    ...(s.maengel.length > MAENGEL_ZEILEN_MAX ? [`- … und ${s.maengel.length - MAENGEL_ZEILEN_MAX} weitere`] : []),
  ];
}

/** Bericht als Daten: `lauf`/`nacharbeit` = `vertragPruefen`-Ergebnis, `tickets` = `[{ticket, pr, ergebnis}]`. Pure. */
export function bericht({ von, bis, lauf, nacharbeit, tickets, quelle, audit, spezifikation, arten, kontingent, tokensJePp }) {
  return {
    ...(kontingent ? { kontingent } : {}),
    ...(tokensJePp ? { tokensJePp } : {}),
    ...(audit ? { audit } : {}),
    ...(arten ? { arten } : {}),
    ...(spezifikation ? { spezifikation } : {}),
    zeitraum: { von, bis },
    nacharbeitFenster: nacharbeitFenster(von, bis),
    quelle,
    lauf,
    nacharbeit,
    tickets,
  };
}

/** Markdown-Block für den Bericht-Kommentar. Pure. */
export function renderMarkdown(b) {
  const kosten = b.lauf.luecke ? ["- Lücke: kein Lauf-Ergebnis, damit keine Ticketliste"] : kostenAbschnitt(b.tickets, b.quelle);
  return [
    `### Factory-Kennzahlen (${b.zeitraum.von} bis ${b.zeitraum.bis})`,
    "",
    "**Lauf-Ergebnis**",
    ...laufAbschnitt(b.lauf),
    "",
    "**Nacharbeit**",
    ...nacharbeitAbschnitt(b.nacharbeit, b.nacharbeitFenster),
    "",
    "**Kosten je Ticket**",
    ...kosten,
    ...(b.arten ? ["", "**Ticketarten**", ...artenAbschnitt(b.arten)] : []),
    ...(b.kontingent ? ["", "**Abo-Kontingent je Ticket**", ...aboKontingentAbschnitt(b.kontingent)] : []),
    ...(b.tokensJePp ? ["", "**Tokens je Abo-Prozentpunkt**", ...tokensJeProzentpunktAbschnitt(b.tokensJePp)] : []),
    "",
    "**Abnahme-Quote**",
    ...abnahmeAbschnitt(b.lauf),
    ...(b.spezifikation ? ["", "**Spezifikation**", ...spezifikationAbschnitt(b.spezifikation)] : []),
    ...(b.audit ? ["", "**Selbst-Audit**", ...auditAbschnitt(b.audit)] : []),
  ].join("\n");
}

// ── Selbst-Audit (#1787): das Harness hinterfragt seine Mechanismen selbst ───────────────────────────────

/** Lens-Zahl: Obergrenze der Review-Runden je PR: Cap-Pässe, höchstens `MAX_ZUSATZPAESSE` Zusatzpässe und die eine Delta-Runde nach einem Abnahme-Fix. */
export const MAX_RUNDEN = MAX_REVIEW_PAESSE + MAX_ZUSATZPAESSE + 1;
/** CI-Fix-Runden, ab denen das Festgefahren-Protokoll greifen muss (nach dem dritten Fix-Versuch). */
export const FESTGEFAHREN_AB_CI_FIX = 4;
/** Produktquote: unter so vielen Ticket-Merges im Fenster gibt es keine Aussage. */
export const QUOTE_MIN_MERGES = 4;

const nrListe = (zs) => zs.map((z) => `#${z.pr}`).join(", ");

function auditQuote(commits, luecke, harnessIssues, harnessLuecke, produktQuelle) {
  const soll = `höchstens 1 Factory- auf ${PRODUKT_QUOTE} Produkt-Merges`;
  const grund = luecke ?? harnessLuecke;
  if (grund) return { mechanismus: "Produktquote", messung: grund, soll, status: "Lücke" };
  const ticket = commits.filter((c) => zaehleTicketMerges([c]) === 1);
  const harness = ticket.filter((c) => istHarnessCommit(c, harnessIssues)).length;
  const produkt = ticket.length - harness;
  if (produktQuelle === false && produkt === 0) return { mechanismus: "Produktquote", messung: `${harness} Factory- auf 0 Produkt-Merges: kein Produkt-Board (Repo ohne Produkt-Tickets), die Quote ist hier nicht messbar`, soll, status: "Lücke" };
  const messung = `${harness} Factory- auf ${produkt} Produkt-Merges seit dem letzten Sammelticket-Abschluss (${harnessIssues ? "Zuordnung nach Label der referenzierten Issues" : "Rückfall: Zuordnung nach Commit-Scope"})`;
  if (ticket.length < QUOTE_MIN_MERGES) return { mechanismus: "Produktquote", messung: `${messung}, nur ${ticket.length} Merges: keine Aussage`, soll, status: "Lücke" };
  return { mechanismus: "Produktquote", messung, soll, status: harness * PRODUKT_QUOTE <= produkt ? "ok" : "ABWEICHUNG" };
}

function auditTakt({ commits, luecke, sammelAbschluss, sammelIssues, sammelInArbeit }) {
  const soll = "reine Messung, kein Soll: der Takt hängt am Füllstand der Befund-Kommentare, ein still liegendes Sammelticket ist gewollt";
  if (luecke) return { mechanismus: "Härtungs-Takt", messung: luecke, soll, status: "Lücke" };
  if (sammelInArbeit) return { mechanismus: "Härtungs-Takt", messung: `Vorgänger #${sammelInArbeit} in Arbeit, der Takt zählt erst ab dessen Abschluss`, soll, status: "ok" };
  if (!sammelAbschluss) return { mechanismus: "Härtungs-Takt", messung: "kein abgeschlossenes Sammelticket gefunden, kein Zählanfang", soll, status: "Lücke" };
  const n = zaehleTaktMerges(commits, null, sammelIssues);
  const messung = `${n} Ticket-Merges seit dem Abschluss des letzten Sammeltickets (${String(sammelAbschluss).slice(0, 10)})`;
  return { mechanismus: "Härtungs-Takt", messung, soll, status: "ok" };
}

function auditFestgefahren(zeilen) {
  const soll = `jeder PR mit ${FESTGEFAHREN_AB_CI_FIX} und mehr CI-Fix-Runden trägt das Festgefahren-Label`;
  if (!zeilen) return { mechanismus: "Festgefahren-Protokoll", messung: "kein Lauf-Ergebnis", soll, status: "Lücke" };
  const vollstaendig = (z) => Number.isFinite(z.ciFix) && Number.isFinite(z.festgefahren);
  const fehlen = zeilen.filter((z) => !vollstaendig(z));
  const luecken = zeilen.filter((z) => vollstaendig(z) && z.ciFix >= FESTGEFAHREN_AB_CI_FIX && z.festgefahren === 0);
  if (luecken.length > 0) return { mechanismus: "Festgefahren-Protokoll", messung: `${luecken.length} PRs mit ≥ ${FESTGEFAHREN_AB_CI_FIX} CI-Fix-Runden ohne Label: ${nrListe(luecken)}`, soll, status: "ABWEICHUNG" };
  if (fehlen.length > 0) return { mechanismus: "Festgefahren-Protokoll", messung: `bei ${fehlen.length} von ${zeilen.length} PRs fehlt ciFix oder festgefahren`, soll, status: "Lücke" };
  return { mechanismus: "Festgefahren-Protokoll", messung: `${zeilen.length} PRs geprüft, keiner mit ≥ ${FESTGEFAHREN_AB_CI_FIX} CI-Fix-Runden ohne Label`, soll, status: "ok" };
}

function auditLens(zeilen) {
  const soll = `höchstens ${MAX_RUNDEN} Review-Runden je PR`;
  if (!zeilen) return { mechanismus: "Lens-Zahl", messung: "kein Lauf-Ergebnis", soll, status: "Lücke" };
  const gemessen = zeilen.filter((z) => Number.isInteger(z.runden));
  const zuviel = gemessen.filter((z) => z.runden > MAX_RUNDEN);
  if (zuviel.length > 0) return { mechanismus: "Lens-Zahl", messung: `${zuviel.length} PRs mit mehr als ${MAX_RUNDEN} Runden: ${zuviel.map((z) => `#${z.pr} (${z.runden})`).join(", ")}`, soll, status: "ABWEICHUNG" };
  if (gemessen.length === 0) return { mechanismus: "Lens-Zahl", messung: `kein PR mit Review-Nachweis (${zeilen.length} PRs ohne Review-Nachweiszeile)`, soll, status: "Lücke" };
  return { mechanismus: "Lens-Zahl", messung: `${gemessen.length} von ${zeilen.length} PRs mit Nachweis, höchste Rundenzahl ${Math.max(...gemessen.map((z) => z.runden))}`, soll, status: "ok" };
}

/**
 * Selbst-Audit: je Mechanismus (Produktquote, Härtungs-Takt, Festgefahren-Protokoll, Lens-Zahl) eine Messung gegen das Ziel, als
 * `{ mechanismus, messung, soll, status: "ok" | "ABWEICHUNG" | "Lücke" }`. `commits` = Commits von main seit dem Abschluss des letzten Sammeltickets
 * (`null` plus `commitsLuecke` = Grund, wenn nicht ladbar), `sammelAbschluss` = dessen Abschlusszeit, `sammelIssues` = Nummern
 * aller Sammeltickets, `sammelInArbeit` = Nummer eines geclaimten offenen Sammeltickets oder null, `harnessIssues` = Nummern geschlossener Harness-Issues (Quote-Zuordnung, null: Rückfall auf den Scope), `harnessLuecke` = Grund, wenn nicht ladbar (nur die Quote wird Lücke), `produktQuelle` = ob das Repo ein Produkt-Board hat (`false` und kein Produkt-Merge: Quote = Lücke „kein Produkt-Board“; Vorgabe `true`), `zeilen` = Zeilen von `lauf-ergebnis --json`
 * (`null` ohne). Fehlende Daten sind immer eine Lücke mit Grund, nie 0. Pur.
 */
export function selbstAudit({ commits = null, commitsLuecke = null, sammelAbschluss = null, sammelIssues = new Set(), sammelInArbeit = null, harnessIssues = null, harnessLuecke = null, produktQuelle = true, zeilen = null }) {
  const luecke = Array.isArray(commits) ? null : (commitsLuecke ?? "Commits von main nicht geladen");
  return [
    auditQuote(commits, luecke, harnessIssues, harnessLuecke, produktQuelle),
    auditTakt({ commits, luecke, sammelAbschluss, sammelIssues, sammelInArbeit }),
    auditFestgefahren(zeilen),
    auditLens(zeilen),
  ];
}

/** Markdown-Zeilen des Selbst-Audits: `Mechanismus: Messung · Soll: … · Status`. Pur. */
export function auditAbschnitt(audit) {
  return audit.map((a) => `- ${a.mechanismus}: ${a.messung} · Soll: ${a.soll} · ${a.status}`);
}

/** Die Nummern geschlossener Harness-Issues für die Quote-Zuordnung; ein Fehler (auch fehlendes `labels.harness`) wird zur `harnessLuecke`. */
function ladeHarnessIssues({ gh, repo, config, configFehler, seit }) {
  if (!config && configFehler) return { harnessIssues: null, harnessLuecke: `Projekt-Config nicht ladbar: ${configFehler}` };
  try {
    return { harnessIssues: harnessIssuesAus(gh(harnessIssuesAnfrage({ repo, label: labelAus(config, "harness"), seit }))) };
  } catch (err) {
    return { harnessIssues: null, harnessLuecke: `Harness-Issues nicht ladbar: ${fehlerText(err, 200)}` };
  }
}

/** Ab wann geschlossene Harness-Issues zu laden sind: einen Tag vor dem früheren von `since` und dem Berichtsfenster `von` (die Ticketarten brauchen das ganze Fenster). Pur. */
function harnessSeitAus(since, von) {
  const fruehest = Math.min(Date.parse(since), gueltig(von) ? Date.parse(von) : Number.POSITIVE_INFINITY);
  return new Date(fruehest - TAG_MS).toISOString();
}

/**
 * Lädt die Rohdaten des Selbst-Audits mit drei gh-Aufrufen (Sammeltickets mit `--limit`, Commits von main seit deren letztem Abschluss und geschlossene Harness-Issues ab dann minus 1 Tag, paginiert;
 * keine Modell-Tokens). `gh` ist injizierbar. Ein Ladefehler wird zur Lücke mit Grund (`commitsLuecke`, bei den Harness-Issues `harnessLuecke`), nie zu leeren Daten.
 */
export function ladeAuditDaten({ von, bis }, { gh = ghJson, repo = REPO, config = null, configFehler = null, env = process.env } = {}) {
  let issues;
  try {
    issues = gh(["issue", "list", "--repo", repo, "--state", "all", "--search", "in:title \"gesammelt\"", "--json", "number,title,state,closedAt,assignees", "--limit", "200"]);
  } catch (err) {
    return { commits: null, commitsLuecke: `Sammeltickets nicht ladbar: ${fehlerText(err, 200)}` };
  }
  const stand = sammelStand(issues);
  const sammelAbschluss = stand.abschluss?.closedAt ?? null;
  const since = sammelAbschluss ? new Date(Date.parse(sammelAbschluss) + 60_000).toISOString() : new Date(Date.parse(bis) - 28 * TAG_MS).toISOString();
  const rest = { sammelAbschluss, sammelIssues: stand.sammelIssues, sammelInArbeit: stand.inArbeit };
  const harnessSeit = harnessSeitAus(since, von);
  try {
    // Nach einem Umzug des Factory-Boards (#78) zählen die Commits beider Repos; ein fremdes Repo liest der Projekt-Token.
    const quellen = quotenQuellen({ config, repo });
    const alle = holeQuotenCommits({
      quellen,
      lies: quotenCommitLeser({ gh, repo, since, env }),
    });
    const commits = alle.filter((c) => !gueltig(c?.commit?.committer?.date) || Date.parse(c.commit.committer.date) <= Date.parse(bis));
    const produktQuelle = quellen.some((q) => q.rolle === "produkt") || (config?.boards ?? []).some((b) => b.rolle === "produkt");
    return { commits, ...rest, produktQuelle, ...ladeHarnessIssues({ gh, repo, config, configFehler, seit: harnessSeit }) };
  } catch (err) {
    return { commits: null, commitsLuecke: `Commits von main nicht ladbar: ${fehlerText(err, 200)}`, ...rest };
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const HIER = dirname(fileURLToPath(import.meta.url));

/** Startet ein Nachbarskript als Unterprozess; Ergebnis `{ status, stdout, stderr }`. */
function runSkript(name, args) {
  const r = spawnSync(process.execPath, [join(HIER, name), ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? String(r.error.message) : "") };
}

/** `lauf-ergebnis.mjs --json` für ein Zeitfenster → `vertragPruefen`-Ergebnis. IO injizierbar. */
export function holeLauf(von, bis, run = runSkript) {
  const r = run("lauf-ergebnis.mjs", ["--von", von, "--bis", bis, "--json"]);
  if (r.status !== 0) return { luecke: `lauf-ergebnis Exit ${r.status}: ${String(r.stderr).split(/\r?\n/).find((l) => l.trim()) ?? "ohne Meldung"}` };
  try {
    return vertragPruefen(JSON.parse(r.stdout));
  } catch {
    return { luecke: "lauf-ergebnis: Ausgabe ist kein JSON" };
  }
}

/** `naechstes-ticket.mjs --maengel --json` → `{ anzahl, maengel }` oder `{ luecke }` (Exit ≠ 0, kein JSON, Vertragsbruch). Nie 0 für fehlende Daten. IO injizierbar. */
export function holeMaengel(run = runSkript) {
  const r = run("naechstes-ticket.mjs", ["--maengel", "--json"]);
  if (r.status !== 0) return { luecke: `naechstes-ticket Exit ${r.status}: ${String(r.stderr).split(/\r?\n/).find((l) => l.trim()) ?? "ohne Meldung"}` };
  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    return { luecke: "naechstes-ticket: Ausgabe ist kein JSON" };
  }
  if (!json || !Array.isArray(json.maengel) || json.anzahl !== json.maengel.length) return { luecke: "naechstes-ticket: Ausgabe ohne anzahl/maengel (Vertrag verletzt)" };
  return { anzahl: json.anzahl, maengel: json.maengel };
}

function kostenLauf(sessions, { ticket, pr, von, langfuse }, run) {
  const args = [...sessions.flatMap((c) => ["--session", c.session]), "--issue", String(ticket), "--pr", String(pr), "--from", von, ...(langfuse ? ["--langfuse"] : []), "--json"];
  const r = run("token-baseline.mjs", args);
  if (r.status !== 0) return kostenAus({ fehler: r.stderr || `token-baseline Exit ${r.status}` });
  try {
    return kostenAus({ json: JSON.parse(r.stdout) });
  } catch {
    return { luecke: "token-baseline: Ausgabe ist kein JSON" };
  }
}

/**
 * Kosten eines Tickets über `token-baseline.mjs --json`; IO injizierbar. Transkript: ein Lauf über alle Claim-Sessions.
 * Langfuse: je Session ein Lauf, denn `token-baseline` führt Sessions zusammen und eine Session ohne Langfuse-Daten
 * trüge still 0 $ bei; fehlt eine, ist das ganze Ticket eine Lücke (keine Teilsumme).
 */
export function holeKosten({ ticket, pr, claims, langfuse }, run = runSkript) {
  if (!claims || claims.length === 0) return { luecke: "keine Session mit Claim-Zeile" };
  const von = claims[0].ts;
  if (!langfuse) return kostenLauf(claims, { ticket, pr, von, langfuse }, run);
  let summe = 0;
  for (const c of claims) {
    const e = kostenLauf([c], { ticket, pr, von, langfuse }, run);
    if (e.luecke !== undefined) return { luecke: claims.length > 1 ? `Session ${c.session}: ${e.luecke}` : e.luecke };
    summe += e.kosten;
  }
  return { kosten: summe };
}

/** Selbst-Audit und Ticketarten aus einem Lauf des Audit-Laders (`{ von, bis }`); ohne Lader beides `undefined`, ohne Lauf-Ergebnis keine Ticketarten. */
function auditUndArten(auditLader, { von, bis, lauf, tickets }) {
  if (!auditLader) return {};
  const daten = auditLader({ von, bis });
  const zeilen = lauf.daten?.zeilen ?? null;
  const arten = zeilen ? artGruppen({ tickets, zeilen, sammelIssues: daten.sammelIssues, harnessIssues: daten.harnessIssues, harnessLuecke: daten.harnessLuecke }) : undefined;
  return { audit: selbstAudit({ ...daten, zeilen }), arten };
}

/** Claim-Karte laden; nicht lesbar (etwa fehlender Transkript-Ordner) → `{ luecke }` mit Grund statt Abbruch, sonst `{ claims }`. */
export function claimsOderLuecke(claimKarte) {
  try {
    return { claims: claimKarte() };
  } catch (err) {
    return { luecke: `Claim-Sessions nicht lesbar: ${fehlerText(err, 200)}` };
  }
}

/**
 * Setzt den Bericht zusammen; IO injiziert (`run` für die Unterprozesse, `claimKarte` liefert die Karte Ticket → Sessions).
 * Exit 2, wenn Lauf-Ergebnis oder Nacharbeit-Lauf fehlen (der Block erscheint trotzdem). Nur mit gültigem `von`/`bis` rufen.
 */
export function erstelle({ von, bis, langfuse = false }, { run = runSkript, claimKarte, auditLader = null, maengelLader = null, kontingentLader = null, tokensLader = null }) {
  const fenster = nacharbeitFenster(von, bis);
  const lauf = holeLauf(von, bis, run);
  const nacharbeit = holeLauf(fenster.von, fenster.bis, run);
  let tickets = [];
  let kontingent;
  if (lauf.daten) {
    const { claims, luecke } = claimsOderLuecke(claimKarte);
    const reihen = ticketLaeufe(lauf.daten.zeilen).tickets;
    kontingent = kontingentLader ? kontingentLader({ von, bis, tickets: reihen }) : undefined; // eine Lücke dort ändert den Exit-Code nicht
    tickets = reihen.map((z) => ({ ticket: z.ticket, pr: z.pr, ergebnis: luecke ? { luecke } : holeKosten({ ticket: z.ticket, pr: z.pr, claims: claims.get(z.ticket), langfuse }, run) }));
  } else if (kontingentLader) kontingent = { luecke: "kein Lauf-Ergebnis" };
  const tokensJePp = tokensLader ? tokensLader({ von, bis }) : undefined; // unabhängig vom Lauf-Ergebnis, eine Lücke ändert den Exit-Code nicht
  const { audit, arten } = auditUndArten(auditLader, { von, bis, lauf, tickets });
  const spezifikation = maengelLader ? maengelLader() : undefined; // eine Lücke dort ändert den Exit-Code nicht (wie bei den Kosten)
  const b = bericht({ von, bis, lauf, nacharbeit, tickets, quelle: langfuse ? "Langfuse" : "Transkript", audit, spezifikation, arten, kontingent, tokensJePp });
  return { bericht: b, exit: lauf.luecke || nacharbeit.luecke ? 2 : 0 };
}

const KONTINGENT_BLOCK = 50;

/**
 * Abo-Kontingent je Ticket (factory#285): Verlauf lesen, Claims per GraphQL holen (Blöcke zu `KONTINGENT_BLOCK`), auswerten.
 * `tickets` = Lauf-Zeilen des Zeitraums. Verlauf oder gh nicht verfügbar: `{ luecke }` mit Grund, nie 0. IO injizierbar; kein Langfuse.
 */
export function ladeAboKontingent({ von, bis, tickets }, { gh = ghJson, lies = (p) => readFileSync(p, "utf8"), pfad = verlaufPfad() } = {}) {
  let text;
  try {
    text = lies(pfad);
  } catch {
    return { luecke: `Kontingent-Verlauf fehlt: ${pfad}` };
  }
  const { punkte, kaputt } = verlaufAus(text);
  const merge = new Map(tickets.map((t) => [t.ticket, t.gemergt]));
  const claims = new Map();
  try {
    const nummern = [...merge.keys()];
    for (let i = 0; i < nummern.length; i += KONTINGENT_BLOCK) {
      const block = nummern.slice(i, i + KONTINGENT_BLOCK);
      const antwort = gh(["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-f", `query=${claimAbfrage(block)}`]);
      for (const [k, v] of claimsAusAntwort(antwort, new Map(block.map((n) => [n, merge.get(n)])))) claims.set(k, v);
    }
  } catch (err) {
    return { luecke: `Claims nicht ladbar: ${fehlerText(err, 200)}` };
  }
  return aboKontingent({ tickets, punkte, kaputt, claims, von: Date.parse(von), bis: Date.parse(bis) });
}

/** Sitzungen aller Projektordner unter `wurzel` (das Limit gilt kontoweit), jeweils ab `von`; ein Ordner nach dem anderen. */
function* alleSitzungen(wurzel, von) {
  for (const d of readdirSync(wurzel, { withFileTypes: true })) if (d.isDirectory()) yield* ladeSessions(join(wurzel, d.name), von);
}

/**
 * Tokens je Abo-Prozentpunkt (factory#290): Verlauf lesen, die Transkripte aller Projektordner zählen (`callsAus`), auswerten. Fehlt Verlauf oder
 * Wurzel: `{ luecke }` mit Grund, nie 0. IO injizierbar (`lies`, `pfad`, `wurzel`, `sitzungen`); kein Langfuse, kein Unterprozess.
 */
export function ladeTokensJeProzentpunkt({ von, bis }, { lies = (p) => readFileSync(p, "utf8"), pfad = verlaufPfad(), wurzel = projekteWurzel(), sitzungen } = {}) {
  let verlaufText;
  try {
    verlaufText = lies(pfad);
  } catch {
    return { luecke: `Kontingent-Verlauf fehlt: ${pfad}` };
  }
  let quelle;
  try {
    quelle = callsAus(sitzungen ?? alleSitzungen(wurzel, von));
  } catch (err) {
    return { luecke: `Transkripte nicht lesbar (${wurzel}): ${fehlerText(err, 200)}` };
  }
  const t = tokensJeProzentpunkt({ verlaufText, calls: quelle.calls, von: Date.parse(von), bis: Date.parse(bis) });
  return { ...t, aufbau: { sitzungen: quelle.sitzungen, calls: quelle.calls.length, ohneZeit: quelle.ohneZeit } };
}

/** `{ config }` oder `{ config: null, configFehler }`: ein Ladefehler macht nur die Quote zur Lücke (mit dem echten Fehlertext), nie den ganzen Bericht kaputt. */
export function configOderFehler(lade = ladeProjektConfig) {
  try {
    return { config: lade() };
  } catch (err) {
    return { config: null, configFehler: fehlerText(err, 200) };
  }
}

/**
 * Datenbasis des Zeitraums: Läufe (`ticketLaeufe`) gegen die Claim-Karte. `mitTranskript` zählt Tickets mit mindestens einer Session,
 * `sessions` sind alle Session-IDs dieser Tickets (einmal, sortiert), `ohne` die Tickets ohne. Pure.
 */
export function datenbasis({ tickets, claims }) {
  const mit = tickets.filter((t) => (claims.get(t.ticket) ?? []).length > 0);
  const sessions = [...new Set(mit.flatMap((t) => claims.get(t.ticket).map((c) => c.session)))].sort();
  const ohne = tickets.filter((t) => !mit.includes(t)).map((t) => t.ticket);
  const n = tickets.length;
  const stand = n === 0 ? "leer" : mit.length === n ? "erfüllt" : mit.length === 0 ? "verletzt" : "teilweise";
  return { stand, laeufe: n, mitTranskript: mit.length, sessions, ohne };
}

/** Markdown-Block „Datenbasis“ für den Bericht. Pure. */
export function datenbasisAbschnitt(d) {
  const zeilen = ["### Datenbasis", "", `- Stand: ${d.stand}; Ticket-Läufe im Zeitraum: ${d.laeufe}, davon mit Transkript: ${d.mitTranskript} von ${d.laeufe}.`];
  zeilen.push(`- Sessions mit Claim-Zeile: ${d.sessions.length > 0 ? d.sessions.join(", ") : "keine"}.`);
  if (d.ohne.length > 0) zeilen.push(`- Tickets ohne Transkript: ${d.ohne.map((n) => `#${n}`).join(", ")}.`);
  if (d.stand === "verletzt") zeilen.push("- Vorbedingung verletzt: keine Transkripte der Ticket-Läufe auf dieser Maschine (Status-Lauf auf der Maschine der Ticket-Läufe fahren).");
  return zeilen.join("\n");
}

/** Zweig `--datenbasis`: `{ text, exit }`; Exit 3 bei `verletzt`, 2 mit Lücke statt Urteil, wenn `lauf-ergebnis` fehlt. IO injiziert. */
export function erstelleDatenbasis({ von, bis }, { run = runSkript, claimKarte }) {
  const lauf = holeLauf(von, bis, run);
  if (lauf.luecke) return { text: `### Datenbasis\n\n- Lücke: ${lauf.luecke}`, exit: 2 };
  const { claims, luecke } = claimsOderLuecke(claimKarte);
  if (luecke) return { text: `### Datenbasis\n\n- Lücke: ${luecke}`, exit: 2 };
  const d = datenbasis({ tickets: ticketLaeufe(lauf.daten.zeilen).tickets, claims });
  return { text: datenbasisAbschnitt(d), exit: d.stand === "verletzt" ? 3 : 0 };
}

/** Modus `--datenbasis`: Block ausgeben und mit dem Exit des Blocks beenden (`beenden` ist im Betrieb `process.exit`). IO injiziert. */
export function datenbasisModus({ von, bis }, { run, claimKarte, log, beenden }) {
  const d = erstelleDatenbasis({ von, bis }, { run, claimKarte });
  log(d.text);
  beenden(d.exit);
}

/** Die Lader des echten Laufs (`main`); ein Test belegt, dass jeder eingehängt ist. */
export const STANDARD_LADER = {
  auditLader: (e) => ladeAuditDaten(e, configOderFehler()),
  maengelLader: () => holeMaengel(),
  kontingentLader: (e) => ladeAboKontingent(e),
  tokensLader: (e) => ladeTokensJeProzentpunkt(e),
};

function main(argv) {
  const args = parseArgs(argv);
  if (args.fehler) {
    console.error([args.fehler, AUFRUFHILFE].join("\n"));
    process.exit(1);
  }
  const { von, bis, langfuse } = args;
  const claimKarte = () => claimSessions(ladeSessions(projektOrdner(), new Date(Date.parse(von) - TAG_MS).toISOString()));
  if (args.datenbasis) datenbasisModus({ von, bis }, { claimKarte, log: console.log, beenden: process.exit }); // beendet den Prozess
  const r = erstelle({ von, bis, langfuse }, { claimKarte, ...STANDARD_LADER });
  console.log(args.json ? JSON.stringify(r.bericht, null, 2) : renderMarkdown(r.bericht));
  if (r.exit !== 0) process.exit(r.exit);
}

if (istDirektaufruf(import.meta.url)) main(process.argv.slice(2));
