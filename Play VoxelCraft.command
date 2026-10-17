#!/bin/bash
# Double-click this file in Finder to start VoxelCraft on macOS.
cd "$(dirname "$0")" || exit 1

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js is required. Install the LTS version from https://nodejs.org and run this file again."
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)..."
  npm install || { read -r -p "Install failed. Press Enter to close..."; exit 1; }
fi

echo "Building VoxelCraft..."
npm run build || { read -r -p "Build failed. Press Enter to close..."; exit 1; }

echo "Starting VoxelCraft at http://localhost:4173 — close this window to stop the game."
npx vite preview --port 4173 --open
