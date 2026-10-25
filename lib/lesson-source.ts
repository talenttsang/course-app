// A lesson is either a YouTube video or a PDF held in Google Drive — the
// Evolve course is roughly three-quarters video and one-quarter written
// material (the manual, consultation form, adhesive charts, aftercare
// guides), so both are first-class.
export type LessonSource = { type: "youtube" | "pdf"; id: string };

// Accepts whatever staff paste from the address bar and works out which
// kind of lesson it is.
export function parseLessonSource(input: string): LessonSource | null {
  const s = input.trim();
  if (!s) return null;

  const driveId = parseDriveId(s);
  if (driveId) return { type: "pdf", id: driveId };

  const videoId = parseYouTubeId(s);
  if (videoId) return { type: "youtube", id: videoId };

  return null;
}

// Google Drive share links: /file/d/<id>/view, /open?id=<id>, /uc?id=<id>.
export function parseDriveId(input: string): string | null {
  const s = input.trim();
  if (!/drive\.google\.com|docs\.google\.com/.test(s)) return null;

  const path = s.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  if (path) return path[1];

  try {
    const url = new URL(s.startsWith("http") ? s : `https://${s}`);
    const id = url.searchParams.get("id");
    if (id && /^[A-Za-z0-9_-]+$/.test(id)) return id;
  } catch {
    return null;
  }
  return null;
}

// Where a lesson is actually watched or read.
export function embedUrl(source: LessonSource) {
  return source.type === "pdf"
    ? `https://drive.google.com/file/d/${source.id}/preview`
    : `https://www.youtube-nocookie.com/embed/${source.id}?rel=0&modestbranding=1&iv_load_policy=3`;
}

// Accepts whatever staff paste from the address bar — watch links, youtu.be
// short links, embeds, Shorts, live URLs — or a bare 11-character video ID.
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (isId(s)) return s;

  let url: URL;
  try {
    url = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") return idOrNull(url.pathname.slice(1));

  if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    const v = url.searchParams.get("v");
    if (v) return idOrNull(v);
    const m = url.pathname.match(/^\/(?:embed|shorts|v|live)\/([^/?#]+)/);
    if (m) return idOrNull(m[1]);
  }
  return null;
}

function isId(s: string) {
  return /^[A-Za-z0-9_-]{11}$/.test(s);
}

function idOrNull(s: string) {
  return isId(s) ? s : null;
}

// Course slugs become the lesson URL, so keep them lowercase and hyphenated.
export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019]/g, "") // women's -> womens, not women-s
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
