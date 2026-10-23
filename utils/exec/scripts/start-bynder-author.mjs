import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const envFile = path.join(projectRoot, ".env");
const source = await readFile(envFile, "utf8");
const values = Object.fromEntries(
  source
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([^#=\s]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value])
);

if (!values.bynder || !values["bynder-url"]) {
  throw new Error(".env must define both bynder and bynder-url.");
}

const child = spawn("./mgnl", ["startx", "--author", "--noclean", "--nomail"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    BYNDER_TOKEN: values.bynder,
    BYNDER_URL: values["bynder-url"],
  },
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 1));
