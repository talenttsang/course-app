import Link from "next/link";
import { SignOutButton } from "./signout-button";

// Shared top navigation: Superhairpieces logo + Evolve Academy wordmark
// on the left, a context label (and optionally the signed-in email) on
// the right.
//
// Sign out lives here rather than on individual pages, because it was on
// the dashboard alone: every admin page, every lesson, and the "you are
// not staff" screen left you with no way out but clearing cookies. The
// last of those is the worst — signed in as the wrong account and unable
// to switch.
//
// Shown only when an email is passed, which is the nav's only signal that
// anyone is signed in at all.
export function TopNav({ label, email }: { label: string; email?: string }) {
  return (
    <div
      style={{
        background: "var(--nav-bg)",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 32px",
        gap: 16,
      }}
    >
      <Link
        href="/dashboard"
        style={{ display: "flex", alignItems: "center", gap: 14, textDecoration: "none" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/shp-logo.svg" alt="Superhairpieces" style={{ height: 24, display: "block" }} />
        <span
          style={{
            borderLeft: "1px solid rgba(255,255,255,0.25)",
            paddingLeft: 14,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 3,
            color: "var(--gold)",
          }}
        >
          EVOLVE ACADEMY
        </span>
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 18, minWidth: 0 }}>
        {email && (
          <span
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.55)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 220,
            }}
          >
            {email}
          </span>
        )}
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 1.5,
            color: "rgba(255,255,255,0.75)",
            border: "1px solid rgba(255,255,255,0.25)",
            borderRadius: 999,
            padding: "5px 14px",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        {email && <SignOutButton tone="nav" />}
      </div>
    </div>
  );
}

// YouTube stopped honoring showinfo=0 a few years ago, so the title
// bar and channel avatar can't be removed through URL params anymore.
// This crops it out with CSS instead: the iframe renders a bit taller
// than its visible box, shifted up so the top title strip lands
// outside the clipped container. Playback controls at the bottom stay
// untouched since students still need them.
//
// This is a cosmetic barrier, not real protection — someone using the
// browser's dev tools can still find the video ID either way.
export function ProtectedPlayer({
  sourceType,
  sourceId,
  title,
}: {
  sourceType: string;
  sourceId: string;
  title: string;
}) {
  // Written material (the manual, consultation form, adhesive charts) lives
  // in Drive. Its viewer has no title strip to hide, so it is embedded
  // plainly rather than through the crop below.
  if (sourceType === "pdf") {
    return (
      <iframe
        style={{ width: "100%", height: "100%", border: "none", background: "#0d0d0d" }}
        src={`https://drive.google.com/file/d/${sourceId}/preview`}
        title={title}
        allow="autoplay"
      />
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <iframe
        style={{
          position: "absolute",
          top: -60,
          left: 0,
          width: "100%",
          height: "calc(100% + 60px)",
          border: "none",
        }}
        src={`https://www.youtube-nocookie.com/embed/${sourceId}?rel=0&modestbranding=1&iv_load_policy=3`}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}
