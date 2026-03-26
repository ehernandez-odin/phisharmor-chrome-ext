#!/bin/bash
# PhishArmor Extension - GitHub Repository Setup Script
# Run this from the phish_armor/ directory: bash setup-repo.sh

set -e

REPO_NAME="phisharmor-extension"
DESCRIPTION="PhishArmor - AI-powered phishing detection Chrome extension"

echo "=== PhishArmor GitHub Repo Setup ==="
echo ""

# Check prerequisites
if ! command -v gh &> /dev/null; then
    echo "Error: GitHub CLI (gh) not found. Install it: brew install gh"
    exit 1
fi

if ! command -v git &> /dev/null; then
    echo "Error: git not found."
    exit 1
fi

# Check gh auth
if ! gh auth status &> /dev/null; then
    echo "Error: Not authenticated with GitHub CLI. Run: gh auth login"
    exit 1
fi

GH_USER=$(gh api user -q .login)
echo "Authenticated as: $GH_USER"

# Check if repo already exists
if gh repo view "$GH_USER/$REPO_NAME" &> /dev/null; then
    echo "Repo $GH_USER/$REPO_NAME already exists. Using existing repo."
else
    echo "Creating repo: $GH_USER/$REPO_NAME"
    gh repo create "$REPO_NAME" --private --description "$DESCRIPTION"
    echo "Repo created!"
fi

# Initialize git if needed
if [ ! -d ".git" ]; then
    git init
    echo "Git initialized."
else
    echo "Git already initialized."
fi

# Add remote
REMOTE_URL="https://github.com/$GH_USER/$REPO_NAME.git"
if git remote get-url origin &> /dev/null; then
    git remote set-url origin "$REMOTE_URL"
    echo "Updated remote origin to $REMOTE_URL"
else
    git remote add origin "$REMOTE_URL"
    echo "Added remote origin: $REMOTE_URL"
fi

# Stage all files
git add -A

# Commit
git commit -m "Initial commit: PhishArmor Chrome extension v0.1.0

- Chrome extension with Manifest V3 for phishing detection
- Background service worker with OpenAI, Google Web Risk, APIVoid integrations
- Content scripts for Gmail, Outlook, and Yahoo Mail
- Popup and options pages for configuration
- Phase 2 backend (FastAPI + Supabase) scaffolding
- Phase 3 v2 refactored files (background-v2, popup-v2, options-v2, manifest-v2)
- Security shield system with color-coded risk indicators"

# Push
git branch -M main
git push -u origin main

echo ""
echo "=== Done! ==="
echo "Repo URL: https://github.com/$GH_USER/$REPO_NAME"
echo ""
echo "Files pushed successfully!"
