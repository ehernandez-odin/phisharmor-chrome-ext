# Phase 2 Integration Guide

## What Was Done

### Supabase (already applied)
- Created `audit_log` table with RLS policies and indexes
- Added performance indexes on `scans` table (`user_id`, `created_at`, `risk_level`)

### New Files to Add to Your Repo

| File | Purpose |
|------|---------|
| `app/core/auth.py` | JWT auth middleware — validates Supabase JWTs, provides `get_current_user` dependency |
| `app/services/supabase_service.py` | Database layer — scan persistence, history, stats, settings, audit logging |
| `app/api/v1_routes.py` | All `/api/v1/` authenticated endpoints |

### Files to Modify

| File | Change |
|------|--------|
| `app/core/config.py` | Add 3 Supabase env vars to Settings class |
| `app/main.py` | Import and include `v1_router` |
| `requirements.txt` | Add `PyJWT==2.8.0` and `supabase==2.10.0` |

---

## Step-by-Step Integration

### 1. Copy the new files into your repo

```bash
cp phase2-backend/app/core/auth.py       app/core/auth.py
cp phase2-backend/app/services/supabase_service.py  app/services/supabase_service.py
cp phase2-backend/app/api/v1_routes.py    app/api/v1_routes.py
```

### 2. Update `app/core/config.py`

Add these fields to your `Settings` class:

```python
# Supabase configuration (Phase 2)
SUPABASE_URL: str = ""
SUPABASE_JWT_SECRET: str = ""
SUPABASE_SERVICE_ROLE_KEY: str = ""
```

### 3. Update `app/main.py`

Add the import:
```python
from app.api.v1_routes import router as v1_router
```

Include the router (near where `email_router` is included):
```python
app.include_router(v1_router)
```

### 4. Update `requirements.txt`

Add:
```
PyJWT==2.8.0
supabase==2.10.0
```

### 5. Set Environment Variables on DigitalOcean

Go to your DigitalOcean App Platform → Settings → App-Level Environment Variables:

```
SUPABASE_URL=https://indcrrlvpotinxdhrthg.supabase.co
SUPABASE_JWT_SECRET=<your-jwt-secret>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

To find these values:
- Go to Supabase Dashboard → Project Settings → API
- **JWT Secret**: Under "JWT Settings"
- **Service Role Key**: Under "Project API keys" → `service_role` (keep this secret!)
- **URL**: The project URL shown at the top

---

## New API Endpoints

All require `Authorization: Bearer <supabase-jwt-token>` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/analyze` | Analyze email + persist result |
| GET | `/api/v1/history?page=1&page_size=20` | Paginated scan history |
| GET | `/api/v1/history/{scan_id}` | Scan detail |
| DELETE | `/api/v1/history/{scan_id}` | Dismiss scan |
| PATCH | `/api/v1/history/{scan_id}/classify` | User feedback |
| GET | `/api/v1/stats` | Summary stats |
| GET | `/api/v1/settings` | User profile/settings |
| PATCH | `/api/v1/settings` | Update settings |

### Example: Authenticated Analysis

```bash
curl -X POST "https://phisharmor-backend-bd392.ondigitalocean.app/api/v1/analyze" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "newsletter@google.com",
    "subject": "Your weekly digest",
    "body": "Here are your latest updates...",
    "gmail_message_id": "18f3a2b4c5d6e7f8"
  }'
```

Response includes `scan_id` and `persisted: true` confirming it was saved to the database.

---

## Architecture Notes

**Design decisions:**
- JWT validation is done in Python (PyJWT + HS256) — no network call to Supabase for auth, ~0.1ms overhead
- Supabase client uses `service_role` key — this bypasses RLS, which is fine because the backend validates JWTs first and scopes all queries by `user_id`
- Existing `/api/` routes remain untouched and unauthenticated — backward compatible
- Audit logging is fire-and-forget — failures don't affect the user's request
- Email content is never persisted (per PRD SEC-04/SEC-08) — only metadata and analysis results

**The analyze endpoint reuses your existing services** (`openai_service`, `apivoid_service`). It calls the same code that powers `/api/analyze-email`, then wraps it with auth validation, database persistence, and audit logging.
