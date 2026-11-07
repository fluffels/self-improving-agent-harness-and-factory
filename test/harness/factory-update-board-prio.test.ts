/* @harness-waechter – Fitness-Function, im geschützten test/harness/. */
/* Board-Top des Update-Meldetickets: factory-update.yml platziert ein NEU angelegtes Issue wie dependabot-inbox.yml
 * per board-place.mjs an die oberste Position (Notfall-Art `update`), ohne Token nur eine Warnung. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const yml = readFileSync(fileURLToPath(new URL("../../.github/workflows/factory-update.yml", import.meta.url)), "utf8");

describe("Factory-Update-Workflow platziert das Meldeticket oben", () => {
  test("liest PROJECT_TOKEN und die Nummer aus der create-Ausgabe, ruft board-place mit Art update", () => {
    assert.match(yml, /PROJECT_TOKEN:\s*\$\{\{\s*secrets\.PROJECT_TOKEN\s*\}\}/);
    assert.ok(yml.includes("new_url=$(gh issue create"), "die create-Ausgabe muss als URL erfasst werden");
    assert.ok(yml.includes('nr="${new_url##*/}"'));
    assert.ok(yml.includes('node scripts/board-place.mjs --notfall update --top "$nr"'));
    assert.ok(yml.indexOf("new_url=$(gh issue create") < yml.indexOf("node scripts/board-place.mjs"), "die Platzierung folgt dem Anlegen");
    assert.doesNotMatch(yml, /kein PROJECT_TOKEN/, "der Header nennt den Token nicht mehr als überflüssig");
  });

  test("der Ablauftext verlangt keinen Checkout des Tags (der Sync liest den Tag per git)", () => {
    assert.doesNotMatch(yml, /auf den Tag auschecken/);
    assert.match(yml, /ein Checkout des Tags ist nicht nötig, der Sync liest den Tag per git/);
  });

  test("ohne Token nur Warnung, kein Abbruch; die Platzierung nur im create-Zweig", () => {
    assert.ok(yml.includes('if [ -z "${PROJECT_TOKEN:-}" ]'));
    assert.match(yml, /::warning::[^\n]*PROJECT_TOKEN/);
    const kommentar = yml.indexOf('gh issue comment "$existing"');
    assert.ok(kommentar < yml.indexOf("node scripts/board-place.mjs"), "beim Ergänzen eines bestehenden Issues keine Platzierung");
  });
});
