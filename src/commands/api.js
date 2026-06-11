const { ApiClient } = require("../backend/api/client");
const config = require("../lib/config");

/**
 * `drumee api …` — manage the remote service-API connection and call services
 * directly. These commands manage their own credentials (login can't go through
 * a connected backend), so they build an ApiClient inline rather than via
 * ctx.runner.
 */
module.exports = function registerApi(program, ctx) {
  const api = program
    .command("api")
    .description("Remote service API: login and call /-/svc/ services");

  // Run an inline action with the standard output/exit/error handling.
  const run = (fn) => async (...args) => {
    const command = args[args.length - 1];
    const opts = args[args.length - 2];
    const positionals = args.slice(0, args.length - 2);
    try {
      const result = await fn(opts, ...positionals);
      if (result !== undefined) ctx.output(result);
      await ctx._exit(0);
    } catch (err) {
      await ctx.fail(err);
    }
  };

  // The instance host comes from the global `--host` (or DRUMEE_HOST); it binds
  // to the program options regardless of position, so we read it from ctx.
  const resolveHost = () => ctx.opts.host || process.env.DRUMEE_HOST;

  api
    .command("login")
    .description("Authenticate to a Drumee instance and cache the token (--host required)")
    .option("--email <email>", "account email (with --password)")
    .option("--password <password>", "account password (with --email)")
    .option("--token <token>", "use a pre-issued token instead of email/password")
    .action(
      run(async (opts) => {
        const host = resolveHost();
        if (!host) throw new Error("pass --host <url> (e.g. https://drumee.in/-/somanos/)");
        let token = opts.token;
        if (!token) {
          if (!opts.email || !opts.password) {
            throw new Error("provide --token, or both --email and --password");
          }
          const client = new ApiClient({ host });
          const authorization =
            "Basic " + Buffer.from(`${opts.email}:${opts.password}`).toString("base64");
          const data = await client.call("authn.create", {}, { authorization });
          token = data && data.token;
          if (!token) throw new Error("login failed: no token returned by authn.create");
        }
        config.save({ host, token });
        return { host, token: `${String(token).slice(0, 4)}…`, saved: config.FILE };
      })
    );

  api
    .command("logout")
    .description("Forget the cached credentials")
    .action(
      run(async () => {
        config.clear();
        return { cleared: config.FILE };
      })
    );

  api
    .command("whoami")
    .description("Show the configured host (and whether a token is cached)")
    .action(
      run(async () => {
        const cfg = config.load();
        return {
          host: cfg.host || "(unset)",
          authenticated: Boolean(cfg.token || (cfg.keysel && cfg.sid)),
          config: config.FILE,
        };
      })
    );

  api
    .command("call <service>")
    .description("Call a service (module.method) and print the result")
    .option("--data <json>", "JSON request payload", "{}")
    .option("--get", "use a GET request instead of POST", false)
    .action(
      run(async (opts, service) => {
        const cfg = config.load();
        const host = resolveHost() || cfg.host;
        const token = process.env.DRUMEE_TOKEN || cfg.token;
        const client = new ApiClient({
          host,
          token,
          keysel: cfg.keysel,
          sid: cfg.sid,
          verbose: ctx.opts.verbose,
        });
        let payload;
        try {
          payload = JSON.parse(opts.data);
        } catch (_) {
          throw new Error(`--data must be valid JSON (got: ${opts.data})`);
        }
        return client.call(service, payload, { method: opts.get ? "GET" : "POST" });
      })
    );
};
