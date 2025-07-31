#!/usr/bin/env bun

import { $ } from "../src/compat";
import * as fs from "fs";
import * as path from "path";

type ReleaseType = "patch" | "minor" | "major";

async function release(type: ReleaseType = "patch") {
  console.log(`📦 Starting ${type} release...`);

  // Check if we're on main branch
  const currentBranch = (await $`git branch --show-current`.text()).trim();
  if (currentBranch !== "main") {
    console.error("❌ Releases must be made from the main branch");
    console.error(`   Current branch: ${currentBranch}`);
    process.exit(1);
  }

  // Check for uncommitted changes
  const gitStatus = await $`git status --porcelain`.text();
  if (gitStatus.trim()) {
    console.error("❌ There are uncommitted changes");
    console.error("   Please commit or stash your changes before releasing");
    process.exit(1);
  }

  // Pull latest changes
  console.log("🔄 Pulling latest changes...");
  await $`git pull origin main`;

  // Run tests
  console.log("🧪 Running tests...");
  await $`bun test`;

  // Run typecheck
  console.log("🔍 Running typecheck...");
  await $`bun run typecheck`;

  // Read current version
  const packageJsonPath = path.join(process.cwd(), "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  const currentVersion = packageJson.version;
  console.log(`📌 Current version: ${currentVersion}`);

  // Bump version
  console.log(`⬆️  Bumping ${type} version...`);
  await $`npm version ${type} --no-git-tag-version`;

  // Read new version
  const updatedPackageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  const newVersion = updatedPackageJson.version;
  console.log(`✨ New version: ${newVersion}`);

  // Check if version already exists on npm
  console.log("🔍 Checking if version already exists on npm...");
  try {
    await $`npm view ${packageJson.name}@${newVersion} version`.quiet();
    console.error(`❌ Version ${newVersion} already exists on npm`);
    
    // Revert version change
    packageJson.version = currentVersion;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
    
    process.exit(1);
  } catch {
    // Version doesn't exist, which is what we want
    console.log("✅ Version is available on npm");
  }

  // Build the package
  console.log("🔨 Building package...");
  await $`bun run build`;

  // Create git commit and tag
  console.log("📝 Creating commit and tag...");
  await $`git add package.json`;
  await $`git commit -m "chore: release v${newVersion}"`;
  await $`git tag v${newVersion}`;

  // Publish to npm
  console.log("🚀 Publishing to npm...");
  try {
    await $`npm publish --access public`;
    console.log("✅ Published to npm successfully");
  } catch (error) {
    console.error("❌ Failed to publish to npm");
    console.error("   Reverting git changes...");
    
    // Revert the commit and tag
    await $`git reset --hard HEAD~1`;
    await $`git tag -d v${newVersion}`;
    
    throw error;
  }

  // Push to git
  console.log("📤 Pushing to git...");
  await $`git push origin main`;
  await $`git push origin v${newVersion}`;

  console.log(`\n🎉 Successfully released v${newVersion}!`);
  console.log(`\n📦 Install with: npm install ${packageJson.name}@${newVersion}`);
  console.log(`🏷️  Or use latest: npm install ${packageJson.name}@latest`);
}

// Parse command line arguments
const args = process.argv.slice(2);
const releaseType = args[0] as ReleaseType | undefined;

if (releaseType && !["patch", "minor", "major"].includes(releaseType)) {
  console.error("❌ Invalid release type. Must be: patch, minor, or major");
  process.exit(1);
}

// Run the release
release(releaseType).catch((error) => {
  console.error("\n❌ Release failed:", error);
  process.exit(1);
});