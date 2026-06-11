const { requireRoot } = require("../../lib/errors");

/**
 * User (drumate) operations against the `yp` database.
 *
 * Read paths use the `get_user` procedure and simple lookups; removal mirrors
 * @drumee/setup-schemas (purge owned hubs, then `entity_delete`).
 */
class UserStore {
  constructor(backend) {
    this.b = backend;
  }

  /**
   * List users, optionally filtered by email (LIKE) or profile category.
   * When `verbose` is set, also report the entity's `db_name`, `home_id`, and
   * `home_dir` (joined from `yp.entity`).
   */
  async list({ email, category, verbose } = {}) {
    const cols = ["d.id", "d.email", "d.fullname", "d.profile"];
    let from = "FROM drumate d";
    if (verbose) {
      cols.push("e.db_name", "e.home_id", "e.home_dir");
      from += " LEFT JOIN entity e ON e.id = d.id";
    }
    let sql = `SELECT ${cols.join(", ")} ${from}`;
    const params = [];
    if (category) {
      sql += ` WHERE JSON_VALUE(d.profile, "$.category") = ?`;
      params.push(category);
    } else if (email) {
      sql += " WHERE d.email LIKE ?";
      params.push(email);
    }
    const rows = this.b.toArray(await this.b.query(sql, ...params)) || [];
    return rows.map((r) => {
      const out = {
        id: r.id,
        email: r.email,
        fullname: r.fullname,
        category: (r.profile && r.profile.category) || "",
      };
      if (verbose) {
        out.db_name = r.db_name;
        out.home_id = r.home_id;
        out.home_dir = r.home_dir;
      }
      return out;
    });
  }

  /** Resolve a single user by id or email. */
  async get(key) {
    if (!key) throw new Error("user get requires an id or email");
    const user = await this.b.proc("get_user", key);
    if (!user || !user.id) throw new Error(`Unknown user: ${key}`);
    return user;
  }

  /**
   * Purge a user account. Mirrors @drumee/shell's `Drumate.remove`:
   *
   *   1. For every hub in the user's shard:
   *        - owned  → drop all members, delete the hub's physical files, vanish it
   *        - shared → leave it (unshare the user)
   *   2. `entity_delete` the user (removes all rows + DROP DATABASE)
   *   3. Delete the user's own physical storage directory from disk
   *
   * Destructive and irreversible — requires root.
   */
  async delete(key) {
    requireRoot("user delete");
    const user = await this.b.proc("get_user", key);
    if (!user || !user.id) throw new Error(`Unknown user: ${key}`);

    // get_user already returns home_dir; only look it up if it is absent.
    const home = user.home_dir || (await this.b.entityHomeDir(user.id));
    // Pre-flight: confirm the storage root is exclusively this user's BEFORE
    // dropping anything, so an unsafe path aborts with no partial state.
    if (home) await this.b.assertExclusiveStorage(home, user.id);

    await this._removeHubs(user);
    await this.b.proc("entity_delete", user.id);
    // Delete exactly the path we validated (removeStorage re-checks as well).
    const removed = home ? await this.b.removeStorage(home, user.id) : false;

    return { purged: user.id, email: user.email, storageRemoved: removed };
  }

  /** Detach the user from every hub: purge owned ones, leave shared ones. */
  async _removeHubs(user) {
    if (!user.db_name) return;
    const hubs = this.b.toArray(await this.b.proc(`${user.db_name}.show_hubs`)) || [];
    for (const hub of hubs) {
      if (hub.owner_id === user.id) {
        // `removeStorage` re-validates against yp.entity that no other tenant
        // lives under this hub's home_dir before deleting (hub.id is excluded).
        await this.b.proc(`${hub.db_name}.remove_all_members`, 0);
        await this.b.removeStorage(hub.home_dir, hub.id);
        await this.b.proc("drumate_vanish", hub.id);
      } else {
        await this.b.proc(`${user.db_name}.leave_hub`, hub.id);
      }
    }
  }

  /**
   * Create a user (drumate). Mirrors @drumee/shell's `Drumate.create`:
   * `drumate_create(password, profile)` claims a pooled drumate entity
   * (`pickupEntity`), provisions its shard, and the default top-level folders
   * are seeded via `mfs_init_folders`.
   *
   * `domain` is optional — it defaults to the instance domain. The password is
   * hashed by the procedure; when none is given a random one is generated and
   * returned once (as `generatedPassword`) so the admin can convey it.
   *
   * @param {object} opts
   * @param {string} opts.email (required)
   * @param {string} [opts.firstname] [opts.lastname] [opts.username]
   * @param {string} [opts.domain] [opts.lang="en"] [opts.category] [opts.privilege]
   * @param {string} [opts.password]
   */
  async add({
    email,
    firstname,
    lastname,
    username,
    domain,
    lang = "en",
    category,
    privilege,
    password,
  } = {}) {
    if (!email) throw new Error("user add requires --email");

    // Reject duplicates up front.
    const existing = await this.b.proc("get_user", email);
    if (existing && existing.id && existing.email) {
      throw new Error(`user already exists: ${email}`);
    }

    // Seed a username; drumate_create strips accents and uniquifies further.
    let uname = username || firstname || email.split("@")[0] || this.b.uniqueId();
    uname = uname.replace(/[ ']+/g, "").toLowerCase();

    const profile = {
      email,
      firstname,
      lastname,
      lang,
      privilege,
      domain,
      username: uname,
      sharebox: this.b.uniqueId(),
      otp: 0,
      category,
    };
    const pw = password || this.b.uniqueId();

    const rows = this.b.toArray(await this.b.proc("drumate_create", pw, profile)) || [];
    let created = null;
    for (const r of rows) {
      if (r && r.failed) {
        const reason =
          r.reason === "EMPTY_FACTORY"
            ? "no drumate entity available in the factory pool (is the factory daemon running?)"
            : r.reason || "unknown error";
        throw new Error(`user add failed: ${reason}`);
      }
      if (r && r.drumate) created = r.drumate;
    }
    if (!created || !created.id) {
      throw new Error("user add: drumate_create returned no entity");
    }

    await this._initFolders(created);

    const user = (await this.b.proc("get_user", created.id)) || {
      id: created.id,
      email,
    };
    if (!password) user.generatedPassword = pw;
    return user;
  }

  /** Seed the default top-level folders in a freshly created user's shard. */
  async _initFolders(user) {
    if (!user.db_name) return;
    const folders = ["_photos", "_documents", "_videos", "_musics"].map((n) => ({
      path: this._folderName(n),
    }));
    await this.b.proc(`${user.db_name}.mfs_init_folders`, folders, 1);
  }

  /** Localised folder label, falling back to the raw key. */
  _folderName(key) {
    try {
      return (this.b.Cache && this.b.Cache.message(key)) || key;
    } catch (_) {
      return key;
    }
  }

  /**
   * Update a user's fields. Each field is routed to its canonical procedure:
   *   - firstname/lastname/category/quota → `drumate_update_profile` (one call)
   *   - email    → `drumate_change_email`
   *   - username → `drumate_change_username`
   *   - mobile   → `drumate_change_mobile`
   *   - lang     → `drumate_set_lang`
   *   - password → `set_password` (the proc hashes it)
   *
   * At least one field must be supplied. Returns the refreshed user plus a
   * summary of what changed.
   */
  async update(key, opts = {}) {
    if (!key) throw new Error("user update requires an id or email");
    const user = await this.b.proc("get_user", key);
    if (!user || !user.id) throw new Error(`Unknown user: ${key}`);
    const id = user.id;

    const changed = [];

    // Generic profile fields — merged in a single drumate_update_profile call.
    const profile = {};
    for (const f of ["firstname", "lastname", "category", "quota"]) {
      if (opts[f] !== undefined) profile[f] = opts[f];
    }
    if (Object.keys(profile).length) {
      await this.b.proc("drumate_update_profile", id, profile);
      changed.push(...Object.keys(profile));
    }

    // Fields with dedicated procedures.
    const dedicated = [
      ["email", "drumate_change_email"],
      ["username", "drumate_change_username"],
      ["mobile", "drumate_change_mobile"],
      ["lang", "drumate_set_lang"],
      ["password", "set_password"],
    ];
    for (const [field, proc] of dedicated) {
      if (opts[field] !== undefined) {
        await this.b.proc(proc, id, opts[field]);
        changed.push(field);
      }
    }

    if (!changed.length) {
      throw new Error(
        "user update: nothing to change — supply at least one field (e.g. --firstname, --email, --password)"
      );
    }

    const updated = (await this.b.proc("get_user", id)) || { id };
    updated.changed = changed.join(", ");
    return updated;
  }
}

module.exports = { UserStore };
