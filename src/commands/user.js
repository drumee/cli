/**
 * `drumee user …` — manage users (drumates).
 */
module.exports = function registerUser(program, ctx) {
  const user = program.command("user").description("Manage users (drumates)");

  user
    .command("list")
    .description("List users")
    .option("--email <pattern>", "filter by email (SQL LIKE pattern)")
    .option("--category <category>", "filter by profile category")
    .action(ctx.runner((backend, opts) => backend.user.list(opts)));

  user
    .command("get <key>")
    .description("Show a user by id or email")
    .action(ctx.runner((backend, _opts, key) => backend.user.get(key)));

  user
    .command("delete <key>")
    .alias("remove")
    .description(
      "Purge a user by id or email: unshare from all hubs, delete physical storage, drop the account (requires root)"
    )
    .action(ctx.runner((backend, _opts, key) => backend.user.delete(key)));

  user
    .command("add")
    .description("Create a user (planned)")
    .option("--email <email>", "user email")
    .option("--firstname <name>", "first name")
    .option("--lastname <name>", "last name")
    .option("--password <password>", "initial password")
    .action(ctx.runner((backend, opts) => backend.user.add(opts)));

  user
    .command("update <key>")
    .description("Update a user (planned)")
    .action(ctx.runner((backend, opts, key) => backend.user.update(key, opts)));
};
