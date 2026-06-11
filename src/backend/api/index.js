const { ApiClient } = require("./client");
const config = require("../../lib/config");

/**
 * Remote backend — talks to a Drumee instance over its `/-/svc/` service API
 * instead of the database. Implements the same resource interface as DbBackend
 * (`user`, `hub`, `settings`, `mfs`) so the command layer is unchanged.
 *
 * Layer 1 (this commit) ships the authenticated transport (`this.client`) used
 * by `drumee api call` and, later, the sync engine. Per-resource service
 * mappings are pending live validation of the auth handshake, so each resource
 * method reports that clearly for now.
 */
class ApiBackend {
  constructor(opts = {}) {
    this.opts = opts;
    for (const res of ["user", "hub", "settings", "mfs"]) {
      this[res] = makePending(res);
    }
  }

  async connect() {
    const cfg = config.load();
    const host = this.opts.host || process.env.DRUMEE_HOST || cfg.host;
    const token = this.opts.token || process.env.DRUMEE_TOKEN || cfg.token;
    if (!host) {
      throw new Error(
        "API backend needs a host — pass --host, set DRUMEE_HOST, or run `drumee api login`."
      );
    }
    this.client = new ApiClient({
      host,
      token,
      keysel: cfg.keysel,
      sid: cfg.sid,
      lang: this.opts.lang,
      verbose: this.opts.verbose,
    });
    return this;
  }

  async disconnect() {}
}

/** A resource whose every method reports it isn't mapped over the API yet. */
function makePending(resource) {
  return new Proxy(
    {},
    {
      get(_t, method) {
        return async () => {
          throw new Error(
            `${resource}.${String(method)} is not yet implemented over --backend api ` +
              `(the transport is ready — use \`drumee api call ${resource}.<method>\` directly, ` +
              `or the default --backend db).`
          );
        };
      },
    }
  );
}

module.exports = { ApiBackend };
