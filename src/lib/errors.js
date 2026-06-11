/**
 * Thrown by operations not yet implemented in this CLI version. Carries a clear,
 * actionable message so the command surface can be complete and self-documenting
 * while heavier flows (e.g. account provisioning) are built out.
 */
class NotImplemented extends Error {
  constructor(what, detail) {
    super(
      `"${what}" is not implemented yet in @drumee/cli v0.1` +
        (detail ? ` — ${detail}` : "")
    );
    this.name = "NotImplemented";
  }
}

/** Guard: throw unless the process runs as root. */
function requireRoot(action) {
  const { userInfo } = require("os");
  if (userInfo().username !== "root") {
    throw new Error(`"${action}" requires root privilege`);
  }
}

module.exports = { NotImplemented, requireRoot };
