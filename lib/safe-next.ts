// Where a sign-in should land afterwards.
//
// Only same-site absolute paths are honoured. A full URL, or a
// protocol-relative //evil.example, would turn the sign-in page into an open
// redirect worth putting in a phishing email. A leading "/\" is rejected for
// the same reason: some browsers treat a backslash as a slash.

export function safeNextPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return fallback;
  }
  return raw;
}
