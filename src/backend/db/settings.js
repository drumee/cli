const { requireRoot } = require("../../lib/errors");

/**
 * System settings, backed by the `yp.sys_conf` key/value table.
 *
 * Reads use the `get_sys_conf` procedure; writes use `sys_conf_set(key, value)`
 * (a REPLACE INTO sys_conf), which expects the value as JSON.
 */
class SettingsStore {
  constructor(backend) {
    this.b = backend;
  }

  /** Return all settings as `{ key, value }` rows. */
  async list() {
    // get_sys_conf SELECTs `conf_key AS key, conf_value AS value`, so rows are
    // {key, value}. A CALL result may arrive nested as [rows, …] — unwrap it the
    // same way @drumee/server-essentials Cache.load does.
    const data = await this.b.proc("get_sys_conf");
    const rows =
      Array.isArray(data) && Array.isArray(data[0])
        ? data[0]
        : this.b.toArray(data) || [];
    return rows
      .filter((r) => r && r.key !== undefined)
      .map((r) => ({ key: r.key, value: r.value }));
  }

  /** Get a single setting value by key. */
  async get(key) {
    if (!key) throw new Error("settings get requires a key");
    const all = await this.list();
    const found = all.find((r) => r.key === key);
    if (!found) throw new Error(`Unknown setting: ${key}`);
    return found;
  }

  /**
   * Set a setting. `value` is stored as JSON; non-JSON strings are wrapped.
   * Requires root.
   */
  async set(key, value) {
    requireRoot("settings set");
    if (!key) throw new Error("settings set requires a key");
    let json = value;
    try {
      JSON.parse(value);
    } catch (_) {
      json = JSON.stringify(value); // wrap a bare string as valid JSON
    }
    await this.b.proc("sys_conf_set", key, json);
    return { key, value: json };
  }
}

module.exports = { SettingsStore };
