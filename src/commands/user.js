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
    .option("--verbose", "also show db_name, home_id and home_dir")
    // runner() already folds the global --verbose into opts.verbose.
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
    .description("Create a user (drumate)")
    .requiredOption("--email <email>", "user email")
    .option("--firstname <name>", "first name")
    .option("--lastname <name>", "last name")
    .option("--username <name>", "username (derived from name/email if omitted)")
    .option("--domain <domain>", "domain name (defaults to the instance domain)")
    .option("--lang <lang>", "language", "en")
    .option("--category <category>", "profile category")
    .option("--privilege <n>", "domain privilege level")
    .option("--password <password>", "initial password (random if omitted)")
    .action(ctx.runner((backend, opts) => backend.user.add(opts)));

  user
    .command("update <key>")
    .description("Update a user's fields (by id or email)")
    .option("--firstname <name>", "first name")
    .option("--lastname <name>", "last name")
    .option("--username <name>", "username")
    .option("--email <email>", "email address")
    .option("--mobile <mobile>", "mobile number")
    .option("--lang <lang>", "language")
    .option("--category <category>", "profile category")
    .option("--quota <bytes>", "storage quota")
    .option("--password <password>", "new password")
    .action(ctx.runner((backend, opts, key) => backend.user.update(key, opts)));
};
