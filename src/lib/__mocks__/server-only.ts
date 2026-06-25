// Vitest stub for the `server-only` package.
//
// The real `server-only` package throws when imported from a Client Component.
// In the Vitest environment we are not inside Next.js request routing, so we
// alias `server-only` to this empty module during tests. This lets the
// `import "server-only"` guard in `src/lib/env.ts` and
// `src/server/db/postgres-config.ts` be unit-tested.
//
// The production build (next build) still uses the real `server-only` package
// and enforces the guard in actual client/server boundaries.
export {};
