/**
 * Die geschlossene Liste der npm-Skripte, die jedes Bezieher-Repo aus der Grundausstattung hat (factory#177): nur diese darf verteilter Text
 * (Besitz-`.md`, Fix-Texte, Laufzeit-Strings verteilter `.mjs`) als `npm run <x>` nennen, alles andere steht als `node scripts/<x>.mjs`.
 * Einzige Quelle der Liste; sie wächst nur zusammen mit einer Bezieher-Migrationszeile im Commit.
 */
export const BEZIEHER_NPM_SKRIPTE: ReadonlySet<string> = new Set(["check:docdrift", "check:docmap", "check:factorydrift", "check:internalrefs", "check:size", "skills:sync"]);
