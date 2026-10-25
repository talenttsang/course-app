// Preload for the local stand-in (`node --require`). Next reads `.env*` with
// readFileSync and will copy any key that was not already in the environment.
// Blanking the dangerous keys is one layer. This is the other: those lines
// are removed from the file contents before the framework parses them, so a
// developer `.env.local` cannot put real mail, chat, or store credentials
// into a local or staging run.

function isStandinControlledKey(key) {
  return (
    key.startsWith("SMTP_") ||
    key.startsWith("BIGCOMMERCE_") ||
    key.startsWith("GOOGLE_CHAT") ||
    key.includes("SUPABASE") ||
    key === "CRON_SECRET" ||
    key === "PUBLIC_ORIGIN" ||
    key === "ADMIN_EMAILS"
  );
}

function redactEnvFile(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (!match || !isStandinControlledKey(match[1])) return line;
      return `# omitted by the local test stand-in (${match[1]})`;
    })
    .join("\n");
}

function isEnvPath(file) {
  return /(?:^|[\\/])\.env(?:$|\.)/.test(String(file));
}

function install() {
  const fs = require("fs");
  const readFileSync = fs.readFileSync;
  fs.readFileSync = function (file, options) {
    const result = readFileSync.apply(this, arguments);
    if (!isEnvPath(file)) return result;
    if (typeof result === "string") return redactEnvFile(result);
    if (Buffer.isBuffer(result)) return Buffer.from(redactEnvFile(result.toString("utf8")));
    return result;
  };
  const readFile = fs.promises.readFile;
  fs.promises.readFile = async function (file, options) {
    const result = await readFile.apply(this, arguments);
    if (!isEnvPath(file)) return result;
    if (typeof result === "string") return redactEnvFile(result);
    if (Buffer.isBuffer(result)) return Buffer.from(redactEnvFile(result.toString("utf8")));
    return result;
  };
}

if (process.env.EVOLVE_LOCK_LOCAL_ENV === "1") install();

module.exports = { isStandinControlledKey, redactEnvFile, isEnvPath };
