#!/bin/bash
# PhishArmor - Push to GitHub
# This script initializes git and pushes to the new repo

cd "$(dirname "$0")"

echo "=== PhishArmor: Pushing to GitHub ==="
echo ""

# Clean up any stale git state
rm -rf .git

# Initialize fresh
git init
git checkout -b main

# Add all files (gitignore will handle exclusions)
git add -A

# Commit
git commit -m "Initial commit: PhishArmor Chrome extension v0.1.0

Chrome Manifest V3 extension for AI-powered phishing detection across
Gmail, Outlook, and Yahoo Mail.

Includes:
- Core extension: manifest.json, background service worker, content
  scripts, popup and options pages
- Phase 2 backend scaffolding (FastAPI + Supabase)
- Phase 3 v2 refactored modules (background-v2, popup-v2, options-v2,
  manifest-v2)
- Security shield icon system (green/yellow/red/grey)
- OpenAI, Google Web Risk, and APIVoid integrations
- Project docs: README, PRD, pitch deck"

# Set remote and push
git remote add origin https://github.com/ehernandez-odin/phisharmor-chrome-ext.git
git push -u origin main

echo ""
echo "=== Done! ==="
echo "Repo: https://github.com/ehernandez-odin/phisharmor-chrome-ext"
echo ""
echo "Press any key to close..."
read -n 1
