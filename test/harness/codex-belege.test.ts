/* @harness-waechter: Echte Custom-Rollen und vollständige Elternketten statt Inventar-Selbstattest (#79). */
import { expect, test } from "vitest";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as raw from "../../scripts/codex-lib.mjs";
const c = raw as unknown as { bewerteBelege: (b: unknown, c: unknown) => string[] };
const config = { repo: "owner/probe", agenten: { planer: "probe-planer", umsetzer: "probe-umsetzer", lens: "probe-lens", gruppe: "probe-gruppe" } };
const rollen = [...Object.values(config.agenten), "explore", "holdout-szenario", "holdout-abnahme"];
const roleKey = "agent_source.subagent.thread_spawn.agent_role";
type Row = { id: string; type: string; sessionId: string; tags: string[]; metadata: Record<string, unknown>; usageDetails: unknown };
const gen = (id: string, parent: string, rolle?: string): Row => ({ id: `gen-${id}`, type: "GENERATION", sessionId: "session", tags: ["project:probe"], metadata: { agent_role: parent ? "subagent" : "main", agent_id: id, parent_thread_id: parent, ...(rolle ? { [roleKey]: rolle } : {}) }, usageDetails: { input: 1, output: 2 } });
const fixture = () => ({ version: "0.164.0", sessionId: "session", rollen: [...rollen], tools: ["playwright", "langfuse"], observations: [gen("main", ""), ...rollen.map(r => gen(r, r === "probe-lens" ? "probe-umsetzer" : "main", r)), { ...gen("tool", ""), type: "TOOL", metadata: { agent_id: "main" } }] });
const bewerte = (b: unknown) => c.bewerteBelege(b, config);
test("direkte und über Umsetzer verschachtelte Custom-Rollen sind belegt", () => { expect(bewerte(fixture())).toEqual([]); });
test("Inventar und Default-Subagenten sind kein Custom-Rollennachweis", () => {
  const b = fixture(); b.observations = b.observations.map(o => ({ ...o, metadata: { ...o.metadata, [roleKey]: "default" } }));
  expect(bewerte(b).filter(x => x.includes("Rolle"))).toHaveLength(rollen.length);
});
test.each(rollen)("fehlende Generation für Rolle %s", rolle => {
  const b = fixture(); b.observations = b.observations.filter(o => o.metadata[roleKey] !== rolle);
  expect(bewerte(b).join()).toContain(`Rolle ${rolle}`);
});
test("verschachtelte Metadaten funktionieren; widersprüchliche Formen nicht", () => {
  const b = fixture(); const o = b.observations[1]; const rolle = o.metadata[roleKey]; delete o.metadata[roleKey];
  o.metadata.agent_source = { subagent: { thread_spawn: { agent_role: rolle } } };
  expect(bewerte(b)).toEqual([]);
  o.metadata[roleKey] = "default"; expect(bewerte(b).join()).toContain("widersprüchlich");
});
test.each(["zyklus", "unverbunden", "identisch", "fehlend", "leer", "numerisch"])("Eltern-/Identitätsfehler %s", fall => {
  const b = fixture(); const o = b.observations[1];
  if (fall === "zyklus") o.metadata.parent_thread_id = o.metadata.agent_id;
  if (fall === "unverbunden") o.metadata.parent_thread_id = "fremd";
  if (fall === "identisch") o.metadata.agent_id = "main";
  if (fall === "fehlend") delete o.metadata.agent_id;
  if (fall === "leer") o.metadata.agent_id = "";
  if (fall === "numerisch") o.metadata.agent_id = 3;
  expect(bewerte(b).join()).toContain("Rolle probe-planer");
});
test("transitiver Zyklus und widersprüchliche Eltern werden abgelehnt", () => {
  const b = fixture(); b.observations[2].metadata.parent_thread_id = "probe-lens";
  expect(bewerte(b).join()).toContain("Rolle probe-lens");
  const other = fixture(); other.observations.push({ ...gen("probe-planer", "fremd", "probe-planer"), id: "zweiter-call" });
  expect(bewerte(other).join()).toContain("Rolle probe-planer");
});
test("ein Agent kann nicht als mehrere widersprüchliche Custom-Rollen attestiert werden", () => {
  const b = fixture();
  b.observations = b.observations.map(o => o.metadata.agent_role === "subagent" ? { ...o, metadata: { ...o.metadata, agent_id: "geteilt", parent_thread_id: "main" } } : o);
  expect(bewerte(b).join()).toContain("Rolle probe-planer");
});
test("mehrere gültige Main-Identitäten sind mehrdeutig", () => {
  const b = fixture(); b.observations.push(gen("zweiter-main", ""));
  expect(bewerte(b).join()).toContain("Hauptagent");
});
test.each(["main", "subagent"])("Elternkonflikt an der Root-Identität (%s) macht den Export ungültig", agent_role => {
  const b = fixture(), konflikt = gen("main", "fremd"); konflikt.id = "root-konflikt"; konflikt.metadata.agent_role = agent_role;
  b.observations.push(konflikt); expect(bewerte(b).join()).toContain("Hauptagent");
});
test("Root und Subagent dürfen nicht dieselbe widersprüchliche Actor-Klassifikation haben", () => {
  const b = fixture(), konflikt = gen("main", ""); konflikt.id = "klassifikations-konflikt"; konflikt.metadata.agent_role = "subagent";
  b.observations.push(konflikt); expect(bewerte(b).join()).toContain("Hauptagent");
});
test("eine Observation-ID kann nicht mehrere Generations und Rollen belegen", () => {
  const b = fixture(); for (const o of b.observations.filter(o => o.type === "GENERATION")) o.id = "dieselbe-id";
  expect(bewerte(b).join()).toContain("widersprüchliche Observation");
});
test("identische wiederholte Exportzeilen werden nur einmal gewertet", () => {
  const b = fixture(); b.observations.push(structuredClone(b.observations[1])); expect(bewerte(b)).toEqual([]);
});
test.each([undefined, null, {}, { input: -1, output: 2 }, { input: 1, output: 0 }, { input: 1, output: -1 }, { input: "1", output: 2 }, { input: 1, output: Infinity }, { input: NaN, output: 2 }])("ungültige Usage isoliert an einer Custom-Rolle", usage => {
  const b = fixture(); b.observations[1].usageDetails = usage;
  expect(bewerte(b).join()).toContain("Rolle probe-planer");
});
test.each([0, 1])("Input 0 ist bei Main und Subagent erlaubt", index => { const b = fixture(); b.observations[index].usageDetails = { input: 0, output: 1 }; expect(bewerte(b)).toEqual([]); });
test.each([null, { id: undefined }, { id: 4 }, { id: "" }, { metadata: undefined }, { metadata: {} }, { metadata: { agent_role: "main", agent_id: "" } }, { tags: "project:probe" }, { usageDetails: undefined }, { usageDetails: { input: -1, output: 2 } }, { usageDetails: { input: 1, output: 0 } }])("unvollständiger Hauptagent bleibt ungültig", override => {
  const b = fixture(), first = override === null ? null : { ...b.observations[0], ...override };
  expect(bewerte({ ...b, observations: [first, ...b.observations.slice(1)] }).join()).toContain("Hauptagent");
});
test.each([undefined, "", 4])("fehlende oder ungültige Root-Session stoppt", sessionId => {
  expect(bewerte({ ...fixture(), sessionId }).join()).toContain("Hauptagent");
});
test.each([{ rollen: 3 }, { tools: {} }])("Nichtarray-Inventar bleibt ungültig", override => {
  expect(bewerte({ ...fixture(), ...override }).join()).toContain("Laufzeitinventar");
});
test.each(["repo", "session", "id", "metadata", "typ"])("falsch zugeordnete Rollen-Observation %s", fall => {
  const b = fixture(), o = b.observations[1];
  if (fall === "repo") o.tags = ["project:fremd"];
  if (fall === "session") o.sessionId = "fremd";
  if (fall === "id") o.id = "";
  if (fall === "metadata") o.metadata = {};
  if (fall === "typ") o.type = "TOOL";
  expect(bewerte(b).join()).toContain("Rolle probe-planer");
});
test("reiner Spawn, fehlender Main und fehlendes Tool werden abgelehnt", () => {
  const b = fixture(); b.observations = b.observations.filter(o => o.type !== "GENERATION");
  expect(bewerte(b).join()).toContain("Hauptagent"); expect(bewerte(b).join()).toContain("Rolle probe-planer");
  const other = fixture(); other.observations = other.observations.filter(o => o.type !== "TOOL"); expect(bewerte(other).join()).toContain("Werkzeug");
});
test("Laufzeit, Inventar und unvollständige Daten sind eigenständige Fehler", () => {
  expect(bewerte({ ...fixture(), version: "0.1.0" })).toEqual(["Laufzeit nicht geprüft: erwartet Codex CLI 0.164.0"]);
  expect(bewerte({ ...fixture(), rollen: [], tools: [] }).join()).toContain("Laufzeitinventar");
  for (const v of [null, true, {}, { tracing: true }, { ...fixture(), observations: 3 }, { ...fixture(), sessionId: "" }]) expect(bewerte(v).length).toBeGreaterThan(0);
});
