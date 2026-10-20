// Rebuild the shared product library data file from NREL SAM's CEC module list.
// Usage: pnpm --filter @goinstall/db build-library <path to "CEC Modules.csv">
// Source: https://github.com/NREL/SAM/blob/develop/deploy/libraries/CEC%20Modules.csv
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { parseCecModules } from "@goinstall/core";

const file = process.argv[2];
if (!file) throw new Error("Pass the path to SAM's CEC Modules.csv");
const { products, version, skipped } = parseCecModules(readFileSync(file, "utf8"));
const out = new URL("../data/library-panels.json.gz", import.meta.url);
writeFileSync(out, gzipSync(JSON.stringify({ source: "cec", version, products })));
console.log(`${products.length} panels (library ${version}), ${skipped} rows skipped → ${out.pathname}`);
