/**
 * `drumee mfs …` — inspect the meta filesystem of a hub or user shard.
 */
module.exports = function registerMfs(program, ctx) {
  const mfs = program
    .command("mfs")
    .description("Inspect the meta filesystem (per entity shard)");

  mfs
    .command("ls")
    .description("List nodes under a parent folder")
    .requiredOption("--entity <key>", "hub/user id or ident (selects the shard)")
    .option("--parent <id>", "parent node id (defaults to root)", "*")
    .option("--type <category>", "filter by category (folder|file|…)")
    .action(ctx.runner((backend, opts) => backend.mfs.ls(opts)));

  mfs
    .command("node")
    .description("Show a single node's metadata")
    .requiredOption("--entity <key>", "hub/user id or ident (selects the shard)")
    .requiredOption("--id <id>", "node id")
    .option("--uid <uid>", "viewer uid for permission resolution", "")
    .action(ctx.runner((backend, opts) => backend.mfs.node(opts)));

  mfs
    .command("import")
    .description("Import content into a shard (planned)")
    .action(ctx.runner((backend, opts) => backend.mfs.import(opts)));

  mfs
    .command("export")
    .description("Export content from a shard (planned)")
    .action(ctx.runner((backend, opts) => backend.mfs.export(opts)));
};
