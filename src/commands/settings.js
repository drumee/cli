/**
 * `drumee settings …` — manage system settings (yp.sys_conf).
 */
module.exports = function registerSettings(program, ctx) {
  const settings = program
    .command("settings")
    .description("Manage system settings (sys_conf)");

  settings
    .command("list")
    .description("List all settings")
    .action(ctx.runner((backend) => backend.settings.list()));

  settings
    .command("get <key>")
    .description("Show a single setting")
    .action(ctx.runner((backend, _opts, key) => backend.settings.get(key)));

  settings
    .command("set <key> <value>")
    .description("Set a setting (value stored as JSON; requires root)")
    .action(
      ctx.runner((backend, _opts, key, value) => backend.settings.set(key, value))
    );
};
