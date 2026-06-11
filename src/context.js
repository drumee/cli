const { createBackend } = require("./backend");
const { print } = require("./lib/output");

/**
 * Per-invocation runtime context.
 *
 * Holds the parsed global options, lazily constructs the chosen backend
 * (db | api), and provides a `runner()` helper that command actions wrap their
 * logic in. The runner guarantees the backend is connected before the action
 * runs and disconnected (and the process exited cleanly) afterwards — so each
 * command file only has to express *what* it does, not connection lifecycle.
 */
class Context {
  constructor(program) {
    this.program = program;
    this._backend = null;
  }

  /** Global options resolved from the root command at action time. */
  get opts() {
    return this.program.opts();
  }

  /** Lazily build + connect the backend on first access. */
  async backend() {
    if (!this._backend) {
      const { backend, domain, verbose } = this.opts;
      this._backend = createBackend(backend, { domain, verbose });
      await this._backend.connect();
    }
    return this._backend;
  }

  /**
   * Wrap a command action. Usage in a command file:
   *
   *   .action(ctx.runner(async (backend, options) => { ... }))
   *
   * `fn` receives the connected backend and the command's own options.
   */
  runner(fn) {
    return async (...args) => {
      // commander passes (…positionalArgs, options, command). We forward the
      // command's options object (second-to-last arg) and the positional args.
      const options = args[args.length - 2];
      const positionals = args.slice(0, args.length - 2);
      // Resolve verbosity once: a command's own --verbose OR the global flag.
      if (options && typeof options === "object") {
        options.verbose = options.verbose || this.opts.verbose || false;
      }
      try {
        const backend = await this.backend();
        const result = await fn(backend, options, ...positionals);
        if (result !== undefined) this.output(result);
        await this.close();
        await this._exit(0);
      } catch (err) {
        await this.fail(err);
      }
    };
  }

  /** Wait for stdout/stderr to drain, then exit — avoids truncating piped output. */
  async _exit(code) {
    await Promise.all(
      [process.stdout, process.stderr].map(
        (s) =>
          new Promise((resolve) => {
            if (s.writableLength === 0) resolve();
            else s.once("drain", resolve);
          })
      )
    );
    process.exit(code);
  }

  /** Render a result respecting the global --json flag. */
  output(data, columns) {
    print(data, { json: this.opts.json, columns });
  }

  async close() {
    if (this._backend) await this._backend.disconnect();
  }

  /** Print an error, close the backend, and exit non-zero. */
  async fail(err) {
    const msg = err && err.message ? err.message : String(err);
    process.stderr.write(`drumee: ${msg}\n`);
    if (this.opts && this.opts.verbose && err && err.stack) {
      process.stderr.write(`${err.stack}\n`);
    }
    try {
      await this.close();
    } catch (_) {
      /* ignore close errors during failure */
    }
    await this._exit(1);
  }
}

module.exports = { Context };
