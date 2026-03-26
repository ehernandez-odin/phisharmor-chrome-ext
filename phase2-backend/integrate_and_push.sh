#!/bin/bash
set -e

# =============================================================
# PhishArmor Backend — Phase 2 Integration Script
# =============================================================
# This script:
#   1. Clones the existing repo to a temp directory
#   2. Copies in Phase 2 files (auth, v1 routes, supabase service)
#   3. Patches config.py and main.py with Phase 2 additions
#   4. Appends Phase 2 deps to requirements.txt
#   5. Commits and pushes to main
# =============================================================

REPO_URL="https://github.com/ehernandez-odin/phisharmor-backend.git"
PHASE2_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR=$(mktemp -d)

echo "📁 Working in: $WORK_DIR"
echo "📦 Phase 2 source: $PHASE2_DIR"
echo ""

# --------------------------------------------------
# 1. Clone existing repo
# --------------------------------------------------
echo "🔄 Cloning repo..."
cd "$WORK_DIR"
git clone "$REPO_URL" repo
cd repo

echo "✅ Cloned. Current branch: $(git branch --show-current)"
echo ""

# --------------------------------------------------
# 2. Copy Phase 2 files into the repo
# --------------------------------------------------
echo "📋 Copying Phase 2 files..."

# Ensure directories exist
mkdir -p app/core
mkdir -p app/api
mkdir -p app/services

# Copy new files
cp "$PHASE2_DIR/app/core/auth.py"              app/core/auth.py
cp "$PHASE2_DIR/app/api/v1_routes.py"          app/api/v1_routes.py
cp "$PHASE2_DIR/app/services/supabase_service.py" app/services/supabase_service.py

echo "  ✅ app/core/auth.py"
echo "  ✅ app/api/v1_routes.py"
echo "  ✅ app/services/supabase_service.py"
echo ""

# --------------------------------------------------
# 3. Patch app/core/config.py — add Supabase env vars
# --------------------------------------------------
echo "🔧 Patching app/core/config.py..."

if grep -q "SUPABASE_URL" app/core/config.py; then
    echo "  ⏭️  Supabase config already present, skipping."
else
    # Insert Supabase fields after the last existing field in the Settings class
    # We look for the class Settings block and append before the model_config or class_method
    python3 - <<'PYEOF'
import re

with open("app/core/config.py", "r") as f:
    content = f.read()

supabase_block = '''
    # Supabase configuration (Phase 2)
    SUPABASE_URL: str = ""
    SUPABASE_JWT_SECRET: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
'''

# Strategy: find "model_config" or "@field_validator" — insert before it
# Fallback: find last field definition and append after
if "model_config" in content:
    content = content.replace("    model_config", supabase_block + "\n    model_config", 1)
elif "@field_validator" in content:
    content = content.replace("    @field_validator", supabase_block + "\n    @field_validator", 1)
else:
    # Append at the end of the Settings class (before the next top-level def/class or EOF)
    # Find the class body end
    lines = content.split('\n')
    insert_idx = len(lines)
    in_class = False
    for i, line in enumerate(lines):
        if 'class Settings' in line:
            in_class = True
            continue
        if in_class and line and not line.startswith(' ') and not line.startswith('#') and not line.strip() == '':
            insert_idx = i
            break
    lines.insert(insert_idx, supabase_block)
    content = '\n'.join(lines)

with open("app/core/config.py", "w") as f:
    f.write(content)

print("  ✅ Added SUPABASE_URL, SUPABASE_JWT_SECRET, SUPABASE_SERVICE_ROLE_KEY")
PYEOF
fi
echo ""

# --------------------------------------------------
# 4. Patch app/main.py — import and include v1 router
# --------------------------------------------------
echo "🔧 Patching app/main.py..."

if grep -q "v1_router" app/main.py; then
    echo "  ⏭️  v1_router already present, skipping."
else
    python3 - <<'PYEOF'
with open("app/main.py", "r") as f:
    content = f.read()

# Add import
import_line = "from app.api.v1_routes import router as v1_router"
if "from app.api" in content:
    # Insert after the last "from app.api" import
    lines = content.split('\n')
    last_api_import = -1
    for i, line in enumerate(lines):
        if line.startswith("from app.api"):
            last_api_import = i
    if last_api_import >= 0:
        lines.insert(last_api_import + 1, import_line)
        content = '\n'.join(lines)
else:
    # Insert after the last import block
    content = import_line + "\n" + content

# Add router inclusion
include_line = "app.include_router(v1_router)"
if "include_router" in content:
    # Find the last include_router line and add after it
    lines = content.split('\n')
    last_include = -1
    for i, line in enumerate(lines):
        if "include_router" in line and "v1_router" not in line:
            last_include = i
    if last_include >= 0:
        lines.insert(last_include + 1, include_line)
        content = '\n'.join(lines)
else:
    # Append at the end
    content += f"\n{include_line}\n"

with open("app/main.py", "w") as f:
    f.write(content)

print("  ✅ Added v1_router import and include_router(v1_router)")
PYEOF
fi
echo ""

# --------------------------------------------------
# 5. Append Phase 2 deps to requirements.txt
# --------------------------------------------------
echo "🔧 Updating requirements.txt..."

if grep -q "PyJWT" requirements.txt; then
    echo "  ⏭️  PyJWT already present, skipping."
else
    cat >> requirements.txt <<'EOF'

# Phase 2 — JWT authentication
PyJWT==2.8.0

# Phase 2 — Supabase Python client
supabase==2.10.0
EOF
    echo "  ✅ Added PyJWT==2.8.0 and supabase==2.10.0"
fi
echo ""

# --------------------------------------------------
# 6. Update .env.example with Supabase vars
# --------------------------------------------------
echo "🔧 Updating .env.example..."

if grep -q "SUPABASE_URL" .env.example 2>/dev/null; then
    echo "  ⏭️  Supabase vars already in .env.example, skipping."
else
    cat >> .env.example <<'EOF'

# Supabase Configuration (Phase 2)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_JWT_SECRET=your-jwt-secret
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
EOF
    echo "  ✅ Added Supabase env vars to .env.example"
fi
echo ""

# --------------------------------------------------
# 7. Stage, commit, and push
# --------------------------------------------------
echo "📝 Staging changes..."
git add app/core/auth.py
git add app/api/v1_routes.py
git add app/services/supabase_service.py
git add app/core/config.py
git add app/main.py
git add requirements.txt
git add .env.example

echo ""
echo "📊 Changes to be committed:"
git status --short
echo ""

git commit -m "feat: Phase 2 — Supabase auth, scan persistence, and v1 API routes

- Add JWT auth middleware (app/core/auth.py)
- Add v1 authenticated endpoints: analyze, history, stats, settings (app/api/v1_routes.py)
- Add Supabase service layer for scan persistence and audit logging (app/services/supabase_service.py)
- Patch config.py with SUPABASE_URL, SUPABASE_JWT_SECRET, SUPABASE_SERVICE_ROLE_KEY
- Patch main.py to import and include v1_router
- Add PyJWT==2.8.0 and supabase==2.10.0 to requirements.txt
- Update .env.example with Supabase env vars

Phase 2 endpoints (all require JWT auth):
  POST   /api/v1/analyze
  GET    /api/v1/history
  GET    /api/v1/history/{scan_id}
  DELETE /api/v1/history/{scan_id}
  PATCH  /api/v1/history/{scan_id}/classify
  GET    /api/v1/stats
  GET    /api/v1/settings
  PATCH  /api/v1/settings

Existing Phase 1 routes remain untouched and unauthenticated."

echo ""
echo "🚀 Pushing to origin/main..."
git push origin main

echo ""
echo "============================================="
echo "✅ DONE! Phase 2 has been pushed to GitHub."
echo "🔗 https://github.com/ehernandez-odin/phisharmor-backend"
echo "============================================="
echo ""
echo "📋 Next steps:"
echo "   1. Set environment variables on DigitalOcean:"
echo "      SUPABASE_URL, SUPABASE_JWT_SECRET, SUPABASE_SERVICE_ROLE_KEY"
echo "   2. Redeploy on DigitalOcean App Platform"
echo ""

# Cleanup
echo "🧹 Cleaning up temp directory..."
rm -rf "$WORK_DIR"
echo "Done!"
