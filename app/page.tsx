import Link from "next/link";

// Welcome page for the course platform. The audience is students who
// already purchased on BigCommerce — no pricing, no selling. The job
// of this page is momentum: get them signed in and into lesson one.
// Prospects who land here by accident get one quiet link to the
// public Evolve Global Academy page.

const MASTER = [
  ["Consultations", "Read hair loss patterns and guide clients to the right system with confidence."],
  ["Template & measurement", "Capture a perfect template so every system fits like it grew there."],
  ["Cutting-in & installation", "Blend, bond and style systems that are undetectable up close."],
  ["Maintenance & retention", "Keep clients coming back with service schedules and aftercare."],
];

const STEPS = [
  ["Sign in", "Use the same email you purchased with — a secure link arrives in your inbox. No password needed."],
  ["Open your course", "Your program is already on your dashboard, unlocked and waiting."],
  ["Learn at your pace", "Lifetime access, 60+ classes — rewatch any lesson, anytime, on any device."],
];

const INSTRUCTORS: [string, string, string][] = [
  ["Teresa Chu", "25+ years serving men and women facing hair loss. Owner of a renowned salon in the Greater Toronto Area.", "/evolve/instructor2-mobile.jpg"],
  ["Christina Luu", "11 years as a creative stylist, with half a decade specializing in hair loss solutions.", "/evolve/instructor3-mobile.jpg"],
  ["Cindy Enerio", "7+ years of product expertise on the Superhairpieces team.", "/evolve/instructor1-mobile.jpg"],
];

// Classroom photography from the Evolve Global Academy page.
const CLASSROOM = [
  "/evolve/inside_look1.jpg",
  "/evolve/inside_look3.jpg",
  "/evolve/inside_look4.jpg",
  "/evolve/inside_look6.jpg",
  "/evolve/inside_look8.jpg",
  "/evolve/inside_look11.jpg",
];

// Short hair-transformation clips (muted, looping).
const CLIPS = ["/evolve/men-1-short.mp4", "/evolve/men-2-short.mp4", "/evolve/men-3-short.mp4"];

export default function Home() {
  return (
    <div style={{ background: "var(--surface)" }}>
      {/* Header */}
      <div
        style={{
          background: "var(--nav-bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 32px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
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
        </div>
        <Link href="/login" className="btn" style={{ padding: "9px 20px", fontSize: 13 }}>
          Sign in
        </Link>
      </div>

      {/* Hero */}
      <div
        style={{
          background: "radial-gradient(1100px 500px at 50% -10%, #2c2c2c 0%, #141414 60%)",
          color: "#fff",
          textAlign: "center",
          padding: "84px 24px 90px",
        }}
      >
        <p className="page-eyebrow" style={{ color: "var(--gold)" }}>
          Welcome to Evolve Academy
        </p>
        <h1 style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.2, margin: "0 auto 18px", maxWidth: 780 }}>
          Your journey to hair replacement specialist starts now
        </h1>
        <p style={{ fontSize: 17, lineHeight: 1.65, color: "rgba(255,255,255,0.75)", maxWidth: 620, margin: "0 auto 34px" }}>
          You&apos;ve taken the step most stylists never do. Your classes are ready,
          your instructors are waiting — all that&apos;s missing is you.
        </p>
        <Link href="/login" className="btn" style={{ padding: "16px 40px", fontSize: 16 }}>
          Start learning →
        </Link>

        {/* Stats */}
        <div style={{ display: "flex", gap: 48, justifyContent: "center", flexWrap: "wrap", marginTop: 64 }}>
          {[
            ["60+", "classes, lifetime access"],
            ["10+", "years instructor experience"],
            ["20+", "years behind Superhairpieces"],
          ].map(([n, label]) => (
            <div key={label}>
              <div style={{ fontSize: 34, fontWeight: 800, color: "var(--gold)" }}>{n}</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)" }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Classroom photo strip */}
      <div style={{ background: "#141414", padding: "0 0 64px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
          {CLASSROOM.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src}
              src={src}
              alt="Inside an Evolve Academy class"
              style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: 10, display: "block" }}
            />
          ))}
        </div>
        <p style={{ textAlign: "center", fontSize: 12.5, color: "rgba(255,255,255,0.5)", margin: "18px 0 0", letterSpacing: 1 }}>
          INSIDE THE EVOLVE CLASSROOM
        </p>
      </div>

      {/* Getting started */}
      <div className="page-wrap" style={{ maxWidth: 1000 }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <p className="page-eyebrow">Getting started</p>
          <h2 style={{ fontSize: 28, fontWeight: 700, color: "var(--ink)", margin: 0 }}>
            You&apos;re three steps from your first lesson
          </h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 28 }}>
          {STEPS.map(([title, text], i) => (
            <div key={title} className="course-card" style={{ padding: "26px 26px 28px" }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#fff",
                  background: "var(--brand)",
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                }}
              >
                {i + 1}
              </div>
              <h3 style={{ fontSize: 16.5, fontWeight: 700, color: "var(--ink)", margin: "0 0 8px" }}>{title}</h3>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--muted)", margin: 0 }}>{text}</p>
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 36 }}>
          <Link href="/login" className="btn" style={{ padding: "14px 32px" }}>
            Go to my dashboard
          </Link>
        </div>
      </div>

      {/* What you'll master */}
      <div style={{ background: "#fff", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <div className="page-wrap" style={{ maxWidth: 1000 }}>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <p className="page-eyebrow">The road ahead</p>
            <h2 style={{ fontSize: 28, fontWeight: 700, color: "var(--ink)", margin: 0 }}>
              What you&apos;ll master
            </h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 28 }}>
            {MASTER.map(([title, text]) => (
              <div key={title}>
                <h3 style={{ fontSize: 15.5, fontWeight: 700, color: "var(--ink)", margin: "0 0 6px" }}>
                  <span style={{ color: "var(--brand)", marginRight: 8 }}>—</span>
                  {title}
                </h3>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--muted)", margin: 0 }}>{text}</p>
              </div>
            ))}
          </div>
          <p style={{ textAlign: "center", fontSize: 14, color: "var(--muted)", marginTop: 36 }}>
            Finish your program to earn your Superhairpieces certificate of completion — and unlock
            Tier&nbsp;1 professional pricing on systems and supplies for your future clients.
          </p>

          {/* Transformation clips */}
          <div style={{ marginTop: 48 }}>
            <p className="page-eyebrow" style={{ textAlign: "center" }}>The result you&apos;ll deliver</p>
            <h3 style={{ fontSize: 22, fontWeight: 700, color: "var(--ink)", margin: "0 0 24px", textAlign: "center" }}>
              Transformations like these will be your everyday work
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
              {CLIPS.map((src) => (
                <video
                  key={src}
                  src={src}
                  poster="/evolve/thumbnail.jpg"
                  autoPlay
                  loop
                  muted
                  playsInline
                  style={{ width: "100%", borderRadius: 12, display: "block", background: "#141414" }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Instructors */}
      <div className="page-wrap" style={{ maxWidth: 1000 }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <p className="page-eyebrow">Your instructors</p>
          <h2 style={{ fontSize: 28, fontWeight: 700, color: "var(--ink)", margin: 0 }}>
            You&apos;re learning from specialists
          </h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
          {INSTRUCTORS.map(([name, bio, photo]) => (
            <div key={name} className="course-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo}
                alt={name}
                style={{ width: "100%", height: 190, objectFit: "cover", display: "block" }}
              />
              <div style={{ padding: "18px 22px 22px" }}>
                <h3 style={{ fontSize: 16.5, fontWeight: 700, color: "var(--ink)", margin: "0 0 8px" }}>{name}</h3>
                <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--muted)", margin: 0 }}>{bio}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Final push */}
      <div style={{ background: "#141414", color: "#fff", textAlign: "center", padding: "64px 24px" }}>
        <h2 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 10px" }}>
          The best day to start was yesterday. The second best is today.
        </h2>
        <p style={{ fontSize: 15, color: "rgba(255,255,255,0.65)", margin: "0 0 28px" }}>
          Lesson one takes less time than a coffee break.
        </p>
        <Link href="/login" className="btn" style={{ padding: "15px 36px", fontSize: 15 }}>
          Start learning now
        </Link>
      </div>

      {/* Footer */}
      <div style={{ padding: "32px 24px 40px", textAlign: "center" }}>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 6px" }}>
          Questions about your course?{" "}
          <a href="mailto:support@superhairpieces.com" className="link" style={{ fontSize: 13 }}>
            support@superhairpieces.com
          </a>
        </p>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
          Not enrolled yet?{" "}
          <a href="https://superhairpieces.ca/evolve-global-academy" className="link" style={{ fontSize: 12 }}>
            Explore Evolve Global Academy
          </a>{" "}
          · © {new Date().getFullYear()} Superhairpieces
        </p>
      </div>
    </div>
  );
}
