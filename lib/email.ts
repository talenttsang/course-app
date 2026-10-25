import nodemailer from "nodemailer";
import { emailCopy, DEFAULT_LOCALE, type Locale, type WelcomeKind } from "@/lib/i18n";

// Transactional email for the academy: the purchase welcome, and password
// reset links. Sent through our own SMTP so we control the design and
// aren't subject to Supabase's built-in email limits (2/hour on the free
// plan) or its template restrictions.
//
// SMTP credentials come from env vars set on the Cloud Run service:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// If SMTP_HOST or SMTP_PASS is missing we skip sending rather than throw —
// course access must never depend on the mailer being configured.

const BRAND = "#b50027";
const GOLD = "#dead00";

export function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PASS);
}

// The branded shell both emails sit inside: dark header with the logo,
// white body, support footer.
//
// Every coloured cell carries BOTH a bgcolor attribute and an explicit
// background-color. Several mobile clients drop the CSS `background`
// shorthand, which turned the dark header white and hid the white logo —
// and would have done the same to the red button, leaving white text on
// white. The logo image also carries the header colour itself, so it stays
// legible even if the cell behind it is lost.
function shell(opts: { logoUrl: string; heading: string; body: string; locale: Locale }) {
  const t = emailCopy(opts.locale);
  return `<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f3f1" style="background-color:#f4f3f1;padding:32px 0;font-family:Arial,Helvetica,sans-serif;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

<tr><td bgcolor="#141414" style="background-color:#141414;border-radius:12px 12px 0 0;padding:26px 32px;text-align:center;">
  <img src="${opts.logoUrl}" alt="Superhairpieces" width="160" height="40" style="display:block;margin:0 auto 8px;border:0;">
  <span style="color:${GOLD};font-size:11px;letter-spacing:4px;font-weight:bold;">EVOLVE ACADEMY</span>
</td></tr>

<tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:36px 40px 30px;">
  <h1 style="margin:0 0 12px;font-size:22px;color:#1c1c1c;">${opts.heading}</h1>
  ${opts.body}
</td></tr>

<tr><td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:0 0 12px 12px;border-top:1px solid #ececec;padding:22px 40px 26px;">
  <p style="margin:0;font-size:12.5px;line-height:1.6;color:#9a9a9a;">
    ${t.footerQuestions}
    <a href="mailto:support@superhairpieces.com" style="color:${BRAND};">support@superhairpieces.com</a>.
  </p>
</td></tr>

<tr><td style="padding:18px;text-align:center;font-size:11px;color:#9a9a9a;">
  &copy; ${new Date().getFullYear()} Superhairpieces &middot; Evolve Academy
</td></tr>

</table>
</td></tr></table>`;
}

function button(href: string, label: string) {
  return `<table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;"><tr><td bgcolor="${BRAND}" style="background-color:${BRAND};border-radius:8px;">
    <a href="${href}" style="display:inline-block;padding:15px 38px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;">${label}</a>
  </td></tr></table>`;
}

// Exported so the layout can be rendered and eyeballed without sending mail.
export function renderWelcomeEmail(opts: {
  courseTitles: string[];
  signInUrl: string;
  loginUrl: string;
  logoUrl: string;
  linkHours: number;
  locale?: Locale;
  kind?: WelcomeKind;
}) {
  const { courseTitles, signInUrl, loginUrl, logoUrl, linkHours } = opts;
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const t = emailCopy(locale);
  const migrating = opts.kind === "migration";
  const granted = opts.kind === "granted";
  const staff = opts.kind === "staff";
  const courseList = courseTitles
    .map(
      (t) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #ececec;font-size:15px;color:#1c1c1c;">
           <span style="color:${BRAND};font-weight:bold;">&#10003;</span>&nbsp;${escapeHtml(t)}
         </td></tr>`
    )
    .join("");

  return shell({
    logoUrl,
    locale,
    heading: staff
      ? t.staffHeading
      : granted
        ? t.grantedHeading
        : migrating
          ? t.migrationHeading
          : t.welcomeHeading,
    body: `
  <p style="margin:0 0 24px;font-size:14px;line-height:1.65;color:#6d6d6d;">
    ${staff ? t.staffIntro : granted ? t.grantedIntro : migrating ? t.migrationIntro : t.welcomeIntro}
  </p>

  ${
    // A colleague given the keys may hold no course at all, and an empty
    // list under "YOUR COURSES" reads as something having gone wrong.
    courseTitles.length === 0
      ? ""
      : `<p style="margin:0 0 6px;font-size:11px;letter-spacing:2px;color:#9a9a9a;font-weight:bold;">${
          migrating || granted || staff ? t.migrationCourseLabel : t.nowInYourAccount
        }</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">${courseList}</table>`
  }

  ${button(
    signInUrl,
    staff ? t.staffButton : migrating || granted ? t.migrationButton : t.startFirstLesson
  )}

  <p style="margin:0 0 22px;font-size:12.5px;line-height:1.6;color:#9a9a9a;text-align:center;">
    ${t.buttonWorksFor(linkHours)}
  </p>

  <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #ececec;">
    <tr><td style="padding-top:22px;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#1c1c1c;">${t.signingInLaterTitle}</p>
      <p style="margin:0;font-size:13px;line-height:1.65;color:#6d6d6d;">
        ${t.signingInLaterBody(stripScheme(loginUrl), loginUrl, BRAND)}
      </p>
    </td></tr>
  </table>`,
  });
}

// Password reset, sent through the same SMTP as everything else.
export function renderPasswordResetEmail(opts: {
  resetUrl: string;
  logoUrl: string;
  linkHours: number;
  locale?: Locale;
}) {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const t = emailCopy(locale);
  return shell({
    logoUrl: opts.logoUrl,
    locale,
    heading: t.resetHeading,
    body: `
  <p style="margin:0 0 26px;font-size:14px;line-height:1.65;color:#6d6d6d;">
    ${t.resetIntro(opts.linkHours)}
  </p>

  ${button(opts.resetUrl, t.resetButton)}

  <p style="margin:24px 0 0;font-size:12.5px;line-height:1.6;color:#9a9a9a;">
    ${t.resetIgnore}
  </p>`,
  });
}

function renderWelcomeText(opts: {
  courseTitles: string[];
  signInUrl: string;
  loginUrl: string;
  linkHours: number;
  locale: Locale;
  kind?: WelcomeKind;
}) {
  const t = emailCopy(opts.locale);
  const migrating = opts.kind === "migration";
  const granted = opts.kind === "granted";
  const staff = opts.kind === "staff";
  return [
    staff
      ? t.textStaffHeading
      : granted
        ? t.textGrantedHeading
        : migrating
          ? t.textMigrationHeading
          : t.textWelcomeHeading,
    "",
    staff
      ? t.textStaffIntro
      : granted
        ? t.textGrantedIntro
        : migrating
          ? t.textMigrationIntro
          : t.textWelcomeIntro,
    "",
    ...(opts.courseTitles.length === 0
      ? []
      : [t.textNowInYourAccount, ...opts.courseTitles.map((title) => `  - ${title}`)]),
    "",
    t.textStartLesson(opts.linkHours),
    opts.signInUrl,
    "",
    t.textSigningInLater(opts.loginUrl),
    "",
    t.textQuestions,
    "",
    "(c) Superhairpieces - Evolve Academy",
  ].join("\n");
}

async function send(opts: { to: string; subject: string; text: string; html: string }) {
  if (!smtpConfigured()) {
    console.warn("[email] SMTP not configured — skipping send");
    return { sent: false, reason: "smtp-not-configured" as const };
  }

  const port = Number(process.env.SMTP_PORT ?? 587);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 587 upgrades via STARTTLS instead
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from:
      process.env.SMTP_FROM ??
      `"Evolve Academy by Superhairpieces" <${process.env.SMTP_USER}>`,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });

  return { sent: true as const };
}

function logoUrl(origin: string) {
  // PNG, not the site's SVG: Gmail and Outlook don't render SVG at all.
  return `${origin}/shp-logo-email.png`;
}

export async function sendWelcomeEmail(opts: {
  to: string;
  courseTitles: string[];
  signInUrl: string;
  origin: string;
  linkHours: number;
  locale?: Locale;
  kind?: WelcomeKind;
}) {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const view = {
    kind: opts.kind,
    courseTitles: opts.courseTitles,
    signInUrl: opts.signInUrl,
    loginUrl: `${opts.origin}/login`,
    logoUrl: logoUrl(opts.origin),
    linkHours: opts.linkHours,
    locale,
  };

  return send({
    to: opts.to,
    subject:
      opts.kind === "staff"
        ? emailCopy(locale).staffSubject
        : opts.kind === "granted"
          ? emailCopy(locale).grantedSubject
          : opts.kind === "migration"
            ? emailCopy(locale).migrationSubject
            : emailCopy(locale).welcomeSubject,
    text: renderWelcomeText(view),
    html: renderWelcomeEmail(view),
  });
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  resetUrl: string;
  origin: string;
  linkHours: number;
  locale?: Locale;
}) {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const t = emailCopy(locale);
  return send({
    to: opts.to,
    subject: t.resetSubject,
    text: [...t.textReset(opts.resetUrl, opts.linkHours), "", t.textQuestions, "", "(c) Superhairpieces - Evolve Academy"].join("\n"),
    html: renderPasswordResetEmail({
      resetUrl: opts.resetUrl,
      logoUrl: logoUrl(opts.origin),
      linkHours: opts.linkHours,
      locale,
    }),
  });
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripScheme(url: string) {
  return url.replace(/^https?:\/\//, "");
}
