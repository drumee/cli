# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`@drumee/cli` is the Drumee admin command-line tool (binary: `drumee`). It manages users
(drumates), hubs (workspaces), system settings, and the meta filesystem (MFS) by driving
Drumee's MariaDB stored procedures. It is a clean reimplementation intended to supersede the
ad-hoc scripts in `@drumee/shell`.

## Commands

```bash
node ./bin/drumee.js <group> <command> [options]   # or `drumee …` after `npm link`
npm start -- <group> <command> [options]
```

No test runner or linter is configured yet.

## Architecture

- **`bin/drumee.js`** — commander entry. Declares global options (`--backend`, `--domain`,
  `--json`, `--verbose`), constructs one `Context`, and registers the four command groups.
- **`src/context.js`** — `Context` holds parsed global opts, lazily builds + connects the
  backend, and exposes `runner(fn)`. Command actions are wrapped in `ctx.runner(...)`, which
  connects the backend, invokes `fn(backend, options, ...positionals)`, prints the returned
  value (respecting `--json`), disconnects, and exits. Errors go through `ctx.fail()`.
- **`src/backend/`** — a swappable transport behind a fixed resource interface
  (`user`, `hub`, `settings`, `mfs`):
  - `db/index.js` (`DbBackend`) — opens `Mariadb({name:"yp", user: process.env.USER})`,
    runs `Cache.load(yp)`, and offers helpers: `query`, `proc`, `func`, `dbName(key)`,
    `procIn(key, name, …)`. Per-entity procedures are called by prefixing the resolved
    shard `db_name` (e.g. `` `${db}.show_hubs` ``).
  - `db/{users,hubs,settings,mfs}.js` — resource stores; each takes the backend and calls
    real stored procedures / lookups (see below).
  - `api/index.js` (`ApiBackend`) — planned remote service-API backend; currently throws.
- **`src/commands/`** — one file per group; pure commander wiring that delegates to
  `backend.<resource>.<method>`.
- **`src/lib/`** — `output.js` (cli-table3 / JSON rendering), `errors.js`
  (`NotImplemented`, `requireRoot`).

## Stored procedures used (verified against `../schemas`)

| Resource | Procedure(s) |
|---|---|
| user | `get_user`, `drumate_create`, `mfs_init_folders` (in new shard), `drumate_update_profile`, `drumate_change_email`/`_username`/`_mobile`, `drumate_set_lang`, `set_password`, `show_hubs`, `remove_all_members`, `drumate_vanish`, `leave_hub`, `entity_delete` |
| hub | `get_hub`, `show_hubs`, `show_all_members` (per hub shard), `desk_create_hub` (in owner's shard), `remove_all_members`, `entity_delete` |

`user delete` / `hub delete` are full purges mirroring `@drumee/shell`'s
`Drumate.remove`: detach from every hub (purge owned, leave shared), drop the
entity (rows + `DROP DATABASE`), and delete physical storage via
`DbBackend.removeStorage(dir, entityId)`. Both expose `remove` as an alias.

**Storage-deletion guard (`assertExclusiveStorage`).** Each tenant's storage
root is `yp.entity.home_dir`. Before any `rmSync`, the backend verifies the
target dir (a) lies strictly inside `mfs_dir` (never the root), and (b) contains
**no other entity's `home_dir`** — an exact-prefix query
(`LEFT(home_dir, CHAR_LENGTH(?)) = ?` with a trailing-slash boundary; not `LIKE`,
since `home_dir` contains `_`). The check runs as a pre-flight before the
destructive ops *and* again inside `removeStorage`, so a malformed/empty/ancestor
`home_dir` can never wipe another tenant.
| settings | `get_sys_conf`, `sys_conf_set` |
| mfs | `mfs_list_by` (args: `{pid,type,page,sort,order}`), `mfs_show_node_by(id,uid,params)`; import: `mfs_home`, `mfs_node_attr`, `mfs_make_dir`, `mfs_create_node` (+ `yp.filecap` lookup); export: read-only walk of the shard `media` table |

`user add` runs `drumate_create(password, profile)` (claims a pooled drumate via
`pickupEntity`; the proc hashes the password) then seeds default folders with
`mfs_init_folders`. `domain` defaults to the instance domain. An empty pool
surfaces as `EMPTY_FACTORY`. A random password is generated and returned once
(`generatedPassword`) when `--password` is omitted. The fixed-uid remap
(`updateEntries`) used by org bootstrap is intentionally out of scope here.

`hub create` runs `desk_create_hub(args, profile)` **inside the owner's drumate
shard** (resolved via `get_user`), which claims a pooled hub entity
(`pickupEntity`) and wires vhost/permissions/MFS folders. It is idempotent on the
resolved vhost. Required args: `{hostname, filename, area, owner_id, domain,
domain_id}`.

Both `user add` and `hub create` depend on the factory warm pool having a
pre-provisioned entity available.

`user update` routes each field to its canonical procedure:
`drumate_update_profile` (firstname/lastname/category/quota — one call),
`drumate_change_email`/`_username`/`_mobile`, `drumate_set_lang`, and
`set_password` (which hashes via `sha2`). At least one field is required.

`mfs import`/`export` open a dedicated connection to the entity shard
(`DbBackend.entityConn(dbName)` → `new Mariadb({name})`, closed in a `finally`)
because the node-creation procedures depend on the active DB context. Import
goes through `mfs_create_node` (never raw INSERT) and copies the blob to
`<home_dir>/__storage__/<id>/orig.<ext>`; export reads the `media` table
(read-only) and copies blobs back out, rebuilding folders from `user_filename` +
`extension`.

Planned (not yet wired): the `api` backend.

## Conventions

- All DB access goes through stored procedures or simple read-only `SELECT`s — do not embed
  business logic as raw SQL.
- Per-entity operations must resolve the shard `db_name` first (via `backend.dbName(key)` or
  `get_user`/`get_hub`) and prefix the procedure call; never assume a single database.
- Mutating, destructive, or org-level operations guard with `requireRoot(...)`.
- Keep the command layer free of DB code — add capabilities as backend resource methods so
  the future `api` backend can implement the same interface.
- Dependencies: `@drumee/server-essentials` (`Mariadb`, `Cache`, `sysEnv`, `toArray`,
  `uniqueId`), `commander`, `cli-table3`, `lodash`.
