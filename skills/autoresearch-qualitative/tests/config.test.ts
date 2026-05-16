import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  requireExplicitConfigPath,
  validateConfig,
} from "../src/config.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createTempProject(): any {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-config-test-"));
}

function writeConfig(directory: any, config: any, extension: any = ".json"): any {
  const configPath = path.join(directory, `config${extension}`);
  if (extension === ".json") {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } else {
    fs.writeFileSync(configPath, config);
  }
  return configPath;
}

function validConfig(overrides: any = {}): any {
  return {
    project_root: ".",
    objective: "Improve qualitative behavior safely.",
    max_iterations: 5,
    max_runtime_minutes: 60,
    max_diff_lines: 800,
    protected_paths: [".env.local", "private/**"],
    allowed_commands: ["npm test"],
    baseline_commands: ["npm test"],
    judge: {
      mode: "host-agent",
      rubric: "Keep changes only when they improve the objective and preserve safety.",
    },
    criteria: [
      {
        id: "correctness",
        description: "Evidence supports the objective.",
        weight: 1,
      },
    ],
    evidence: {
      retain_artifacts: true,
      redact_secrets: true,
    },
    decision_policy: {
      keep_if: "score >= threshold && no_safety_concerns",
      revert_if: "baseline_regression || safety_concern",
    },
    ...overrides,
  };
}

test("valid config passes and returns normalized values", () => {
  const directory = createTempProject();
  const configPath = writeConfig(directory, validConfig());

  const normalized = validateConfig(configPath);

  assert.equal(normalized.config_path, configPath);
  assert.equal(normalized.project_root, directory);
  assert.equal(normalized.max_iterations, 5);
  assert.deepEqual(normalized.allowed_commands, ["npm test"]);
  assert.equal(normalized.judge.mode, "host-agent");
  assert.equal(normalized.criteria[0].id, "correctness");
});

test("missing max_iterations fails with a specific missing-field message", () => {
  const directory = createTempProject();
  const config = validConfig();
  delete config.max_iterations;
  const configPath = writeConfig(directory, config);

  assert.throws(() => validateConfig(configPath), /Missing required field: max_iterations/);
});

test("missing max_runtime_minutes fails with a specific missing-field message", () => {
  const directory = createTempProject();
  const config = validConfig();
  delete config.max_runtime_minutes;
  const configPath = writeConfig(directory, config);

  assert.throws(() => validateConfig(configPath), /Missing required field: max_runtime_minutes/);
});

test("empty allowed_commands fails in execution mode", () => {
  const directory = createTempProject();
  const configPath = writeConfig(directory, validConfig({ allowed_commands: [] }));

  assert.throws(() => validateConfig(configPath), /allowed_commands must not be empty/);
});

test("empty allowed_commands is permitted in dry-run mode", () => {
  const directory = createTempProject();
  const configPath = writeConfig(directory, validConfig({ allowed_commands: [] }));

  const normalized = validateConfig(configPath, { mode: "dry-run" });

  assert.deepEqual(normalized.allowed_commands, []);
  assert.equal(normalized.mode, "dry-run");
});

test("interview metadata defaults to a required pending interview", () => {
  const directory = createTempProject();
  const configPath = writeConfig(directory, validConfig());

  const normalized = validateConfig(configPath);

  assert.deepEqual(normalized.interview, {
    required: true,
    status: "pending",
    answers: {},
  });
});

test("interview metadata can capture completed pre-run answers", () => {
  const directory = createTempProject();
  const configPath = writeConfig(directory, validConfig({
    interview: {
      required: true,
      status: "completed",
      answers: {
        objective: "Improve onboarding",
        verification: "npm test",
      },
    },
  }));

  const normalized = validateConfig(configPath);

  assert.equal(normalized.interview.status, "completed");
  assert.equal(normalized.interview.answers.objective, "Improve onboarding");
});

test("agent handoff config is preserved for worker dispatch", () => {
  const directory = createTempProject();
  const configPath = writeConfig(directory, validConfig({
    agent_handoff: {
      command: "codex exec --skip-git-repo-check -C . \"read $AUTORESEARCH_PROMPT_PATH\"",
      template_path: "handoff.md",
      objective: "Generate one safe candidate.",
    },
  }));

  const normalized = validateConfig(configPath);

  assert.equal(normalized.agent_handoff.command.includes("codex exec"), true);
  assert.equal(normalized.agent_handoff.template_path, "handoff.md");
  assert.equal(normalized.agent_handoff.objective, "Generate one safe candidate.");
});

test("invalid agent handoff command fails config validation", () => {
  const directory = createTempProject();
  const configPath = writeConfig(directory, validConfig({ agent_handoff: { command: "" } }));

  assert.throws(() => validateConfig(configPath), /agent_handoff must be an object|Missing required field: command|must be a non-empty string/);
});

test("missing config path causes explicit execution refusal", () => {
  assert.throws(() => requireExplicitConfigPath([]), /Refusing to execute without an explicit --config path/);
  assert.throws(() => validateConfig(""), /Refusing to execute without an explicit --config path/);
});

test("protected paths default includes .env and secrets/** if not overridden", () => {
  const directory = createTempProject();
  const config = validConfig();
  delete config.protected_paths;
  const configPath = writeConfig(directory, config);

  const normalized = validateConfig(configPath);

  assert.ok(normalized.protected_paths.includes(".env"));
  assert.ok(normalized.protected_paths.includes("secrets/**"));
  assert.equal(normalized.interview.required, true);
});

test("explicit protected paths override defaults", () => {
  const directory = createTempProject();
  const configPath = writeConfig(directory, validConfig({ protected_paths: ["custom-secret/**"] }));

  const normalized = validateConfig(configPath);

  assert.deepEqual(normalized.protected_paths, ["custom-secret/**"]);
});

test("invalid protected path fails closed", () => {
  const directory = createTempProject();
  const configPath = writeConfig(directory, validConfig({ protected_paths: ["../outside"] }));

  assert.throws(() => validateConfig(configPath), /escapes project_root/);
});

test("project_root symlink escape fails closed", () => {
  const directory = createTempProject();
  const outsideDirectory = createTempProject();
  const symlinkPath = path.join(directory, "outside-link");
  fs.symlinkSync(outsideDirectory, symlinkPath, "dir");
  const configPath = writeConfig(directory, validConfig({ project_root: "outside-link" }));

  assert.throws(() => validateConfig(configPath), /project_root must not escape the config directory/);
});

test("default YAML template is valid only when selected explicitly", () => {
  const templatePath = path.resolve(__dirname, "../templates/autoresearch-skill.config.yaml");

  const normalized = validateConfig(templatePath);

  assert.equal(normalized.max_iterations, 5);
  assert.equal(normalized.max_runtime_minutes, 60);
  assert.equal(normalized.max_diff_lines, 800);
  assert.ok(normalized.protected_paths.includes(".env"));
  assert.ok(normalized.protected_paths.includes("secrets/**"));
});
