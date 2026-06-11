/**
 * `drumee hub …` — manage hubs (workspaces).
 */
module.exports = function registerHub(program, ctx) {
  const hub = program.command("hub").description("Manage hubs (workspaces)");

  hub
    .command("list")
    .description("List hubs (all, or those of a given owner)")
    .option("--owner <key>", "list hubs visible to this user (id/email)")
    .action(ctx.runner((backend, opts) => backend.hub.list(opts)));

  hub
    .command("get <key>")
    .description("Show a hub by id or ident")
    .action(ctx.runner((backend, _opts, key) => backend.hub.get(key)));

  hub
    .command("members <key>")
    .description("List the members of a hub")
    .action(ctx.runner((backend, _opts, key) => backend.hub.members(key)));

  hub
    .command("delete <key>")
    .alias("remove")
    .description(
      "Purge a hub by id or ident: drop all members, delete physical storage, drop the hub (requires root)"
    )
    .action(ctx.runner((backend, _opts, key) => backend.hub.delete(key)));

  hub
    .command("create")
    .description("Create a hub owned by a user")
    .requiredOption("--name <name>", "hub display name")
    .requiredOption("--owner <key>", "owning user (id/email)")
    .option("--area <area>", "visibility: private | restricted | public", "private")
    .option("--domain <domain>", "domain name (defaults to the owner's domain)")
    .option("--description <text>", "hub description")
    .option("--keywords <text>", "hub keywords")
    .action(ctx.runner((backend, opts) => backend.hub.create(opts)));
};
