import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PROTECTED_PATHS = [".env", "secrets/**"];
const EXECUTION_MODES = new Set(["execute", "run", "mutation"]);
const NON_EXECUTION_MODES = new Set(["dry-run", "report-only"]);

function isExecutionMode(mode: any): boolean {
  return EXECUTION_MODES.has(String(mode || "execute"));
}

function isKnownMode(mode: any): boolean {
  const normalized = String(mode || "execute");
  return EXECUTION_MODES.has(normalized) || NON_EXECUTION_MODES.has(normalized);
}

function countIndent(line: string): number {
  return (line.match(/^ */)?.[0] || "").length;
}

function stripComment(line: string): string {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === '"' || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? null : quote || char;
    }
    if (char === "#" && quote === null) {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseScalar(rawValue: string): any {
  const value = rawValue.trim();
  if (value === "") return "";
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function prepareYamlLines(source: string): string[] {
  return source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(stripComment)
    .filter((line) => line.trim() !== "");
}

function parseYamlBlock(lines: string[], startIndex: number, indent: number): [any, number] {
  const currentLine = lines[startIndex];
  if (currentLine === undefined || countIndent(currentLine) < indent) {
    return [undefined, startIndex];
  }

  if (currentLine.slice(indent).startsWith("- ")) {
    const items: any[] = [];
    let index = startIndex;
    while (index < lines.length && countIndent(lines[index]) === indent && lines[index].slice(indent).startsWith("- ")) {
      const itemText = lines[index].slice(indent + 2).trim();
      if (itemText === "") {
        const parsed = parseYamlBlock(lines, index + 1, indent + 2);
        items.push(parsed[0]);
        index = parsed[1];
        continue;
      }

      const keyValue = itemText.match(/^([^:]+):(.*)$/);
      if (keyValue) {
        const item: Record<string, any> = {};
        const key = keyValue[1].trim();
        const valueText = keyValue[2].trim();
        if (valueText === "") {
          const parsed = parseYamlBlock(lines, index + 1, indent + 2);
          item[key] = parsed[0];
          index = parsed[1];
        } else {
          item[key] = parseScalar(valueText);
          index += 1;
        }

        while (index < lines.length && countIndent(lines[index]) === indent + 2 && !lines[index].slice(indent + 2).startsWith("- ")) {
          const nestedText = lines[index].slice(indent + 2).trim();
          const nestedKeyValue = nestedText.match(/^([^:]+):(.*)$/);
          if (!nestedKeyValue) throw new Error(`Invalid YAML line: ${lines[index].trim()}`);
          const nestedKey = nestedKeyValue[1].trim();
          const nestedValueText = nestedKeyValue[2].trim();
          if (nestedValueText === "") {
            const parsed = parseYamlBlock(lines, index + 1, indent + 4);
            item[nestedKey] = parsed[0];
            index = parsed[1];
          } else {
            item[nestedKey] = parseScalar(nestedValueText);
            index += 1;
          }
        }

        items.push(item);
      } else {
        items.push(parseScalar(itemText));
        index += 1;
      }
    }
    return [items, index];
  }

  const object: Record<string, any> = {};
  let index = startIndex;
  while (index < lines.length && countIndent(lines[index]) === indent && !lines[index].slice(indent).startsWith("- ")) {
    const text = lines[index].slice(indent).trim();
    const keyValue = text.match(/^([^:]+):(.*)$/);
    if (!keyValue) throw new Error(`Invalid YAML line: ${lines[index].trim()}`);
    const key = keyValue[1].trim();
    const valueText = keyValue[2].trim();
    if (valueText === "") {
      const parsed = parseYamlBlock(lines, index + 1, indent + 2);
      object[key] = parsed[0];
      index = parsed[1];
    } else {
      object[key] = parseScalar(valueText);
      index += 1;
    }
  }
  return [object, index];
}

function parseYaml(source: string): any {
  const lines = prepareYamlLines(source);
  if (lines.length === 0) return {};
  const parsed = parseYamlBlock(lines, 0, countIndent(lines[0]));
  return parsed[0];
}

function readConfigFile(configPath: string): any {
  const raw = fs.readFileSync(configPath, "utf8");
  const extension = path.extname(configPath).toLowerCase();
  if (extension === ".json") return JSON.parse(raw);
  if (extension === ".yaml" || extension === ".yml") return parseYaml(raw);
  throw new Error(`Unsupported config file extension: ${extension || "<none>"}`);
}

function assertPresent(config: any, fieldPath: string): any {
  const parts = fieldPath.split(".");
  let value = config;
  for (const part of parts) {
    if (value === undefined || value === null || !Object.prototype.hasOwnProperty.call(value, part)) {
      throw new Error(`Missing required field: ${fieldPath}`);
    }
    value = value[part];
  }
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required field: ${fieldPath}`);
  }
  return value;
}

function assertPositiveInteger(config: any, fieldPath: string): any {
  const value = assertPresent(config, fieldPath);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid required budget: ${fieldPath} must be a positive integer`);
  }
  return value;
}

function assertBoolean(config: any, fieldPath: string): any {
  const value = assertPresent(config, fieldPath);
  if (typeof value !== "boolean") {
    throw new Error(`Invalid required field: ${fieldPath} must be a boolean`);
  }
  return value;
}

function assertString(config: any, fieldPath: string): any {
  const value = assertPresent(config, fieldPath);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid required field: ${fieldPath} must be a non-empty string`);
  }
  return value.trim();
}

function validatePathPattern(value: any, fieldPath: any): any {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid path in ${fieldPath}: paths must be non-empty strings`);
  }
  if (path.isAbsolute(value)) {
    throw new Error(`Invalid path in ${fieldPath}: ${value} must be relative`);
  }
  const normalized = path.posix.normalize(value.replace(/\\/g, "/"));
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Invalid path in ${fieldPath}: ${value} escapes project_root`);
  }
  return value.trim();
}

function normalizeStringList(value: any, fieldPath: any, options: any): any {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid required field: ${fieldPath} must be an array`);
  }
  const normalized = value.map((item) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error(`Invalid entry in ${fieldPath}: commands must be non-empty strings`);
    }
    return item.trim();
  });
  if (options && options.requireNonEmpty && normalized.length === 0) {
    throw new Error(`Invalid required field: ${fieldPath} must not be empty`);
  }
  return normalized;
}

function normalizeProtectedPaths(config: any): any {
  const configured = config.protected_paths === undefined ? DEFAULT_PROTECTED_PATHS : config.protected_paths;
  if (!Array.isArray(configured)) {
    throw new Error("Invalid required field: protected_paths must be an array");
  }
  const seen = new Set();
  return configured
    .map((item) => validatePathPattern(item, "protected_paths"))
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function normalizeCriteria(config: any): any {
  const criteria = assertPresent(config, "criteria");
  if (!Array.isArray(criteria) || criteria.length === 0) {
    throw new Error("Invalid required field: criteria must be a non-empty array");
  }
  return criteria.map((criterion, index) => {
    if (!criterion || typeof criterion !== "object" || Array.isArray(criterion)) {
      throw new Error(`Invalid criterion at criteria[${index}]: must be an object`);
    }
    const normalized: { id: any; description: any; weight?: number } = {
      id: assertString(criterion, "id"),
      description: assertString(criterion, "description"),
    };
    if (criterion.weight !== undefined) {
      if (typeof criterion.weight !== "number" || Number.isNaN(criterion.weight) || criterion.weight < 0) {
        throw new Error(`Invalid criterion at criteria[${index}]: weight must be a non-negative number`);
      }
      normalized.weight = criterion.weight;
    }
    return normalized;
  });
}

function normalizeDecisionRule(policy: any, fieldPath: any): any {
  const value = assertPresent(policy, fieldPath);
  if (typeof value === "string") {
    if (value.trim() === "") throw new Error(`Invalid required field: decision_policy.${fieldPath} must not be empty`);
    return value.trim();
  }
  if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) {
    return value;
  }
  throw new Error(`Invalid required field: decision_policy.${fieldPath} must be a non-empty string or rule object`);
}

function normalizeInterview(config: any): any {
  const interview = config.interview;
  if (interview === undefined) {
    return {
      required: true,
      status: "pending",
      answers: {},
    };
  }

  if (!interview || typeof interview !== "object" || Array.isArray(interview)) {
    throw new Error("Invalid required field: interview must be an object when provided");
  }

  const required = interview.required === undefined ? true : interview.required;
  if (typeof required !== "boolean") {
    throw new Error("Invalid required field: interview.required must be a boolean");
  }

  const status = interview.status === undefined ? "pending" : assertString(interview, "status");
  if (!["pending", "completed", "skipped"].includes(status)) {
    throw new Error("Invalid required field: interview.status must be pending, completed, or skipped");
  }

  const answers = interview.answers === undefined ? {} : interview.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    throw new Error("Invalid required field: interview.answers must be an object");
  }

  return {
    required,
    status,
    answers,
  };
}

function resolveConfigPathFromArgs(argv: any): any {
  const args = Array.isArray(argv) ? argv : [];
  const configIndex = args.indexOf("--config");
  if (configIndex !== -1 && args[configIndex + 1]) return args[configIndex + 1];
  const equalsArg = args.find((arg) => typeof arg === "string" && arg.startsWith("--config="));
  if (equalsArg) return equalsArg.slice("--config=".length);
  return null;
}

function requireExplicitConfigPath(selector: any): any {
  if (typeof selector === "string" && selector.trim() !== "") return selector;
  if (Array.isArray(selector)) {
    const configPath = resolveConfigPathFromArgs(selector);
    if (configPath) return configPath;
  }
  if (selector && typeof selector === "object") {
    if (typeof selector.configPath === "string" && selector.configPath.trim() !== "") return selector.configPath;
    if (typeof selector.config === "string" && selector.config.trim() !== "") return selector.config;
    if (Array.isArray(selector.argv)) {
      const configPath = resolveConfigPathFromArgs(selector.argv);
      if (configPath) return configPath;
    }
  }
  throw new Error("Refusing to execute without an explicit --config path");
}

function validateConfig(configPath: any, options: any = {}): any {
  const explicitConfigPath = requireExplicitConfigPath(configPath);
  const absoluteConfigPath = path.resolve(explicitConfigPath);
  if (!fs.existsSync(absoluteConfigPath)) {
    throw new Error(`Config file not found: ${explicitConfigPath}`);
  }

  const config = readConfigFile(absoluteConfigPath);
  const configDirectory = path.dirname(absoluteConfigPath);
  const realConfigDirectory = fs.realpathSync(configDirectory);
  const mode = options.mode || config.mode || "execute";
  if (!isKnownMode(mode)) {
    throw new Error(`Invalid mode: ${mode}`);
  }

  const projectRoot = assertString(config, "project_root");
  const resolvedProjectRoot = path.resolve(configDirectory, projectRoot);
  if (!fs.existsSync(resolvedProjectRoot) || !fs.statSync(resolvedProjectRoot).isDirectory()) {
    throw new Error("Invalid path in project_root: project_root must exist and be a directory");
  }
  const realProjectRoot = fs.realpathSync(resolvedProjectRoot);
  const relativeFromConfig = path.relative(realConfigDirectory, realProjectRoot);
  if (relativeFromConfig.startsWith("..") || path.isAbsolute(relativeFromConfig)) {
    throw new Error("Invalid path in project_root: project_root must not escape the config directory");
  }

  const shouldRequireAllowedCommands = isExecutionMode(mode);
  const allowedCommands = normalizeStringList(assertPresent(config, "allowed_commands"), "allowed_commands", {
    requireNonEmpty: shouldRequireAllowedCommands,
  });

  return {
    config_path: absoluteConfigPath,
    mode,
    project_root: resolvedProjectRoot,
    objective: assertString(config, "objective"),
    max_iterations: assertPositiveInteger(config, "max_iterations"),
    max_runtime_minutes: assertPositiveInteger(config, "max_runtime_minutes"),
    max_diff_lines: assertPositiveInteger(config, "max_diff_lines"),
    protected_paths: normalizeProtectedPaths(config),
    allowed_commands: allowedCommands,
    baseline_commands: normalizeStringList(assertPresent(config, "baseline_commands"), "baseline_commands", { requireNonEmpty: true }),
    judge: {
      mode: assertString(config, "judge.mode"),
      rubric: assertString(config, "judge.rubric"),
    },
    criteria: normalizeCriteria(config),
    evidence: {
      retain_artifacts: assertBoolean(config, "evidence.retain_artifacts"),
      redact_secrets: assertBoolean(config, "evidence.redact_secrets"),
    },
    interview: normalizeInterview(config),
    decision_policy: {
      keep_if: normalizeDecisionRule(assertPresent(config, "decision_policy"), "keep_if"),
      revert_if: normalizeDecisionRule(assertPresent(config, "decision_policy"), "revert_if"),
    },
  };
}

function loadRuntimeConfig(selector: any, options: any = {}): any {
  const configPath = requireExplicitConfigPath(selector);
  return validateConfig(configPath, options);
}

export {
  DEFAULT_PROTECTED_PATHS,
  EXECUTION_MODES,
  NON_EXECUTION_MODES,
  isExecutionMode,
  isKnownMode,
  loadRuntimeConfig,
  parseYaml,
  requireExplicitConfigPath,
  validateConfig,
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const normalized = loadRuntimeConfig(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`);
  } catch (error: any) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
