const { NotImplemented, requireRoot } = require("../../lib/errors");

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

    // Pre-flight: confirm the user's storage root is exclusively theirs BEFORE
    // dropping anything, so an unsafe path aborts without partial state.
    const home = (await this.b.entityHomeDir(user.id)) || user.home_dir;
    if (home) await this.b.assertExclusiveStorage(home, user.id);

    await this._removeHubs(user);

    const res = (await this.b.proc("entity_delete", user.id)) || {};
    const removed = await this.b.removeStorage(res.home_dir || home, user.id);

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

  // --- planned for a later version --------------------------------------

  async add() {
    throw new NotImplemented(
      "user add",
      "account provisioning (claim a pooled entity, drumate_create, updateEntries, init folders) is planned"
    );
  }

  async update() {
    throw new NotImplemented("user update");
  }
}

module.exports = { UserStore };
