#!/usr/bin/env node

/**
 * @license
 * Copyright 2024 Thidima SA. All Rights Reserved.
 * Licensed under the GNU AFFERO GENERAL PUBLIC LICENSE, Version 3 (the "License");
 * you may obtain a copy of the License at https://www.gnu.org/licenses/agpl-3.0.html
 */

const { Command } = require("commander");
const { version } = require("../package.json");
const { Context } = require("../src/context");
const registerUser = require("../src/commands/user");
const registerHub = require("../src/commands/hub");
const registerSettings = require("../src/commands/settings");
const registerMfs = require("../src/commands/mfs");

const program = new Command();

program
  .name("drumee")
  .description("Manage a Drumee instance — users, hubs, settings, and the meta filesystem")
  .version(version, "-v, --version")
  // Global options shared by every command group.
  .option("--backend <kind>", "backend to talk to: db | api", "db")
  .option("--domain <id>", "domain id to scope operations to", "1")
  .option("--json", "output raw JSON instead of formatted tables", false)
  .option("--verbose", "verbose logging", false);

// A single Context is created per invocation and handed to every command via
// commander's action hook. It lazily opens the backend connection on first use
// and is closed once the command resolves (see runner() in src/context.js).
const ctx = new Context(program);

registerUser(program, ctx);
registerHub(program, ctx);
registerSettings(program, ctx);
registerMfs(program, ctx);

program.parseAsync(process.argv).catch((err) => {
  ctx.fail(err);
});
