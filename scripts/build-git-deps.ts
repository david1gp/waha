#!/usr/bin/env bun
// Build git-protocol dependencies whose compiled outputs are missing.
//
// bun clones git dependencies without running their `prepare` scripts, and
// those scripts could not run in place anyway:
// - wa-js/wppconnect webpack configs use `exclude: /node_modules/`, which
//   matches the dependency's own sources when built inside node_modules.
// - Baileys' tsc declaration emit rewrites imports to the package self-name
//   (`@adiwajshing/baileys/src/...`) when compiled under node_modules, so
//   WAHA's own build would typecheck Baileys' sources instead of its lib.
// - Bun blocks git-dependency lifecycle scripts unless trusted; trusting
//   them is not enough either (husky/webpack/shx binaries are devDeps,
//   absent from the installed tree).
//
// So after every install this script builds each dep in a scratch copy
// outside node_modules with the dep's own toolchain, then copies the
// outputs (lib/, dist/) back. Skipped per dep when its marker file already
// exists: bun re-extracts a git dep whenever its commit or our patch
// changes, so a present marker always matches the current tree.
//
// Deliberately NOT run: the deps' `prepare` scripts. They start with
// `husky install`, which would write into this repo's git config. The
// script runs the build steps (`clean` + `build`) directly instead.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const rootBin = join(repoRoot, "node_modules", ".bin");

type GitDepBuild = {
  name: string;
  dir: string;
  marker: string;
  outputs: string;
  build: (work: string) => void;
};

const gitDepBuilds: GitDepBuild[] = [
  {
    name: "@adiwajshing/baileys",
    dir: join(repoRoot, "node_modules", "@adiwajshing", "baileys"),
    marker: join("lib", "index.js"),
    outputs: "lib",
    build: baileysBuild,
  },
  {
    name: "@wppconnect-team/wppconnect",
    dir: join(repoRoot, "node_modules", "@wppconnect-team", "wppconnect"),
    marker: join("dist", "index.js"),
    outputs: "dist",
    build: (work) => {
      npm(["ci", "--ignore-scripts", "--legacy-peer-deps"], work);
      npm(["run", "build"], work);
    },
  },
  {
    name: "@wppconnect/wa-js",
    dir: join(repoRoot, "node_modules", "@wppconnect", "wa-js"),
    marker: join("dist", "wppconnect-wa.js"),
    outputs: "dist",
    build: (work) => {
      npm(["ci", "--ignore-scripts", "--legacy-peer-deps"], work);
      npm(["run", "clean"], work);
      npm(["run", "build:prd"], work);
    },
  },
];

function npm(args: string[], cwd: string): void {
  // Browser downloads are never needed for a type/build-only tree; skip
  // them even when the caller did not export the skip flags.
  const env = {
    ...process.env,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:
      process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD ?? "1",
    PUPPETEER_SKIP_DOWNLOAD: process.env.PUPPETEER_SKIP_DOWNLOAD ?? "1",
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD:
      process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD ?? "1",
  };
  const flags =
    args[0] === "install"
      ? [...args, "--no-audit", "--no-fund", "--no-save"]
      : [...args, "--no-audit", "--no-fund"];
  const result = spawnSync("npm", flags, {
    cwd,
    env,
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(
      `npm ${args.join(" ")} failed in ${cwd}: npm not found (${result.error.message})`,
    );
  }
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} failed in ${cwd}`);
  }
}

function run(file: string, args: string[], cwd: string): void {
  const result = spawnSync(file, args, { cwd, stdio: "inherit" });
  if (result.error) {
    throw new Error(`${file} ${args.join(" ")} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${file} ${args.join(" ")} exited with ${result.status}`);
  }
}

// Baileys is built with the repo's own TypeScript (same version WAHA
// builds with) and the repo's @types set, minus the deprecated
// @types/sqlite3 stub (empty package, tsc reports TS2688 for it). Fresh
// @types/node instead breaks the build (stream/web vs DOM ReadableStream),
// so the dep's own nested @types must not leak in either.
function baileysPatch(work: string): void {
  // One-line source fix, applied here (not via bun patchedDependencies,
  // which cannot address git dependencies in bun 1.4.x): with
  // noUncheckedIndexedAccess the Float32Array index below is
  // number|undefined and some @types/node floats reject the Math.abs call.
  // The index is always in bounds (blockStart + j < rawData.length), so
  // `?? 0` changes no runtime behavior. If this no longer applies, the
  // Baileys commit moved: refresh the strings for the new sources.
  const file = join(work, "src", "Utils", "messages-media.ts");
  const oldLine =
    "\t\t\t\tsum = sum + Math.abs(rawData[blockStart + j]) // find the sum of all the samples in the block";
  const newLine =
    "\t\t\t\tsum = sum + Math.abs(rawData[blockStart + j] ?? 0) // find the sum of all the samples in the block";
  const before = readFileSync(file, "utf8");
  const occurrences = before.split(oldLine).length - 1;
  if (occurrences === 0 && before.includes(newLine)) {
    console.log("[git-deps] @adiwajshing/baileys: patch already present");
    return;
  }
  if (occurrences !== 1) {
    throw new Error(
      `Baileys patch does not apply (found ${occurrences} occurrences): refresh it for the new Baileys commit`,
    );
  }
  writeFileSync(file, before.replace(oldLine, newLine));
  console.log("[git-deps] @adiwajshing/baileys: type patch applied");
}

function baileysBuild(work: string): void {
  baileysPatch(work);
  npm(["install", "--ignore-scripts", "--legacy-peer-deps"], work);
  const tsc = join(rootBin, "tsc");
  if (!existsSync(tsc)) {
    throw new Error(`repo TypeScript not found at ${tsc}`);
  }
  const typeRoots = join(repoRoot, "node_modules", "@types");
  const types = readdirSync(typeRoots)
    .filter((entry) => entry !== "sqlite3")
    .join(",");
  run(tsc, ["-P", join(work, "tsconfig.build.json"), "--types", types,
    "--typeRoots", typeRoots], work);
  run(join(work, "node_modules", ".bin", "tsc-esm-fix"),
    ["--tsconfig=" + join(work, "tsconfig.build.json"), "--ext=.js"], work);
}

function copyTreeExcludingArtifacts(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, {
    recursive: true,
    filter: (path) => {
      if (path === src) {
        return true;
      }
      const leaf = path.slice(src.length + 1).split("/")[0];
      return leaf !== "node_modules" && leaf !== ".git"
        && leaf !== "lib" && leaf !== "dist";
    },
  });
}

function buildGitDep(dep: GitDepBuild): void {
  if (!existsSync(dep.dir)) {
    console.log(`[git-deps] ${dep.name}: not installed, skipping`);
    return;
  }
  if (existsSync(join(dep.dir, dep.marker))) {
    console.log(`[git-deps] ${dep.name}: ${dep.marker} present, skipping`);
    return;
  }
  const work = join(tmpdir(), `waha-gitdep-${Date.now()}-${process.pid}`);
  console.log(`[git-deps] ${dep.name}: building in ${work}`);
  try {
    copyTreeExcludingArtifacts(dep.dir, work);
    dep.build(work);
    const built = join(work, dep.outputs);
    if (!existsSync(built)) {
      throw new Error(`${dep.name}: build left no ${dep.outputs}/ in ${work}`);
    }
    rmSync(join(dep.dir, dep.outputs), { recursive: true, force: true });
    cpSync(built, join(dep.dir, dep.outputs), { recursive: true });
    rmSync(work, { recursive: true, force: true });
  } catch (error) {
    throw new Error(
      `[git-deps] ${dep.name} build failed (work dir kept at ${work}): ${(error as Error).message}`,
    );
  }
  console.log(`[git-deps] ${dep.name}: ${dep.outputs}/ built`);
}

for (const dep of gitDepBuilds) {
  buildGitDep(dep);
}
