const { ApiClient } = require("./client");

/** Sleep for `ms` milliseconds. */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Best-effort open a URL in the user's browser; returns false when headless. */
function openBrowser(url) {
  let cmd;
  let args;
  if (process.platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (process.platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  try {
    const { spawn } = require("child_process");
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {}); // opener missing (headless/SSH) — ignore
    child.unref();
    return true;
  } catch (_) {
    return false;
  }
}

/** In-app authorize URL from the endpoint base + user_code (SPA hash route). */
function verifyUrl(host, userCode) {
  const base = String(host).replace(/\/+$/, "/");
  return `${base}#/authorize?code=${encodeURIComponent(userCode)}`;
}

/**
 * npm/gh-style device-pairing login: `authn.begin` → open the browser to the
 * app's authorize page → poll `authn.poll` until the user approves.
 *
 * The `_client`/`_sleep`/`_now` seams make the flow unit-testable.
 *
 * @returns {Promise<{token: string, label: string}>}
 */
async function deviceLogin({
  host,
  label,
  open = true,
  log = () => {},
  _client = null,
  _sleep = sleep,
  _now = () => Date.now() / 1000,
} = {}) {
  const client = _client || new ApiClient({ host });

  const begin = await client.call("authn.begin", { label });
  if (!begin || !begin.device_code) {
    throw new Error("authn.begin returned no device_code");
  }

  const url = verifyUrl(host, begin.user_code);
  log(
    `\nTo authorize this device, open:\n  ${url}\nand confirm the code: ${begin.user_code}\n`
  );
  if (open) {
    log(
      openBrowser(url)
        ? "Opened your browser…\n"
        : "Could not open a browser — open the URL above manually.\n"
    );
  }
  log("Waiting for approval…\n");

  const intervalMs = Math.max(2, begin.interval_seconds || 5) * 1000;
  const expires = begin.expires || _now() + 600;

  for (;;) {
    if (_now() > expires) {
      throw new Error("pairing expired before it was approved");
    }
    const r = await client.call("authn.poll", { device_code: begin.device_code });
    const status = r && r.status;
    if (status === "approved" && r.token) return { token: r.token, label };
    if (status === "expired") throw new Error("pairing expired");
    if (status === "unknown") {
      throw new Error("pairing not found (it may have expired)");
    }
    await _sleep(intervalMs);
  }
}

module.exports = { deviceLogin, openBrowser, verifyUrl, sleep };
