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
    if (this.token) {
      // CLI/PAT token — resolved server-side by session_check_cookie via the
      // x-param-authn-token header.
      h["x-param-authn-token"] = this.token;
      // Supply a session id so the server's validSid() passes; the token
      // doubles as the sid when no explicit keysel/sid is configured.
      const keysel = this.keysel || "regsid";
      h["x-param-keysel"] = keysel;
      h[`x-param-${keysel}`] = this.sid || this.token;
      if (!h.Authorization) h.Authorization = `Bearer ${this.token}`;
    } else if (this.keysel) {
      h["x-param-keysel"] = this.keysel;
      if (this.sid) h[`x-param-${this.keysel}`] = this.sid;
    }
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

    let body;
    if (method === "GET") {
      // GET carries the payload in the query (mirrors Network.request), and the
      // token via the accessToken channel.
      const parts = [];
      if (this.token) parts.push(`accessToken=${encodeURIComponent(this.token)}`);
      if (payload && Object.keys(payload).length) {
        parts.push(encodeURI(JSON.stringify(payload)));
      }
      if (parts.length) url += `?${parts.join("&")}`;
    } else {
      body = JSON.stringify(payload);
      headers["Content-Length"] = Buffer.byteLength(body);
    }

    if (this.verbose) process.stderr.write(`→ ${method} ${url}\n`);

    const { status, json } = await this._request(url, { method, headers, body });

    // Errors arrive either as a non-200 status, or (commonly) as HTTP 200 with a
    // top-level `error` string plus `reason`/`error_code` in the envelope.
    const errored =
      status >= 400 || (json && (json.error || (json.status && json.status >= 400)));
    if (errored) {
      const base =
        (json &&
          (typeof json.error === "string"
            ? json.error
            : json.error?.message || json.message)) ||
        `HTTP ${status}`;
      const reason = json && json.reason ? ` (${json.reason})` : "";
      const err = new Error(`${base}${reason}`);
      err.status = (json && (json.error_code || json.status)) || status;
      err.body = json;
      throw err;
    }
    return json && json.data !== undefined ? json.data : json;
  }

  /**
   * Perform the HTTP request via Node's `https` module — the same transport
   * Drumee uses in `@drumee/server-essentials` `Network.request` (and, unlike
   * `fetch`/undici, it works in restricted/proxied environments). Overridable
   * in tests.
   * @returns {Promise<{status:number, json:any, text:string}>}
   */
  _request(url, { method, headers, body }) {
    const https = require("https");
    return new Promise((resolve, reject) => {
      const req = https.request(url, { method, headers }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch (_) {
            /* non-JSON body */
          }
          resolve({ status: res.statusCode, json, text });
        });
      });
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }
}

module.exports = { ApiClient };
