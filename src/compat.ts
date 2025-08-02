/**
 * Compatibility layer for shell commands
 * This allows the library to work with both Bun.$ and Node.js child_process
 * 
 * Usage:
 *   import { $ } from './compat.js';
 *   await $`npm install package-name`;
 *   await $`npm install package-name`.quiet();
 * 
 * In Bun environment: Uses native Bun.$ for better performance
 * In Node.js environment: Falls back to child_process.exec
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Shell error type matching Bun's ShellError
export class ShellError extends Error {
  exitCode: number;
  stdout: string;
  stderr: string;

  constructor(message: string, exitCode: number, stdout: string, stderr: string) {
    super(message);
    this.name = 'ShellError';
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ShellPromise extends Promise<ShellResult> {
  quiet(): Promise<ShellResult>;
}

/**
 * Shell command execution that mimics Bun.$
 * Works with both Bun and Node.js environments
 */
export function $(strings: TemplateStringsArray, ...values: any[]): ShellPromise {
  const command = strings.reduce((acc, str, i) => {
    return acc + str + (values[i] || '');
  }, '');

  // Create a chainable object that mimics Bun.$
  const execute = async (options: { quiet?: boolean } = {}) => {
    // If Bun.$ is available, use it
    if (typeof Bun !== 'undefined' && (Bun as any).$) {
      const bunShell = (Bun as any).$;
      // Apply quiet option before executing if requested
      if (options.quiet) {
        const result = await bunShell(strings, ...values).quiet();
        return {
          stdout: result.stdout ? result.stdout.toString() : '',
          stderr: result.stderr ? result.stderr.toString() : '',
          exitCode: result.exitCode || 0
        };
      } else {
        const result = await bunShell(strings, ...values);
        return {
          stdout: result.stdout ? result.stdout.toString() : '',
          stderr: result.stderr ? result.stderr.toString() : '',
          exitCode: result.exitCode || 0
        };
      }
    }

    // Node.js fallback
    try {
      const { stdout, stderr } = await execAsync(command);
      return {
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: 0
      };
    } catch (error: any) {
      throw new ShellError(
        `Failed with exit code ${error.code}`,
        error.code || 1,
        error.stdout || '',
        error.stderr || ''
      );
    }
  };

  // Return chainable API
  const promise = execute() as any;
  promise.quiet = () => execute({ quiet: true });
  return promise as ShellPromise;
}