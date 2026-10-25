// Text that is about to leave the process -- into a chat space, a log, an
// alert -- after an error. Build logs and chat spaces are not private
// places, and an error message repeats whatever it was handed.

// Anything shaped like an address. An SMTP rejection quotes the recipient
// back ("550 ... <someone@example.com> ... "), and that recipient is a
// customer.
const ADDRESS = /[^\s<>"',;]+@[^\s<>"',;]+/g;

// A credential does not only travel as itself. SMTP AUTH puts it on the wire
// base64-encoded, and a server that rejects it quotes the blob straight back
// ("535 5.7.8 ... AHVzZXIAcGFzcw==", or "... auth=AHVzZXIAcGFzcw=="), so
// removing the plaintext alone leaves the credential one decode away.
//
// Neither edge of this pattern may exclude an ordinary base64 character.
// The lookbehind did, and `auth=` was enough to carry a username and
// password through untouched. The lookahead did too, and a padded blob with
// anything glued after it -- "<blob>=/" -- matched nothing at all: the
// padding is consumed, the next character is forbidden, and the whole
// attempt backtracks out. A pattern that finds nothing redacts nothing.
//
// So the padding is simply consumed, however much of it there is. An
// earlier version allowed two "=" and forbade a third, which on a malformed
// blob backtracked to a shorter run and left one character of it showing.
// Nothing is recoverable from one character, but a redaction that prints
// part of its subject invites the reader to assume the rest is safe too.
const BASE64_RUN = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{16,}=*/g;

// Short secrets encode to short blobs -- base64("hunter2") is 12 characters,
// under the run length below -- so each secret is also removed in the form
// the wire carries it. This is what catches AUTH LOGIN, which sends the
// username and the password as two separate, smaller blobs.
function forms(secret: string) {
  const encoded = Buffer.from(secret, "utf8").toString("base64");
  return encoded === secret ? [secret] : [secret, encoded];
}

// AUTH PLAIN sends \0authcid\0password, so the payload is: a NUL first, at
// least one more NUL after it, and printable text in between and after --
// it is a username and a password, not random bytes.
//
// All three parts are needed. "Contains a NUL anywhere" fired on about a
// fifth of path-like text, and `chat.googleapis.com/v1/spaces/AAA` was being
// redacted as a credential; requiring the leading NUL alone still fired on
// one in twenty. Text is the part that makes it rare, because base64 read at
// the wrong offset produces bytes that are mostly not printable.
function looksLikeAuthPlain(buf: Buffer) {
  if (buf.length < 4 || buf[0] !== 0 || !buf.includes(0, 1)) return false;
  for (const byte of buf) {
    const printable = byte === 0 || (byte >= 0x20 && byte <= 0x7e) || byte >= 0xc0;
    if (!printable) return false;
  }
  return true;
}

function decode(run: string) {
  try {
    const buf = Buffer.from(run, "base64");
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

// How far into this run the hidden thing starts, or -1.
//
// A blob is not always written on a clean boundary. One stray base64
// character in front of it -- a "/" from a path-like prefix, say -- makes
// the run begin a character early, and base64 read one character out of
// step is unrecognisable: the NUL framing vanishes and so does the secret.
// Reading from the wrong offset was enough to carry a whole AUTH PLAIN
// payload, username and password, straight through. Base64 realigns every
// four characters, so the question has to be asked four times.
//
// Returning the offset rather than a yes/no keeps whatever came before the
// blob -- usually a path separator, which is worth reading.
function hiddenAt(run: string, secrets: string[]) {
  for (let offset = 0; offset < 4 && offset < run.length; offset++) {
    const buf = decode(run.slice(offset));
    if (!buf) continue;
    if (looksLikeAuthPlain(buf)) return offset;
    const utf8 = buf.toString("utf8");
    const latin1 = buf.toString("latin1");
    if (secrets.some((s) => s && (utf8.includes(s) || latin1.includes(s)))) return offset;
  }
  return -1;
}

/**
 * What, if anything, of this run of base64 characters has to go.
 *
 * Two certainties first. AUTH PLAIN frames its payload as \0user\0pass, and
 * nothing innocent decodes to bytes containing a NUL; and a run that decodes
 * to something holding a known secret is that secret, whatever it looks
 * like. Both are checked at every offset base64 can realign on, so they hold
 * however the blob is written and whatever is glued in front of it. These
 * are what actually cover us.
 *
 * Then a guess, for a blob whose secret we were never given: random bytes
 * look random, and a file path or an English word does not. Runs containing
 * "/" are left to the certainties alone, because that is almost always a
 * path, and redacting those takes the diagnosis with them.
 *
 * The guess is weak and worth naming as such: a key that is hex, or all
 * lowercase and digits, always passes it, and a random blob passes it
 * roughly a third of the time. It is a backstop for a credential nobody
 * told us about, not a line of defence. The answer to that case is to pass
 * the secret in, not to guess harder -- which is why the service role key
 * now goes in alongside the mail credentials.
 */
function hidePart(run: string, secrets: string[]) {
  const offset = hiddenAt(run, secrets);
  if (offset >= 0) return run.slice(0, offset) + "[redacted]";
  if (run.includes("/")) return run;
  const looksRandom = /[a-z]/.test(run) && /[A-Z]/.test(run) && /[0-9]/.test(run);
  return looksRandom ? "[redacted]" : run;
}

// A webhook URL carries its credential in the query string, and an error
// about a URL quotes the URL. The literal pass only catches it when the
// value matches exactly -- and Node's "Failed to parse URL from ..." drops
// the scheme, so it does not. The parameter is the form it travels in.
const URL_CREDENTIAL = /([?&](?:key|token|secret|password|signature|sig|auth)=)[^&\s"'<>]+/gi;

function redact(message: string, secrets: (string | undefined)[]) {
  const present = secrets.filter((s): s is string => Boolean(s));

  let out = message;
  for (const secret of present) {
    for (const form of forms(secret)) out = out.split(form).join("[redacted]");
  }
  out = out.replace(URL_CREDENTIAL, "$1[redacted]");
  out = out.replace(ADDRESS, "[address]");
  out = out.replace(BASE64_RUN, (run) => hidePart(run, present));
  return out;
}

// Trimming has to come after redaction -- cutting first would leave the
// leading half of a secret that straddles the limit, which is worse than
// saying nothing because it still discloses and it looks redacted. Cutting
// after can still land inside a marker and print "[redacte", so the trailing
// fragment goes too.
// A server may answer over several lines ("535-5.7.8 ...\n535 5.7.8 ..."),
// and a newline inside an alert breaks the one-line-per-field shape the
// chat message is built from, and splits a log line in two.
function flatten(message: string) {
  return message.replace(/\s*\n\s*/g, " ").trim();
}

function trim(message: string, limit = 160) {
  if (message.length <= limit) return message;
  return message.slice(0, limit).replace(/\[[A-Za-z]*$/, "").trimEnd();
}

/**
 * Describe a thrown error for an alert, without repeating anything secret.
 *
 * The code is the useful part -- ECONNREFUSED, EAUTH and ETIMEDOUT each
 * point somewhere different -- and the message is trimmed to keep one
 * failure from filling a chat space.
 */
export function describeError(err: unknown, secrets: (string | undefined)[] = []): string {
  if (!(err instanceof Error)) return "unknown error";

  const message = trim(flatten(redact(err.message, secrets)));
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && code ? `${code}: ${message}` : message;
}

/**
 * The same, for a server log, which can afford the stack.
 *
 * Redacting the message cost us the stack, and a stack is most of what makes
 * a log worth reading. The frames are file paths and line numbers, which is
 * not where a credential lives; the first line is the message, which is, so
 * it is dropped and the redacted description stands in its place. Frames are
 * redacted too, since a path is not a promise.
 */
export function describeErrorForLog(err: unknown, secrets: (string | undefined)[] = []): string {
  const described = describeError(err, secrets);
  if (!(err instanceof Error) || !err.stack) return described;

  const frames = err.stack
    .split("\n")
    .filter((line) => /^\s+at\s/.test(line))
    .slice(0, 8)
    .map((line) => redact(line, secrets));

  return frames.length ? [described, ...frames].join("\n") : described;
}
