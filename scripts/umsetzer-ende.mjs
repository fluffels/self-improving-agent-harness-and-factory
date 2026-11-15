// Dünner Einstieg (factory#515): `node scripts/umsetzer-ende.mjs ...`; Ablauf und Exit-Codes in `umsetzer-schritte-lib.mjs`.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { umsetzerCli } from "./umsetzer-schritte-lib.mjs";

if (istDirektaufruf(import.meta.url)) {
  const e = umsetzerCli("ende", process.argv.slice(2), { wurzel: join(dirname(fileURLToPath(import.meta.url)), "..") });
  process.stdout.write(e.out);
  process.stderr.write(e.err);
  process.exitCode = e.code;
}
