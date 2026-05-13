import fs from "node:fs";
import path from "node:path";

const MAX_BUDGET_LIMITS = {
  max_iterations: 100,
  max_runtime_minutes: 1440,
  max_diff_lines: 10000,
};

const REQUIRED_SECRET_PROTECTIONS = [".env", "secrets/**"];

const DESTRUCTIVE_PATTERNS = [
  /(^|\s)rm\s+[^\n;|&]*-[^\n;|&]*r[^\n;|&]*f[^\n;|&]*(\s+|=)(\/|~)(\s|$|;|&&|\|\|)/i,
  /(^|\s)rm\s+[^\n;|&]*-[^\n;|&]*f[^\n;|&]*r[^\n;|&]*(\s+|=)(\/|~)(\s|$|;|&&|\|\|)/i,
  /(^|\s)git\s+reset\s+--hard(\s|$)/i,
  /(^|\s)git\s+push\b[^\n]*(--force|-f|--mirror)(\s|$)/i,
  /(^|\s)(cat|less|more|tail|head|cp|scp|rsync)\s+[^\n;|&]*(\/etc\/passwd|\/etc\/shadow|\.ssh\/|id_rsa|id_ed25519|credentials\.json|\.npmrc|\.pypirc)(\s|$)/i,
  /(^|\s)(curl|wget|nc|netcat|telnet|ftp|ssh|scp|sftp|python\s+-m\s+http\.server|npx\s+playwright|playwright|puppeteer)(\s|$)/i,
];

const SHELL_CONTROL_PATTERN = /[;&|`$<>]/;

function fail(reason: any): any {
  throw new Error(`Safety preflight failed: ${reason}`);
}

function normalizeCommand(command: any): any {
  return String(command || "").trim().replace(/\s+/g, " ");
}

function shellWords(command: any): any {
  return normalizeCommand(command).match(/"[^"]*"|'[^']*'|\S+/g) || [];
}

function hasShellControls(command: any): any {
  return SHELL_CONTROL_PATTERN.test(command.replace(/"[^"]*"|'[^']*'/g, ""));
}

function isCommandAllowed(command: any, allowedCommands: any): any {
  const normalizedCommand = normalizeCommand(command);
  if (normalizedCommand === "" || !Array.isArray(allowedCommands)) return false;

  return allowedCommands.some((allowed) => {
    const normalizedAllowed = normalizeCommand(allowed);
    if (normalizedAllowed === "") return false;
    if (normalizedCommand === normalizedAllowed) return true;

    const allowedWords = shellWords(normalizedAllowed);
    const commandWords = shellWords(normalizedCommand);
    if (allowedWords.length === 0 || allowedWords.length > commandWords.length) return false;
    if (hasShellControls(normalizedAllowed) || hasShellControls(normalizedCommand)) return false;

    return allowedWords.every((word: any, index: number) => word === commandWords[index]);
  });
}

function escapeRegex(value: any): any {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(pattern: any): any {
  const normalized = normalizeRelativePath(pattern);
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += escapeRegex(char);
    }
  }
  return new RegExp(`^${source}$`);
}

function normalizeRelativePath(value: any): any {
  const normalized = path.posix.normalize(String(value || "").replace(/\\/g, "/").replace(/^\.\//, ""));
  return normalized === "." ? "" : normalized;
}

function pathVariants(candidate: any): any {
  const normalized = normalizeRelativePath(candidate);
  const base = path.posix.basename(normalized);
  return [normalized, base].filter(Boolean);
}

function isPathProtected(candidatePath: any, protectedPaths: any): any {
  if (!Array.isArray(protectedPaths)) return false;
  const candidates = pathVariants(candidatePath);
  return protectedPaths.some((pattern: any) => {
    const matcher = globToRegex(pattern);
    return candidates.some((candidate: any) => matcher.test(candidate));
  });
}

function extractTouchedPathsFromDiff(diff: any): any {
  const touchedPaths = new Set();
  const lines = String(diff || "").split("\n");

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const parts = line.split(" ");
      const left = parts[2];
      const right = parts[3];
      if (left && left !== "/dev/null") touchedPaths.add(normalizeRelativePath(left.replace(/^a\//, "")));
      if (right && right !== "/dev/null") touchedPaths.add(normalizeRelativePath(right.replace(/^b\//, "")));
      continue;
    }

    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const candidate = line.slice(4).trim();
      if (candidate && candidate !== "/dev/null") {
        touchedPaths.add(normalizeRelativePath(candidate.replace(/^[ab]\//, "")));
      }
      continue;
    }

    if (line.startsWith("rename from ")) {
      touchedPaths.add(normalizeRelativePath(line.slice("rename from ".length).trim()));
      continue;
    }

    if (line.startsWith("rename to ")) {
      touchedPaths.add(normalizeRelativePath(line.slice("rename to ".length).trim()));
    }
  }

  return [...touchedPaths].filter(Boolean);
}

function verifyNoProtectedPathTouched(diff: any, protectedPaths: any): any {
  const touchedPaths = extractTouchedPathsFromDiff(diff);
  const protectedPath = touchedPaths.find((candidate: any) => isPathProtected(candidate, protectedPaths));
  if (protectedPath) {
    throw Object.assign(new Error(`protected path touched: ${protectedPath}`), {
      code: "protected_path_touched",
      protectedPath,
      touchedPaths,
    });
  }
  return { touched_paths: touchedPaths };
}

function isDestructiveCommand(command: any): any {
  const normalized = normalizeCommand(command);
  if (normalized === "") return true;
  return DESTRUCTIVE_PATTERNS.some((pattern: RegExp) => pattern.test(normalized));
}

function isInsideProject(projectRoot: any, targetPath: any): any {
  const relative = path.relative(projectRoot, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertConfigLoaded(config: any): any {
  if (!config || typeof config !== "object") fail("explicit config is required");
  if (!config.config_path) fail("explicit config_path is required");
  if (!config.project_root) fail("project_root is required");
  if (!fs.existsSync(config.project_root) || !fs.statSync(config.project_root).isDirectory()) {
    fail("project_root must exist before execution");
  }
  if (!Array.isArray(config.allowed_commands)) fail("allowed_commands must be configured");
  if (!Array.isArray(config.protected_paths) || config.protected_paths.length === 0) {
    fail("protected_paths must be configured");
  }
}

function assertWorkspaceBoundary(config: any): any {
  const realProjectRoot = fs.realpathSync(config.project_root);
  const realConfigPath = fs.realpathSync(config.config_path);
  if (!isInsideProject(realProjectRoot, realProjectRoot)) fail("workspace boundary could not be established");
  if (!isInsideProject(path.dirname(realConfigPath), realProjectRoot) && !isInsideProject(realProjectRoot, realConfigPath)) {
    fail("config and workspace boundary are inconsistent");
  }
  return realProjectRoot;
}

function assertWorkspaceTrusted(config: any, workspaceState: any): any {
  const disposableCopy = workspaceState.disposableCopy === true || workspaceState.disposable_copy === true || config.disposable_copy === true;
  if (workspaceState.isGitRepo !== true && workspaceState.gitRepo !== true && !disposableCopy) {
    fail("workspace must be a git repository or explicit disposable copy");
  }
  return disposableCopy;
}

function assertCleanWorktree(config: any, workspaceState: any): any {
  const dirty = workspaceState.dirty === true || workspaceState.hasUncommittedChanges === true;
  const dirtyFiles = Array.isArray(workspaceState.dirtyFiles) ? workspaceState.dirtyFiles : [];
  const permitsDirty = config.allow_dirty_baseline === true || workspaceState.allowDirtyBaseline === true;
  if ((dirty || dirtyFiles.length > 0) && !permitsDirty) fail("dirty worktree requires allow_dirty_baseline");
}

function assertProtectedPaths(config: any, workspaceState: any): any {
  for (const required of REQUIRED_SECRET_PROTECTIONS) {
    if (!config.protected_paths.some((pattern: any) => normalizeRelativePath(pattern) === required)) {
      fail(`required secret protection missing: ${required}`);
    }
  }

  const touchedPaths = [
    ...(Array.isArray(workspaceState.changedPaths) ? workspaceState.changedPaths : []),
    ...(Array.isArray(workspaceState.pendingPaths) ? workspaceState.pendingPaths : []),
    ...(Array.isArray(workspaceState.modifiedPaths) ? workspaceState.modifiedPaths : []),
  ];
  const protectedPath = touchedPaths.find((candidate) => isPathProtected(candidate, config.protected_paths));
  if (protectedPath) fail(`protected path would be modified: ${protectedPath}`);
}

function assertBudgets(config: any, workspaceState: any): any {
  for (const field of Object.keys(MAX_BUDGET_LIMITS) as Array<keyof typeof MAX_BUDGET_LIMITS>) {
    if (!Number.isInteger(config[field]) || config[field] <= 0) fail(`budget ${field} must be a positive integer`);
    if (config[field] > MAX_BUDGET_LIMITS[field]) fail(`budget ${field} exceeds safety limit`);
  }

  const used = workspaceState.budgetUsage || workspaceState.budgets || {};
  if (Number.isFinite(used.iterations) && used.iterations >= config.max_iterations) fail("iteration budget exhausted");
  if (Number.isFinite(used.runtime_minutes) && used.runtime_minutes >= config.max_runtime_minutes) fail("runtime budget exhausted");
  if (Number.isFinite(used.diff_lines) && used.diff_lines >= config.max_diff_lines) fail("diff budget exhausted");
}

function assertCommands(config: any): any {
  const declaredCommands = [
    ...(Array.isArray(config.allowed_commands) ? config.allowed_commands : []),
    ...(Array.isArray(config.baseline_commands) ? config.baseline_commands : []),
  ];

  if ((config.mode || "execute") !== "dry-run" && config.allowed_commands.length === 0) {
    fail("allowed_commands must not be empty in execution mode");
  }

  for (const command of declaredCommands) {
    if (isDestructiveCommand(command)) fail(`destructive or network command blocked: ${command}`);
  }

  for (const command of config.baseline_commands || []) {
    if (!isCommandAllowed(command, config.allowed_commands)) fail(`baseline command is not allowed: ${command}`);
  }
}

function assertSandboxPrepared(config: any, workspaceState: any, disposableCopy: any): any {
  const prepared = workspaceState.managedWorktree === true || workspaceState.sandboxPrepared === true || disposableCopy;
  const branch = String(workspaceState.branch || workspaceState.currentBranch || "");
  const disposableBranch = branch.startsWith("autoresearch/") || branch.startsWith("sisyphus/");
  if (!prepared && !disposableBranch && config.require_managed_worktree !== false) {
    fail("managed worktree or disposable branch is required");
  }
}

function createCommandPolicy(allowedCommands: any): any {
  return {
    allowed_commands: [...allowedCommands],
    isAllowed(command: any): any {
      return !isDestructiveCommand(command) && isCommandAllowed(command, allowedCommands);
    },
  };
}

function preflight(config: any, workspaceState: any = {}): any {
  assertConfigLoaded(config);
  const workspaceBoundary = assertWorkspaceBoundary(config);
  const disposableCopy = assertWorkspaceTrusted(config, workspaceState);
  assertCleanWorktree(config, workspaceState);
  assertProtectedPaths(config, workspaceState);
  assertBudgets(config, workspaceState);
  assertCommands(config);
  assertSandboxPrepared(config, workspaceState, disposableCopy);

  const controls = {
    workspace_boundary: workspaceBoundary,
    sandbox: {
      disposable_copy: disposableCopy,
      managed_worktree: workspaceState.managedWorktree === true || workspaceState.sandboxPrepared === true,
      branch: workspaceState.branch || workspaceState.currentBranch || null,
      allow_dirty_baseline: config.allow_dirty_baseline === true || workspaceState.allowDirtyBaseline === true,
    },
    budgets: {
      max_iterations: config.max_iterations,
      max_runtime_minutes: config.max_runtime_minutes,
      max_diff_lines: config.max_diff_lines,
      used: workspaceState.budgetUsage || workspaceState.budgets || {},
    },
    protectedPathMatcher(candidatePath: any): any {
      return isPathProtected(candidatePath, config.protected_paths);
    },
    commandExecutionPolicy: createCommandPolicy(config.allowed_commands),
  };

  return { approved: true, controls };
}

export {
  isCommandAllowed,
  isDestructiveCommand,
  isPathProtected,
  verifyNoProtectedPathTouched,
  preflight,
};
