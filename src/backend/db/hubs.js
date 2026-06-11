const { NotImplemented, requireRoot } = require("../../lib/errors");

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

  // --- planned for a later version --------------------------------------

  async create() {
    throw new NotImplemented(
      "hub create",
      "hub provisioning via desk_create_hub in the owner's shard is planned"
    );
  }
}

module.exports = { HubStore };
