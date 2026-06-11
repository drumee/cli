/**
 * Remote backend (planned).
 *
 * This will manage a remote Drumee instance by calling its `/-/svc/module.method`
 * service endpoints over HTTP with an auth token, instead of connecting to the
 * database directly. It implements the same resource interface as DbBackend
 * (`user`, `hub`, `settings`, `mfs`) so the command layer is unaffected.
 *
 * Not yet implemented — `--backend api` will report this until the client is built.
 */
class ApiBackend {
  constructor(opts = {}) {
    this.opts = opts;
  }

  async connect() {
    throw new Error(
      "The remote API backend is not implemented yet. Use the default --backend db."
    );
  }

  async disconnect() {}
}

module.exports = { ApiBackend };
