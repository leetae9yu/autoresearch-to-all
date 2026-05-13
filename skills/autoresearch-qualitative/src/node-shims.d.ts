declare const process: {
  argv: string[];
  cwd(): string;
  env: Record<string, string | undefined>;
  exitCode?: number;
  stderr: { write(value: string): void };
  stdout: { write(value: string): void };
};

declare module "node:assert/strict" {
  const assert: any;
  export default assert;
}

declare module "node:child_process" {
  const childProcess: any;
  export default childProcess;
}

declare module "node:crypto" {
  const crypto: any;
  export default crypto;
}

declare module "node:fs" {
  const fs: any;
  export default fs;
}

declare module "node:os" {
  const os: any;
  export default os;
}

declare module "node:path" {
  const path: any;
  export default path;
}

declare module "node:test" {
  const test: any;
  export default test;
}

declare module "node:url" {
  export function fileURLToPath(value: string | URL): string;
}
