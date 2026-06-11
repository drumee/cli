/** Guard: throw unless the process runs as root. */
function requireRoot(action) {
  const { userInfo } = require("os");
  if (userInfo().username !== "root") {
    throw new Error(`"${action}" requires root privilege`);
  }
}

module.exports = { requireRoot };
