const { DbBackend } = require("./db");
const { ApiBackend } = require("./api");

/**
 * Backend factory.
 *
 * Every command talks to an abstract backend exposing four resource
 * namespaces — `user`, `hub`, `settings`, `mfs` — so the transport (direct
 * MariaDB today, a remote service API later) is swappable without touching the
 * command layer.
 *
 * @param {"db"|"api"} kind
 * @param {{domain?: string, verbose?: boolean}} opts
 */
function createBackend(kind, opts = {}) {
  switch (kind) {
    case "db":
      return new DbBackend(opts);
    case "api":
      return new ApiBackend(opts);
    default:
      throw new Error(`Unknown backend "${kind}" (expected: db | api)`);
  }
}

module.exports = { createBackend };
