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

  /** "drumee.in" | "https://drumee.in" | ".../-/svc" → "https://drumee.in/-/svc/" */
  static normalizeBase(host) {
    let h = String(host).trim();
    if (!/^https?:\/\//.test(h)) h = `https://${h}`;
    h = h.replace(/\/+$/, "");
    if (!/\/-\/svc$/.test(h)) h = `${h}/-/svc`;
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

    if (res.status !== 200) {
      const msg = (body && (body.error?.message || body.error || body.message)) || `HTTP ${res.status}`;
      const err = new Error(`${service}: ${msg}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    if (body && body.error) {
      const err = new Error(`${service}: ${body.error.message || body.error}`);
      err.body = body;
      throw err;
    }
    return body && body.data !== undefined ? body.data : body;
  }
}

module.exports = { ApiClient };
