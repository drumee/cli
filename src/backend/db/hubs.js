const { requireRoot } = require("../../lib/errors");

/**
 * Hub (workspace) operations.
 *
 * Hubs are registered in `yp.hub`; per-hub member data lives in each hub's own
 * shard database and is read via the `show_all_members` procedure.
 */
class HubStore {
  constructor(backend) {
    this.b = backend;
  }

  /**
   * List hubs. With `owner` (id/email), lists the hubs visible in that user's
   * shard via `show_hubs`; otherwise lists all hubs from the `yp.hub` registry.
   */
  async list({ owner } = {}) {
    if (owner) {
      const user = await this.b.proc("get_user", owner);
      if (!user || !user.db_name) throw new Error(`Unknown user: ${owner}`);
      const hubs = this.b.toArray(await this.b.proc(`${user.db_name}.show_hubs`)) || [];
      return hubs.map((h) => ({
        id: h.id,
        name: h.name || h.hubname,
        owner_id: h.owner_id,
        db_name: h.db_name,
      }));
    }
    const rows =
      this.b.toArray(
        await this.b.query(
          "SELECT id, hubname AS name, owner_id, db_name FROM hub ORDER BY hubname"
        )
      ) || [];
    return rows;
  }

  /** Resolve a single hub by id or ident. */
  async get(key) {
    if (!key) throw new Error("hub get requires an id or ident");
    const hub = await this.b.proc("get_hub", key);
    if (!hub || !hub.id) throw new Error(`Unknown hub: ${key}`);
    return hub;
  }

  /** List members of a hub (runs `show_all_members` inside the hub's shard). */
  async members(key) {
    const hub = await this.b.proc("get_hub", key);
    if (!hub || !hub.db_name) throw new Error(`Unknown hub: ${key}`);
    return this.b.toArray(await this.b.proc(`${hub.db_name}.show_all_members`)) || [];
  }

  /**
   * Purge a hub: drop all members, delete its physical files, drop the entity
   * (rows + DROP DATABASE). Destructive and irreversible — requires root.
   */
  async delete(key) {
    requireRoot("hub delete");
    const hub = await this.b.proc("get_hub", key);
    if (!hub || !hub.id) throw new Error(`Unknown hub: ${key}`);

    // Pre-flight: confirm the hub's storage root is exclusively its own before
    // dropping anything.
    const home = (await this.b.entityHomeDir(hub.id)) || hub.home_dir;
    if (home) await this.b.assertExclusiveStorage(home, hub.id);

    if (hub.db_name) {
      await this.b.proc(`${hub.db_name}.remove_all_members`, 0);
    }
    const res = (await this.b.proc("entity_delete", hub.id)) || {};
    const removed = await this.b.removeStorage(res.home_dir || home, hub.id);
    return { purged: hub.id, name: hub.hubname || hub.name, storageRemoved: removed };
  }

  /**
   * Create a hub owned by a user. Mirrors @drumee/setup-schemas `createHub`:
   * `desk_create_hub` runs inside the owner's drumate shard, claims a pooled
   * hub entity (`pickupEntity`), wires the vhost/permissions/MFS folders, and
   * returns the new hub. Idempotent on the resolved vhost.
   *
   * @param {object} opts
   * @param {string} opts.name   hub display name (also the basis for hostname)
   * @param {string} opts.owner  owning user id or email
   * @param {string} [opts.area="private"]  private | restricted | public
   * @param {string} [opts.domain]  domain name (defaults to the owner's domain)
   * @param {string} [opts.description]
   * @param {string} [opts.keywords]
   */
  async create({ name, owner, area = "private", domain, description = "", keywords = "" } = {}) {
    if (!name) throw new Error("hub create requires --name");
    if (!owner) throw new Error("hub create requires --owner");

    const user = await this.b.proc("get_user", owner);
    if (!user || !user.id || !user.db_name) {
      throw new Error(`Unknown user (or missing shard): ${owner}`);
    }

    // Derive a DNS-safe hostname from the name (mirrors setup-schemas).
    const hostname = String(name)
      .replace(/[ .,;:!&~#'|@*$><?]/g, "")
      .replace(/-+$/g, "")
      .toLowerCase();
    if (!hostname) throw new Error(`"${name}" yields an empty hostname`);

    const domainName = domain || user.domain;
    const vhost = `${hostname}.${domainName}`;

    // Idempotent: if the vhost already exists, return the existing hub.
    const existing = await this.b.query(
      "SELECT id FROM vhost WHERE fqdn = ? LIMIT 1",
      vhost
    );
    const ex = Array.isArray(existing) ? existing[0] : existing;
    if (ex && ex.id) return this.b.proc("get_hub", ex.id);

    const args = {
      hostname,
      filename: name,
      area,
      owner_id: user.id,
      domain: domainName,
      domain_id: user.domain_id,
      description,
      keywords,
    };

    const rows =
      this.b.toArray(
        await this.b.proc(`${user.db_name}.desk_create_hub`, args, {})
      ) || [];

    for (const r of rows) {
      if (r && r.failed) {
        throw new Error(`hub create failed: ${r.reason || "unknown error"}`);
      }
    }

    // The success row carries vhost + actual_home_id (see desk_create_hub).
    const created = rows.find((r) => r && r.vhost && r.actual_home_id);
    if (created && created.hub_id) return this.b.proc("get_hub", created.hub_id);

    // Fallback: resolve by the vhost we just created.
    const v = await this.b.query("SELECT id FROM vhost WHERE fqdn = ? LIMIT 1", vhost);
    const vr = Array.isArray(v) ? v[0] : v;
    if (vr && vr.id) return this.b.proc("get_hub", vr.id);

    throw new Error(`hub create did not return a usable hub for ${vhost}`);
  }
}

module.exports = { HubStore };
