import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const catalog = join(root, "services", "catalogs");
const archive = join(root, "services", "archive");
const findings = join(root, "services", "findings");
const gaiaMode = process.env.CATALOGS_LIVE ?? "1";
const liveGaia = /^(1|true|yes|on)$/i.test(gaiaMode.trim());
const services = {
  gaia: {
    directory: catalog,
    cwd: catalog,
    requirements: ["-r", liveGaia ? "requirements-live.txt" : "requirements.txt"],
    args: ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8010"],
  },
  spherex: {
    directory: archive,
    cwd: root,
    minPythonMinor: 12,
    requirements: ["-r", "requirements.lock"],
    args: ["-m", "services.archive", "serve", "--port", "8000"],
  },
  // Reuses the archive's Python environment and dependencies, so it declares no
  // requirements of its own; setup() skips the install step and runs the shared venv.
  wise: {
    directory: archive,
    cwd: root,
    minPythonMinor: 12,
    args: ["-m", "services.wise", "serve", "--port", "8020"],
  },
  // Needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVER_KEY and
  // SPHEREX_COMPARISON_BASE_URL in the environment; see services/findings/README.md.
  findings: {
    directory: findings,
    cwd: root,
    requirements: ["-r", "requirements.txt", "-c", "constraints.txt"],
    args: ["-m", "uvicorn", "services.findings.main:create_app", "--factory", "--host", "127.0.0.1", "--port", "8014"],
  },
};

const name = process.argv[2];
if (!Object.hasOwn(services, name)) {
  console.error("Choose a development service: gaia, spherex, wise or findings.");
  process.exit(1);
}

const service = services[name];
const windows = process.platform === "win32";
const venv = join(service.directory, ".venv");
const python = windows ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python");
const minMinor = service.minPythonMinor ?? 11;
const supportedVersion = `sys.version_info >= (3, ${minMinor})`;

let child;
let stopSignal;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopSignal ??= signal;
    child?.kill(signal);
  });
}

function signalExitCode(signal) {
  return signal === "SIGINT" ? 130 : 143;
}

function run(command, args, cwd, env = process.env) {
  if (stopSignal) return Promise.resolve(signalExitCode(stopSignal));
  return new Promise((resolve, reject) => {
    child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      child = undefined;
      resolve(stopSignal ? signalExitCode(stopSignal) : code ?? signalExitCode(signal));
    });
  });
}

function pythonPasses(command, args) {
  return spawnSync(command, args, {
    cwd: root, stdio: "ignore", timeout: 5000,
  }).status === 0;
}

function findBasePython() {
  const override = process.env.SPHEREX_DEV_PYTHON;
  const candidates = override ? [[override]]
    : windows ? [["python"], ["py", "-3"], ["python3"]]
    : [["python3"], ["python"]];
  const baseCheck = `import ensurepip, sys, venv; sys.exit(not (${supportedVersion}))`;
  const interpreter = candidates.find(([command, ...args]) =>
    pythonPasses(command, [...args, "-c", baseCheck]));
  if (interpreter) return interpreter;
  throw new Error(`Python 3.${minMinor}+ with venv and ensurepip is required for ${name}. Install it on PATH or set SPHEREX_DEV_PYTHON to a compatible executable.`);
}

async function setup() {
  if (!existsSync(python)) {
    const [command, ...args] = findBasePython();
    console.log(`Creating Python environment at ${venv}`);
    if (await run(command, [...args, "-m", "venv", venv], root)) {
      throw new Error("Could not create the virtual environment. Check that your Python installation includes venv and ensurepip.");
    }
  }
  const venvCheck = `import sys; sys.exit(not (${supportedVersion} and sys.prefix != sys.base_prefix))`;
  if (!pythonPasses(python, ["-c", venvCheck])) {
    throw new Error(`The environment at ${venv} needs a working Python 3.${minMinor}+. Move that .venv aside and rerun the command to recreate it.`);
  }
  if (!pythonPasses(python, ["-m", "pip", "--version"])) {
    if (await run(python, ["-m", "ensurepip", "--upgrade"], service.directory)) {
      throw new Error(`Could not install pip in ${venv}.`);
    }
  }
  // Pip reuses installed packages that satisfy the requirements and repairs missing ones.
  // Services without their own requirements (e.g. wise) reuse another service's venv; skip install.
  if (!service.requirements) return;
  console.log(`Checking Python dependencies for ${name}`);
  const pipArgs = ["-m", "pip", "--require-virtualenv", "--disable-pip-version-check",
    "install", "--quiet", "--no-input", ...service.requirements];
  if (await run(python, pipArgs, service.directory)) {
    throw new Error(`Could not install Python dependencies for ${name}. See pip's output above.`);
  }
}

try {
  await setup();
  const env = name === "gaia" ? { ...process.env, CATALOGS_LIVE: gaiaMode } : process.env;
  process.exitCode = await run(python, service.args, service.cwd, env);
} catch (error) {
  if (!stopSignal) console.error(error.message);
  process.exitCode = stopSignal ? signalExitCode(stopSignal) : 1;
}
