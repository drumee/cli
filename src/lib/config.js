const { homedir } = require("os");
const { join } = require("path");
const {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
} = require("fs");

/**
 * Tiny credential/config store for the API backend, at
 * `~/.config/drumee/cli.json` (0600). Holds `host` and the auth material
 * (`token`, or `keysel`/`sid`) written by `drumee api login`.
 */
const DIR = join(homedir(), ".config", "drumee");
const FILE = join(DIR, "cli.json");

function load() {
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch (_) {
    return {};
  }
}

function save(patch) {
  const next = { ...load(), ...patch };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  return next;
}

function clear() {
  if (existsSync(FILE)) rmSync(FILE, { force: true });
}

module.exports = { load, save, clear, FILE };
