const Table = require("cli-table3");

/**
 * Render a command result to stdout.
 *
 * - `--json` → pretty-printed JSON (machine-readable, stable for piping).
 * - array of objects → a table (columns inferred from the first row, or the
 *   caller-supplied `columns` list).
 * - anything else → JSON.
 *
 * @param {*} data
 * @param {{json?: boolean, columns?: string[]}} opts
 */
function print(data, opts = {}) {
  if (data === undefined || data === null) return;

  if (opts.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      process.stdout.write("(no results)\n");
      return;
    }
    if (typeof data[0] === "object" && data[0] !== null) {
      const columns = opts.columns || Object.keys(data[0]);
      const table = new Table({ head: columns });
      for (const row of data) {
        table.push(columns.map((c) => format(row[c])));
      }
      process.stdout.write(table.toString() + "\n");
      return;
    }
    process.stdout.write(data.join("\n") + "\n");
    return;
  }

  if (typeof data === "object") {
    const table = new Table();
    for (const [k, v] of Object.entries(data)) {
      table.push({ [k]: format(v) });
    }
    process.stdout.write(table.toString() + "\n");
    return;
  }

  process.stdout.write(String(data) + "\n");
}

function format(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

module.exports = { print };
