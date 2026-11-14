import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const catalog = join(root, "services", "catalogs");
const archive = join(root, "services", "archive");
const findings = join(root, "services", "findings");
const services = {
  gaia: {
    directory: catalog,
    cwd: catalog,
    args: ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8010"],
  },
  spherex: {
    directory: archive,
    cwd: root,
    args: ["-m", "services.archive", "serve", "--port", "8000"],
  },
  // Needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVER_KEY and
  // SPHEREX_COMPARISON_BASE_URL in the environment; see services/findings/README.md.
  findings: {
    directory: findings,
    cwd: root,
    args: ["-m", "uvicorn", "services.findings.main:create_app", "--factory", "--host", "127.0.0.1", "--port", "8014"],
  },
};

const service = services[process.argv[2]];
if (!service) {
  console.error("Choose a development service: gaia, spherex or findings.");
  process.exit(1);
}

const python = process.platform === "win32"
  ? join(service.directory, ".venv", "Scripts", "python.exe")
  : join(service.directory, ".venv", "bin", "python");
if (!existsSync(python)) {
  console.error(`Missing Python environment at ${python}. See web/src/viewer/README.md for setup.`);
  process.exit(1);
}

const child = spawn(python, service.args, { cwd: service.cwd, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 143);
});
