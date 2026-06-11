const { existsSync, mkdirSync, cpSync, statSync, readdirSync } = require("fs");
const { join, extname, basename } = require("path");

/**
 * Meta File System operations, scoped to a single entity (hub or user) shard.
 *
 * Read paths (`ls`, `node`) run procedures via the prefixed `yp` connection.
 * Import/export open a dedicated connection to the entity shard (`entityConn`)
 * because node creation runs procedures that depend on the active DB context.
 */
class MfsStore {
  constructor(backend) {
    this.b = backend;
  }

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

  async node({ entity, id, uid = "" } = {}) {
    if (!entity) throw new Error("mfs node requires --entity");
    if (!id) throw new Error("mfs node requires --id");
    const db = await this.b.dbName(entity);
    if (!db) throw new Error(`Unknown entity: ${entity}`);
    const node = await this.b.proc(`${db}.mfs_show_node_by`, id, uid, {});
    if (!node) throw new Error(`Unknown node: ${id}`);
    return node;
  }

  // -- import -------------------------------------------------------------

  /**
   * Import a local file or directory into an entity's MFS. Mirrors
   * @drumee/shell's `importFile`: resolve a destination folder node, create
   * each node via `mfs_create_node`, then copy the blob to
   * `<home_dir>/__storage__/<node-id>/orig.<ext>`.
   *
   * @param {object} opts
   * @param {string} opts.entity  hub/user id or ident (target shard)
   * @param {string} opts.src     local file or directory
   * @param {string} [opts.parent] parent node id to import under
   * @param {string} [opts.dest]   folder path under root (created if needed)
   */
  async import({ entity, src, parent, dest } = {}) {
    if (!src) throw new Error("mfs import requires --src");
    if (!existsSync(src)) throw new Error(`source not found: ${src}`);
    const dbName = await this._shard(entity);
    const conn = this.b.entityConn(dbName);
    try {
      const destNode = await this._resolveDest(conn, parent, dest);
      if (!destNode) throw new Error("could not resolve the destination folder");
      const imported = [];
      await this._importPath(conn, destNode, src, imported);
      return { imported: imported.length, files: imported };
    } finally {
      await conn.stop();
    }
  }

  /** Resolve the destination folder node from --parent / --dest / root. */
  async _resolveDest(conn, parent, dest) {
    if (parent) return this._row(await conn.await_proc("mfs_node_attr", parent));
    const home = this._row(await conn.await_proc("mfs_home"));
    const homeId = home && (home.home_id || home.id);
    if (dest) {
      const segments = String(dest).split("/").filter(Boolean);
      return this._row(await conn.await_proc("mfs_make_dir", homeId, segments, 1));
    }
    return this._row(await conn.await_proc("mfs_node_attr", homeId));
  }

  async _importPath(conn, destNode, src, imported) {
    if (statSync(src).isDirectory()) {
      const pid = destNode.nid || destNode.id;
      const folder = this._row(
        await conn.await_proc("mfs_make_dir", pid, [basename(src)], 1)
      );
      for (const entry of readdirSync(src)) {
        await this._importPath(conn, folder || destNode, join(src, entry), imported);
      }
    } else {
      const item = await this._importFile(conn, destNode, src);
      if (item) imported.push({ id: item.id, path: src });
    }
  }

  async _importFile(conn, destNode, src) {
    const st = statSync(src);
    const rawExt = extname(src); // original case, e.g. ".PDF"
    const ext = rawExt.replace(/^\.+/, "").toLowerCase();
    const filename = basename(src, rawExt); // strip the exact (case-sensitive) suffix

    // filetype/mimetype from the warm filecap cache (loaded at connect) — no
    // per-file DB round-trip for static reference data.
    const cap = (this.b.Cache && this.b.Cache.getFilecap(ext)) || {};
    const filetype = cap.category || "other";
    const mimetype =
      cap.mimetype || (ext ? `application/${ext}` : "application/octet-stream");

    const homeDir = String(destNode.home_dir || "").replace(/\/__storage__.*$/, "");
    if (!homeDir) throw new Error("destination folder has no home_dir");

    const args = {
      owner_id: destNode.owner_id,
      filename,
      pid: destNode.nid || destNode.id,
      category: filetype,
      ext,
      mimetype,
      filesize: st.size,
      showResults: 1,
    };
    const item = this._row(
      await conn.await_proc("mfs_create_node", args, {}, { isOutput: 1 })
    );
    if (!item || !item.id) throw new Error(`failed to create node for ${src}`);

    const base = join(homeDir, "__storage__", item.id);
    mkdirSync(base, { recursive: true });
    cpSync(src, join(base, `orig.${ext}`), { force: true });
    return item;
  }

  // -- export -------------------------------------------------------------

  /**
   * Export an entity's MFS subtree to a local directory. Walks the shard's
   * `media` table (read-only) and copies each file blob
   * (`<home_dir>/__storage__/<id>/orig.<ext>`) to the destination, rebuilding
   * the folder hierarchy and `user_filename` + extension.
   *
   * @param {object} opts
   * @param {string} opts.entity  hub/user id or ident (source shard)
   * @param {string} opts.dest    local destination directory
   * @param {string} [opts.node]  node id to export (defaults to the whole root)
   */
  async export({ entity, node, dest } = {}) {
    if (!dest) throw new Error("mfs export requires --dest");
    const dbName = await this._shard(entity);
    const conn = this.b.entityConn(dbName);
    try {
      let rootId = node;
      let rootAttr;
      if (rootId) {
        rootAttr = this._row(await conn.await_proc("mfs_node_attr", rootId));
      } else {
        rootAttr = this._row(await conn.await_proc("mfs_home"));
        rootId = rootAttr && (rootAttr.home_id || rootAttr.id);
      }
      if (!rootId || !rootAttr) throw new Error("could not resolve the node to export");
      const homeDir = String(rootAttr.home_dir || "").replace(/\/__storage__.*$/, "");
      if (!homeDir) throw new Error("entity has no home_dir");

      mkdirSync(dest, { recursive: true });
      const exported = [];
      await this._exportTree(conn, homeDir, rootId, dest, exported);
      return { exported: exported.length, dest, files: exported };
    } finally {
      await conn.stop();
    }
  }

  async _exportTree(conn, homeDir, parentId, destDir, exported) {
    const rows =
      this.b.toArray(
        await conn.await_query(
          "SELECT id, user_filename, extension, category FROM media WHERE parent_id = ? ORDER BY user_filename",
          parentId
        )
      ) || [];
    for (const n of rows) {
      const name = n.user_filename || n.id;
      if (/^(folder|hub)$/i.test(n.category || "")) {
        const sub = join(destDir, name);
        mkdirSync(sub, { recursive: true });
        await this._exportTree(conn, homeDir, n.id, sub, exported);
      } else {
        const blob = join(homeDir, "__storage__", n.id, `orig.${n.extension || ""}`);
        const out = join(destDir, n.extension ? `${name}.${n.extension}` : name);
        if (existsSync(blob)) {
          cpSync(blob, out, { force: true });
          exported.push(out);
        }
      }
    }
  }

  // -- helpers ------------------------------------------------------------

  async _shard(entity) {
    if (!entity) throw new Error("--entity is required");
    const db = await this.b.dbName(entity);
    if (!db) throw new Error(`Unknown entity: ${entity}`);
    return db;
  }

  /** First usable row from an await_proc/await_query result (array or object). */
  _row(out) {
    if (Array.isArray(out)) return out.find((r) => r && (r.id || r.nid)) || out[0] || null;
    return out || null;
  }
}

module.exports = { MfsStore };
