# @drumee/cli

A command-line tool to manage a Drumee instance — **users, hubs, settings, and the
meta filesystem (MFS)**.

It connects directly to the instance's MariaDB (the `yp` database) and drives Drumee's
stored procedures, the same way `@drumee/setup-schemas` and `@drumee/shell` do. The
command layer talks to a swappable **backend**, so a remote service-API backend can be
added later without changing any commands.

## Install

```bash
npm install
npm link        # exposes the `drumee` binary on your PATH (optional)
```

Requires Node ≥ 18 and a running Drumee environment: MariaDB reachable, `process.env.USER`
a valid DB user with access to `yp`, and `/etc/drumee/` configured (read via `sysEnv()`).

## Usage

```bash
drumee [global options] <group> <command> [options]
```

**Global options**

| Option | Default | Meaning |
|---|---|---|
| `--backend <db\|api>` | `db` | Transport. `db` = direct MariaDB; `api` = remote service API (planned). |
| `--domain <id>` | `1` | Domain id to scope operations to. |
| `--json` | off | Emit raw JSON instead of formatted tables. |
| `--verbose` | off | Verbose logging / full stack traces on error. |

### Command groups

```bash
# Users (drumates)
drumee user list [--email <like>] [--category <c>] [--verbose]  # --verbose adds db_name, home_id, home_dir
drumee user get <id|email>
drumee user add --email <email> [--firstname <n>] [--lastname <n>] [--password <p>] [--domain <d>]
drumee user update <id|email> [--firstname <n>] [--email <e>] [--lang <l>] [--password <p>] ...
drumee user delete <id|email>            # purge; alias: remove; requires root

# Hubs (workspaces)
drumee hub list [--owner <id|email>]
drumee hub get <id|ident>
drumee hub members <id|ident>
drumee hub create --name <name> --owner <id|email> [--area <a>] [--domain <d>]
drumee hub delete <id|ident>             # purge; alias: remove; requires root

# System settings (sys_conf)
drumee settings list
drumee settings get <key>
drumee settings set <key> <value>        # value stored as JSON; requires root

# Meta filesystem (per entity shard)
drumee mfs ls     --entity <id|email> [--parent <node>] [--type <category>]
drumee mfs node   --entity <id|email> --id <node>
drumee mfs import --entity <id|email> --src <path> [--parent <node>] [--dest <folder>]
drumee mfs export --entity <id|email> --dest <dir> [--node <id>]
```

Add `--json` to any command for machine-readable output.

## Status (v0.1)

**Implemented:** `user list/get/add/update/delete`, `hub list/get/members/create/delete`,
`settings list/get/set`, `mfs ls/node/import/export`. (`delete` aliases `remove`.)

`user add` and `hub create` both claim a pre-provisioned entity from the factory
warm pool — if the pool is empty they report `EMPTY_FACTORY` (start/await the
factory daemon). When `--password` is omitted, `user add` generates one and prints
it once as `generatedPassword`.

`delete` is a full **purge**: it unshares the entity from every hub it belongs
to, deletes its physical storage from disk, and drops the account/workspace and
its database — irreversible, requires root.

Physical deletion is double-guarded: the target directory must lie strictly
inside `mfs_dir` **and** must contain no other tenant's `home_dir` (checked
against `yp.entity`), so a purge can never touch another tenant's files.

`mfs import` copies a local file/tree into a shard (creating nodes via
`mfs_create_node` and copying blobs to `<home_dir>/__storage__/<id>/orig.<ext>`);
`mfs export` walks the shard's `media` table and copies the blobs back out,
rebuilding the folder hierarchy.

**Planned:** the remote `--backend api`. The `api` backend exists and reports a
clear "not implemented yet" message.

## Architecture

```
bin/drumee.js            # commander entry: global options + command groups
src/
  context.js             # per-invocation context: backend lifecycle + output
  backend/
    index.js             # createBackend("db"|"api")
    db/                   # DbBackend — Mariadb(yp) + Cache; resource stores:
      users.js  hubs.js  settings.js  mfs.js
    api/index.js         # ApiBackend — remote service API (planned)
  commands/              # user.js hub.js settings.js mfs.js (commander wiring)
  lib/                   # output (tables/json), errors
```

Every command calls an abstract backend resource (`backend.user.list()`, etc.). The DB
backend resolves an entity's shard database (`db_name`) and prefixes per-entity procedure
calls — e.g. `<x>_ab12….show_hubs` (the leading `<x>_` is an arbitrary bucket character,
not a type marker). See the
[Database Sharding](https://docs.drumee.com/technology/07-database-sharding) docs for the
underlying model.

## License

AGPL-3.0
