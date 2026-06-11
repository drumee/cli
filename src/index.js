/**
 * Programmatic entry point for @drumee/cli.
 *
 * The CLI binary lives at bin/drumee.js; this module re-exports the building
 * blocks so the backends can also be embedded in other Node tooling.
 */
const { createBackend } = require("./backend");
const { Context } = require("./context");

module.exports = { createBackend, Context };
