// ── 8Bit API base URL ────────────────────────────────────────────────────────
// PRD and TEST differ only by port: PRD = 8182, TEST/UAT = 7172.
//
// Which one is used is decided by ONE knob, `API_ENV` ("test" | "prd"):
//   • `.env.development`  → API_ENV=test  (loaded automatically by `npm run dev`)
//   • `.env.production`   → API_ENV=prd   (loaded automatically by `next build`/`start`)
//   • `.env.local`        → optional per-machine override; wins over the above.
//
// So the normal case needs zero edits. To temporarily point local dev at PRD,
// add a single line `API_ENV=prd` to `.env.local`. To hit a one-off host that
// isn't test/prd, set the full `API_8BIT_BASE_URL` — it overrides everything.

const API_HOSTS = {
  test: "https://oi.beger.co.th:7172/8bit",
  prd: "https://oi.beger.co.th:8182/8bit",
} as const;

export type ApiEnv = keyof typeof API_HOSTS;

/** The resolved API environment name ("test" | "prd" | "custom"). */
export function current8BitEnv(): ApiEnv | "custom" {
  if (process.env.API_8BIT_BASE_URL?.trim()) return "custom";
  const env = (process.env.API_ENV ?? "test").trim().toLowerCase();
  return env === "prd" ? "prd" : "test";
}

/** Base URL for the 8Bit API, trailing slash stripped. */
export function get8BitApiBaseUrl(): string {
  const explicit = process.env.API_8BIT_BASE_URL?.trim();
  const base = explicit || API_HOSTS[current8BitEnv() as ApiEnv] || API_HOSTS.test;
  return base.replace(/\/$/, "");
}
