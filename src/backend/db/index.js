const { UserStore } = require("./users");
const { HubStore } = require("./hubs");
const { SettingsStore } = require("./settings");
const { MfsStore } = require("./mfs");

/**
 * Direct-database backend.
 *
 * Connects to the central `yp` (Yellow Pages) database as the current system
 * user — the same bootstrap @drumee/shell and @drumee/setup-schemas use — and
 * routes per-entity operations to the right shard by prefixing the resolved
 * `db_name` onto the procedure call (e.g. `<x>_ab12….show_hubs`). The leading
 * `<x>_` is an arbitrary bucket character, not a type marker — never infer an
 * entity's type from its db_name.
 *
 * All data access goes through stored procedures or read-only lookups; no
 * business logic is duplicated in raw SQL beyond simple SELECTs.
 */
class DbBackend {
  constructor(opts = {}) {
    this.opts = opts;
    this.domain = opts.domain || "1";
    this.yp = null;

    // Resource namespaces — each receives this backend for DB access.
    this.user = new UserStore(this);
    this.hub = new HubStore(this);
    this.settings = new SettingsStore(this);
    this.mfs = new MfsStore(this);
  }

  async connect() {
    // Lazy-require so `--help` and arg errors never load server-essentials
    // (which logs runtime/UI probes at require time).
    const { Mariadb, Cache, sysEnv, toArray, uniqueId } = require("@drumee/server-essentials");
    this.Mariadb = Mariadb;
    this.toArray = toArray;
    this.uniqueId = uniqueId;
    this.Cache = Cache;
    this.env = sysEnv();
    this.mfsDir = this.env.mfs_dir;
    this.yp = new Mariadb({ name: "yp", user: process.env.USER, idleTimeout: 60 });
    // Warm the system cache (filecap, sys_conf, lexicon) — several procedures
    // and lookups assume it is loaded.
    await Cache.load(this.yp);
    return this;
  }

  async disconnect() {
    if (this.yp) {
      await this.yp.stop();
      this.yp = null;
    }
  }

  // --- low-level helpers shared by the resource stores -------------------

  /** Run a parameterised read query against `yp`. */
  query(sql, ...params) {
    return this.yp.await_query(sql, ...params);
  }

  /** Call a stored procedure in the `yp` database. */
  proc(name, ...args) {
    return this.yp.await_proc(name, ...args);
  }

  /** First row of a query/proc result (handles array or single-object shapes). */
  firstRow(out) {
    return Array.isArray(out) ? out[0] ?? null : out ?? null;
  }

  /**
   * Resolve an entity's shard database name from an id or ident.
   * Returns null when the entity is unknown.
   */
  async dbName(key) {
    const row = this.firstRow(
      await this.query(
        "SELECT db_name FROM entity WHERE id = ? OR ident = ? LIMIT 1",
        key,
        key
      )
    );
    return row ? row.db_name : null;
  }

  /**
   * Open a dedicated connection to an entity's shard database. The caller must
   * `await conn.stop()` when done. Used by MFS import/export, which run
   * procedures that rely on the active database context (and OUT params).
   */
  entityConn(dbName) {
    if (!this.Mariadb) throw new Error("backend is not connected");
    return new this.Mariadb({ name: dbName });
  }

  /** The recorded storage root (`home_dir`) of an entity, or null. */
  async entityHomeDir(id) {
    const row = this.firstRow(
      await this.query("SELECT home_dir FROM entity WHERE id = ? LIMIT 1", id)
    );
    return row ? row.home_dir : null;
  }

  /**
   * Throw unless `dir` is safe to recursively delete on behalf of `entityId`.
   *
   * Each tenant (drumate or hub) has its own storage root recorded in
   * `yp.entity.home_dir`. A delete is only safe when:
   *   1. `dir` is non-empty and lies strictly *inside* the `mfs_dir` root
   *      (never the root itself),
   *   2. no *other* entity's `home_dir` lives under `dir` — otherwise the
   *      recursive removal would wipe another tenant's files.
   *
   * The cross-tenant check is an exact prefix match (via `LEFT(...)`, not
   * `LIKE` — `home_dir` contains `_`, a LIKE wildcard) with a trailing-slash
   * boundary so a sibling that merely shares a name prefix cannot match.
   */
  async assertExclusiveStorage(dir, entityId) {
    if (!dir) throw new Error("refusing to delete storage: empty home_dir");
    if (!this.mfsDir) {
      throw new Error("refusing to delete storage: mfs_dir is not configured");
    }

    const root = String(this.mfsDir).replace(/\/+$/, "");
    const target = String(dir).replace(/\/+$/, "");
    if (target === root || !target.startsWith(root + "/")) {
      throw new Error(
        `refusing to delete "${dir}": not a path strictly inside mfs_dir (${this.mfsDir})`
      );
    }

    const prefix = target + "/";
    const rows =
      this.toArray(
        await this.query(
          "SELECT id, db_name, home_dir FROM entity WHERE id <> ? AND LEFT(home_dir, CHAR_LENGTH(?)) = ?",
          entityId || "",
          prefix,
          prefix
        )
      ) || [];
    if (rows.length) {
      const who = rows.map((r) => `${r.id} → ${r.home_dir}`).join(", ");
      throw new Error(
        `refusing to delete "${dir}": it contains the storage of ${rows.length} other tenant(s): ${who}`
      );
    }
  }

  /**
   * Recursively delete an entity's physical storage directory — but only after
   * `assertExclusiveStorage` confirms the path is inside `mfs_dir` and holds no
   * other tenant's files.
   *
   * @returns {Promise<boolean>} true if a directory was removed
   */
  async removeStorage(dir, entityId) {
    if (!dir || !this.mfsDir) return false;
    await this.assertExclusiveStorage(dir, entityId);
    const { rmSync } = require("fs");
    rmSync(dir, { recursive: true, force: true });
    return true;
  }
}

module.exports = { DbBackend };
