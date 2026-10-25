import { describe, expect, it } from "vitest";
import { describeError, describeErrorForLog } from "@/lib/redact";

describe("describeError", () => {
  it("keeps the code, which is the part that locates the fault", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ESOCKET" });
    expect(describeError(err)).toBe("ESOCKET: connect ECONNREFUSED 127.0.0.1:1");
  });

  it("removes a secret", () => {
    const err = new Error("535 auth failed for mailer@example.com with hunter2");
    const out = describeError(err, ["mailer@example.com", "hunter2"]);
    expect(out).not.toContain("hunter2");
    expect(out).toContain("[redacted]");
  });

  // The bug this file exists for: the message used to be trimmed to 160
  // characters first, so a secret straddling the cut lost its tail and no
  // longer matched. The leading half then travelled to the chat space
  // looking redacted.
  it("removes a secret that straddles the length limit", () => {
    // 19 paddings is 152 characters, so the secret starts before the 160th
    // and runs past it. At 20 it started exactly on the cut, which the old
    // trim-first code also passed — the test agreed with the bug.
    const secret = "S3cret-" + "x".repeat(40);
    const err = new Error("padding ".repeat(19) + secret + " trailing");
    const out = describeError(err, [secret]);
    expect(out).not.toContain("S3cret-");
    expect(out).not.toContain(secret.slice(0, 10));
  });

  // The credential does not have to appear as itself to be disclosed. SMTP
  // AUTH puts it on the wire base64-encoded and a rejecting server quotes
  // that back, so stripping the plaintext alone left it in the alert one
  // trivial decode away.
  it("removes a secret the server quoted back base64-encoded", () => {
    const pass = "hunter2";
    const encoded = Buffer.from(pass, "utf8").toString("base64");
    const err = new Error(`535 5.7.8 authentication failed: ${encoded}`);
    const out = describeError(err, [pass]);
    expect(out).not.toContain(encoded);
    expect(out).toContain("[redacted]");
  });

  it("removes an AUTH blob even when the secret behind it is unknown", () => {
    // AUTH PLAIN sends \0user\0pass as one blob, so neither secret appears
    // in it whole and neither can be matched. The blob goes anyway.
    const blob = Buffer.from("\u0000mailer@example.com\u0000hunter2", "utf8").toString("base64");
    const out = describeError(new Error(`535 rejected AUTH PLAIN ${blob}`));
    expect(out).not.toContain(blob);
    expect(out).toContain("[redacted]");
  });

  it("keeps the diagnosis readable", () => {
    // Blunt redaction is only acceptable while the part an alert is read for
    // survives it.
    const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ESOCKET" });
    expect(describeError(err, ["user", "pass"])).toBe("ESOCKET: connect ECONNREFUSED 127.0.0.1:1");
  });

  it("removes an address the server quoted back", () => {
    const err = new Error("550 5.1.1 <student@superhairpieces.com> recipient rejected");
    const out = describeError(err);
    expect(out).not.toContain("student@superhairpieces.com");
    expect(out).toContain("[address]");
  });

  it("still trims, so an alert cannot be flooded", () => {
    expect(describeError(new Error("z".repeat(500))).length).toBeLessThanOrEqual(170);
  });

  // Vera's case. The lookbehind excluded "=", so a blob written straight
  // after one -- the common framing -- was skipped, and a long enough
  // username pushed the whole AUTH PLAIN payload past the explicit
  // per-secret pass. The password decoded cleanly out of the alert.
  it("removes an AUTH blob written straight after an equals sign", () => {
    const user = "mailer-account-21x";
    const pass = "S3cret-mailer-pass";
    const blob = Buffer.from(`\u0000${user}\u0000${pass}`, "utf8").toString("base64");
    const out = describeError(new Error(`535 5.7.8 rejected auth=${blob} for session 9`), [user, pass]);

    for (const run of out.match(/[A-Za-z0-9+/]{16,}={0,2}/g) ?? []) {
      expect(Buffer.from(run, "base64").toString("utf8")).not.toContain(pass);
    }
    expect(out).toContain("[redacted]");
  });

  it("removes a blob whose secret it was never given", () => {
    // Nothing innocent decodes to bytes with a NUL in them, so the AUTH
    // PLAIN framing is enough on its own.
    const blob = Buffer.from("\u0000someone\u0000unknown-pass", "utf8").toString("base64");
    expect(describeError(new Error(`535 ${blob}`))).not.toContain(blob);
  });

  it("leaves file paths alone, so the diagnosis survives", () => {
    const err = Object.assign(
      new Error("ENOENT: no such file or directory, open '/app/.next/standalone/server.js'"),
      { code: "ENOENT" }
    );
    expect(describeError(err)).toContain("/app/.next/standalone/server.js");
  });

  it("does not cut off inside a marker", () => {
    // The trim used to land mid-"[redacted]" and print "[redacte", which
    // reads like a leak even when it is not one.
    const secret = "S3cret-" + "x".repeat(40);
    const err = new Error("padding ".repeat(19) + secret + " trailing");
    expect(describeError(err, [secret])).not.toMatch(/\[[A-Za-z]*$/);
  });

  it("keeps the stack for the log, with the message redacted", () => {
    const pass = "S3cret-mailer-pass";
    const err = new Error(`535 auth failed with ${pass}`);
    const out = describeErrorForLog(err, [pass]);
    expect(out).not.toContain(pass);
    expect(out).toContain("[redacted]");
    // The frames are the half worth keeping, and the reason this exists.
    expect(out).toMatch(/\n\s+at\s/);
  });

  // Vera's second and third cases, which are one case: whatever is glued to
  // the blob changes where the pattern can match and what it decodes to.
  //
  // A character in FRONT shifts the run, and base64 read one character out
  // of step is unrecognisable. A character AFTER padding used to make the
  // pattern match nothing at all -- the padding is consumed, the next
  // character was forbidden, and the whole attempt backtracked out.
  //
  // This sweeps both edges rather than listing the framings I happened to
  // think of. The prefix round was fixed by varying only prefixes, and the
  // suffix case was sitting right next to it. The username lengths matter
  // because at 19 and 22 the password happens to encode on a three-byte
  // boundary, which hid the bug behind an unrelated check.
  it("removes an AUTH blob however it is glued into the message", () => {
    const pass = "S3cret-mailer-pass";
    const edges = ["", "/", "x", "+", "0", "=", "."];

    for (const prefix of edges) {
      for (const suffix of edges) {
        for (const len of [17, 18, 19, 20, 21, 22]) {
          const user = ("mailer" + "x".repeat(len)).slice(0, len);
          const blob = Buffer.from(`\u0000${user}\u0000${pass}`, "utf8").toString("base64");
          const where = `prefix ${JSON.stringify(prefix)}, suffix ${JSON.stringify(suffix)}, username ${len}`;
          const out = describeError(new Error(`535 rejected ${prefix}${blob}${suffix} end`), [user, pass]);

          for (const run of out.match(/[A-Za-z0-9+/]{12,}={0,2}/g) ?? []) {
            for (let offset = 0; offset < 4; offset++) {
              expect(Buffer.from(run.slice(offset), "base64").toString("utf8"), where).not.toContain(pass);
            }
          }
        }
      }
    }
  });

  // Reading at four offsets is four chances to see a NUL that was never
  // there. If it starts firing on ordinary text, the previous round's
  // complaint comes straight back.
  it("still leaves ordinary paths and text alone", () => {
    const innocent = [
      "ENOENT: no such file or directory, open '/app/.next/standalone/server.js'",
      "Cannot find module '/app/node_modules/@supabase/supabase-js/dist/main/index.js'",
      "connect ETIMEDOUT smtp.gmail.com:587 after 30000ms of inactivity",
      "/workspace/scripts/later-build.sh: line 42: unexpected token near newline",
    ];
    for (const message of innocent) {
      expect(describeError(new Error(message))).not.toContain("[redacted]");
    }
  });

  it("keeps a multi-line server reply on one line", () => {
    // Gmail answers over several lines; a newline breaks the one-field-per-
    // line shape the chat message is built from, and splits a log line.
    const err = new Error("535-5.7.8 Username and Password not accepted\n535 5.7.8 Learn more at\n535 5.7.8 https://support.google.com");
    const out = describeError(err);
    expect(out).not.toContain("\n");
    expect(out).toContain("535-5.7.8 Username and Password not accepted 535 5.7.8");
  });

  // Vera's case. A webhook URL carries its credential in the query string,
  // and Node's "Failed to parse URL from ..." quotes the URL back with the
  // scheme stripped -- so the literal pass, which matches the env value
  // exactly, misses it. The parameter is the form it travels in.
  it("removes a credential carried in a URL query string", () => {
    const hook = "https://chat.googleapis.com/v1/spaces/AAA/messages?key=SECRETKEY123&token=SECRETTOKEN456";
    // As Node reports it: the scheme is gone, so the full value no longer matches.
    const quoted = hook.replace("https://", "");
    const out = describeError(new Error(`Failed to parse URL from ${quoted}`), [hook]);

    expect(out).not.toContain("SECRETKEY123");
    expect(out).not.toContain("SECRETTOKEN456");
    expect(out).toContain("key=[redacted]");
    expect(out).toContain("token=[redacted]");
  });

  it("keeps the part of a URL that says where it was going", () => {
    const out = describeError(new Error("connect ECONNREFUSED chat.googleapis.com/v1/spaces/AAA?key=abc"));
    expect(out).toContain("chat.googleapis.com");
  });

  it("consumes all the padding, so no part of a blob is left showing", () => {
    // A third "=" used to backtrack to a shorter run and print one character.
    const blob = Buffer.from("\u0000someone\u0000unknown-pass", "utf8").toString("base64");
    const out = describeError(new Error(`535 ${blob}===`));
    expect(out).not.toMatch(/[A-Za-z0-9+/]{2,}=/);
  });

  it("says something useful when handed a non-error", () => {
    expect(describeError("a string")).toBe("unknown error");
    expect(describeError(undefined)).toBe("unknown error");
  });
});
