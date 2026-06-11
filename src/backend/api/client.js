/**
 * HTTP client for Drumee's service API (`/-/svc/<module>.<method>`).
 *
 * Transport mechanics mirror @drumee/ui-essentials `socket/`:
 *  - POST `${base}<module>.<method>` with a JSON body
 *  - response envelope: success → `payload.data` (or the payload), error →
 *    `payload.error` or a non-200 status
 *  - session auth via the `x-param-keysel` + `x-param-<keysel>` header scheme
 *
 * NOTE: the exact credential the server accepts for a headless client (token vs
 * keysel/sid) must be validated against a live instance; auth presentation here
 * is intentionally pluggable. The `authn.create` exchange (Basic → token) is
 * used by `drumee api login`.
 */
class ApiClient {
  constructor({ host, token, keysel, sid, lang, verbose } = {}) {
    if (!host) {
      throw new Error(
        "API backend requires a host — pass --host, set DRUMEE_HOST, or run `drumee api login`."
      );
    }
    this.base = ApiClient.normalizeBase(host);
    this.token = token;
    this.keysel = keysel;
    this.sid = sid;
    this.lang = lang || "en";
    this.verbose = verbose;
  }

  /**
   * Append the `svc/` segment to the endpoint base the caller provides.
   * The endpoint path is instance-specific (multi-tenant), e.g.
   * `https://drumee.in/-/somanos/` → `https://drumee.in/-/somanos/svc/`.
   * A value already ending in `/svc` is accepted as-is.
   */
  static normalizeBase(host) {
    let h = String(host).trim();
    if (!/^https?:\/\//.test(h)) h = `https://${h}`;
    h = h.replace(/\/+$/, "");
    if (!/\/svc$/.test(h)) h = `${h}/svc`;
    return `${h}/`;
  }

  headers(extra = {}) {
    const h = {
      Accept: "*/*",
      "Content-Type": "application/json",
      "x-param-lang": this.lang,
      ...extra,
    };
    if (this.keysel) {
      h["x-param-keysel"] = this.keysel;
      if (this.sid) h[`x-param-${this.keysel}`] = this.sid;
    }
    if (this.token && !h.Authorization) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  /**
   * Call a service. `service` is "module.method".
   * @param {object} [opts] - { method: "POST"|"GET", authorization: string }
   * @returns the unwrapped `data` payload
   */
  async call(service, payload = {}, opts = {}) {
    const method = opts.method || "POST";
    let url = `${this.base}${service}`;
    const headers = this.headers(
      opts.authorization ? { Authorization: opts.authorization } : {}
    );

    const init = { method, headers };
    if (method === "GET") {
      // token-as-accessToken channel for GET (share/one-time style)
      if (this.token) url += `?accessToken=${encodeURIComponent(this.token)}`;
    } else {
      init.body = JSON.stringify(payload);
    }

    if (this.verbose) process.stderr.write(`→ ${method} ${url}\n`);

    const res = await fetch(url, init);
    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      /* non-JSON or empty body */
    }

    // Errors arrive either as a non-200 status, or (commonly) as HTTP 200 with a
    // top-level `error` string plus `reason`/`error_code` in the envelope.
    const errored =
      res.status >= 400 ||
      (body && (body.error || (body.status && body.status >= 400)));
    if (errored) {
      const base =
        (body &&
          (typeof body.error === "string"
            ? body.error
            : body.error?.message || body.message)) ||
        `HTTP ${res.status}`;
      const reason = body && body.reason ? ` (${body.reason})` : "";
      const err = new Error(`${base}${reason}`);
      err.status = (body && (body.error_code || body.status)) || res.status;
      err.body = body;
      throw err;
    }
    return body && body.data !== undefined ? body.data : body;
  }
}

module.exports = { ApiClient };
