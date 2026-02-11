#!/bin/bash
set -e

# Check if version argument is provided
if [ -z "$1" ]; then
    echo "Error: Version number required"
    echo "Usage: bun run release <version>"
    echo "Example: bun run release 0.0.18"
    exit 1
fi

VERSION=$1

echo "📦 Releasing version $VERSION..."

# Update package.json version
echo "Updating package.json..."
npm version $VERSION --no-git-tag-version

# Commit the change
echo "Committing changes..."
git add package.json
git commit -m "chore: bump version to $VERSION"

# Create and push tag
echo "Creating and pushing tag v$VERSION..."
git tag "v$VERSION"
git push origin HEAD
git push origin "v$VERSION"

echo "✅ Successfully released version $VERSION"
