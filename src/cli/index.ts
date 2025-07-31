#!/usr/bin/env bun

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { CanonicalManager } from '../index';
import type { Config, IndexEntry, PackageInfo } from '../index';

// Command handlers
import { initCommand } from './init';
import { listCommand } from './list';
import { searchCommand } from './search';
import { resolveCommand } from './resolve';

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');

let VERSION = 'unknown';
try {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  VERSION = packageJson.version;
} catch (error) {
  // Fallback version if package.json can't be read
  VERSION = '0.0.3';
}

function showHelp() {
  console.log(`
fcm - FHIR Canonical Manager CLI

Usage: fcm <command> [options]

Commands:
  init       Initialize FHIR packages in current directory
  list       List packages or resources  
  search     Search for resources
  resolve    Get a resource by canonical URL

Options:
  --help     Show help
  --version  Show version

Examples:
  fcm init hl7.fhir.r4.core
  fcm list
  fcm search Patient
  fcm resolve http://hl7.org/fhir/StructureDefinition/Patient
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    showHelp();
    process.exit(0);
  }

  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    process.exit(0);
  }

  const commands: Record<string, (args: string[]) => Promise<void>> = {
    init: initCommand,
    list: listCommand,
    search: searchCommand,
    resolve: resolveCommand
  };

  if (!commands[command]) {
    console.error(`Error: Unknown command '${command}'`);
    console.error(`Run 'fcm --help' for usage information`);
    process.exit(1);
  }

  try {
    await commands[command](args.slice(1));
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Export utility functions for commands
export function parseArgs(args: string[]): { positional: string[], options: Record<string, string | boolean> } {
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg && arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('--')) {
        options[key] = nextArg;
        i++;
      } else {
        options[key] = true;
      }
    } else if (arg && arg.startsWith('-')) {
      // Handle short aliases
      switch (arg) {
        case '-sd':
          options.resourceType = 'StructureDefinition';
          break;
        case '-cs':
          options.resourceType = 'CodeSystem';
          break;
        case '-vs':
          options.resourceType = 'ValueSet';
          break;
        default:
          // Handle other single-letter flags
          const key = arg.slice(1);
          const nextArg = args[i + 1];
          if (nextArg && !nextArg.startsWith('-')) {
            options[key] = nextArg;
            i++;
          } else {
            options[key] = true;
          }
      }
    } else if (arg) {
      positional.push(arg);
    }
  }

  return { positional, options };
}

export async function loadPackageJson(): Promise<any> {
  const packagePath = path.join(process.cwd(), 'package.json');
  try {
    if (fs.existsSync(packagePath)) {
      const content = fs.readFileSync(packagePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    // Ignore parse errors
  }
  return null;
}

export async function savePackageJson(data: any): Promise<void> {
  const packagePath = path.join(process.cwd(), 'package.json');
  fs.writeFileSync(packagePath, JSON.stringify(data, null, 2) + '\n');
}

export function getConfigFromPackageJson(packageJson: any): Partial<Config> {
  const fcm = packageJson?.fcm || {};
  return {
    packages: fcm.packages || [],
    registry: fcm.registry,
    workingDir: process.cwd()
  };
}

// Run CLI
if (import.meta.main) {
  main();
}