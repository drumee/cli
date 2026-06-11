const { NotImplemented } = require("../../lib/errors");

/**
 * Meta File System operations, scoped to a single entity (hub or user) shard.
 *
 * Every method takes an `entity` key (id/ident/email) which is resolved to its
 * shard database; the MFS procedures then run inside that shard.
 */
class MfsStore {
  constructor(backend) {
    this.b = backend;
  }

  /**
   * List nodes under a parent folder.
   * @param {object} opts
   * @param {string} opts.entity  hub/user id or ident (selects the shard)
   * @param {string} [opts.parent="*"] parent node id ("*" = root)
   * @param {string} [opts.type] filter by category (folder|file|…)
   */
  async ls({ entity, parent = "*", type = "", page = 1 } = {}) {
    if (!entity) throw new Error("mfs ls requires --entity");
    const db = await this.b.dbName(entity);
    if (!db) throw new Error(`Unknown entity: ${entity}`);
    const args = { pid: parent, type, page, sort: "name", order: "asc" };
    const rows = this.b.toArray(await this.b.proc(`${db}.mfs_list_by`, args)) || [];
    return rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      category: r.category,
      extension: r.extension,
      filesize: r.filesize,
    }));
  }

  /** Show a single node's full metadata. */
  async node({ entity, id, uid = "" } = {}) {
    if (!entity) throw new Error("mfs node requires --entity");
    if (!id) throw new Error("mfs node requires --id");
    const db = await this.b.dbName(entity);
    if (!db) throw new Error(`Unknown entity: ${entity}`);
    const node = await this.b.proc(`${db}.mfs_show_node_by`, id, uid, {});
    if (!node) throw new Error(`Unknown node: ${id}`);
    return node;
  }

  // --- planned for a later version --------------------------------------

  async import() {
    throw new NotImplemented("mfs import");
  }

  async export() {
    throw new NotImplemented("mfs export");
  }
}

module.exports = { MfsStore };
