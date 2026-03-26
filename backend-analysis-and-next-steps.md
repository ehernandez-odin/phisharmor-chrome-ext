# PhishArmor Backend Analysis & Phase 2 Plan

**Date:** March 26, 2026
**Author:** Claude (analysis assistant)
**Status:** Ready for Phase 2 implementation

---

## 1. Current State Summary

### Backend (DigitalOcean App Platform)

The PhishArmor FastAPI backend is **live, healthy, and fully functional** at `phisharmor-backend-bd392.ondigitalocean.app`.

**Working Endpoints (confirmed via live testing):**

| Endpoint | Method | Status | Notes |
|----------|--------|--------|-------|
| `/health` | GET | ✅ Working | Returns version, uptime, service config |
| `/api/analyze-email` | POST | ✅ Working | Full AI analysis pipeline; requires `body` field (not `bodyText`) |
| `/api/url-reputation` | POST | ✅ Working | APIVoid-powered URL safety checks |
| `/api/url-reputation/batch` | POST | ✅ Working | Batch URL analysis |
| `/api/domain-reputation` | POST | ✅ Working | Domain reputation scoring |
| `/api/domain-reputation/batch` | POST | ✅ Working | Batch domain analysis |
| `/api/openai/health` | GET | ✅ Working | GPT-4o-mini, ~648ms latency |
| `/api/apivoid/health` | GET | ✅ Working | ~366ms latency |
| `/metrics` | GET | ✅ Blocked | Properly disabled in production |
| `/config` | GET | ✅ Blocked | Properly disabled in production |

**Architecture:** Python 3.10, FastAPI with Pydantic validation, structured logging (structlog), rate limiting (slowapi), CORS configured, Gunicorn in production. Services: `openai_service.py`, `apivoid_service.py`, `apivoid_url_service.py`, `webrisk_service.py`, `risk_scorer.py`, `response_builder.py`, `free_analysis_service.py`.

### Supabase (Active Project: `indcrrlvpotinxdhrthg`)

The Supabase project **already exists** with meaningful schema and data:

**`profiles` table** (26 rows, RLS enabled):
- Core: `id` (uuid), `full_name`, `email`, `phone_number`
- Plan/billing: `plan` (default 'free'), `credits_remaining` (default 5), `stripe_customer_id`, `stripe_subscription_id`, `stripe_subscription_status`, `plan_expires_at`
- Google OAuth: `google_identity_id`, `google_avatar_url`, `google_gmail_access_token`, `google_gmail_refresh_token`, `google_gmail_token_expiry_date`, `google_gmail_auth_scopes`
- Settings: `email_notifications_enabled`, `avatar_url`
- Timestamps: `created_at`, `updated_at`

**`scans` table** (248 rows, RLS enabled):
- Core: `id` (uuid, auto-gen), `user_id`, `sender`, `subject`, `risk_level`
- Analysis: `risk_details` (JSONB), `requested_scan_components` (JSONB)
- Status: `status` (default 'pending'), `error_details` (JSONB)
- User feedback: `user_classification`, `user_classified_at`
- Refs: `gmail_message_id`
- Timestamps: `created_at`, `updated_at` (auto-updated via trigger)

**RLS Policies (both tables):**
- Authenticated users can CRUD their own data (`auth.uid() = id/user_id`)
- Service role has full access
- Anon can read profiles and insert scans (with `user_id IS NOT NULL`)

---

## 2. Gap Analysis: Current State vs. PRD

### What's DONE (Phase 0 + Phase 1)

| PRD Requirement | Status |
|-----------------|--------|
| FastAPI project scaffolding | ✅ Complete |
| Analysis endpoint (OpenAI + APIVoid) | ✅ Complete |
| Risk scoring algorithm | ✅ Complete |
| Rate limiting middleware | ✅ Complete |
| Pydantic request validation | ✅ Complete |
| Health check endpoint | ✅ Complete |
| Deploy to DigitalOcean | ✅ Complete |
| CORS configured | ✅ Complete |
| Structured logging | ✅ Complete |
| Supabase project created | ✅ Complete |
| Database schema (profiles + scans) | ✅ Complete (exceeds PRD spec) |
| RLS policies | ✅ Complete |
| Stripe billing fields | ✅ Complete (ahead of schedule) |
| Google OAuth fields | ✅ Complete (ahead of schedule) |

### What's PARTIALLY Done

| Item | Current State | Gap |
|------|---------------|-----|
| Google Web Risk | `webrisk_service.py` exists in codebase | Not configured/active in production (health check shows no Web Risk config) |
| Free tier analysis | `/api/analyze-email` works without auth | No credit deduction or limit enforcement |

### What's MISSING (Phase 2 tasks per PRD)

| PRD Requirement | Priority | Notes |
|-----------------|----------|-------|
| JWT auth middleware on FastAPI | **P0** | Backend does not validate Supabase JWTs; all endpoints are open |
| `/api/v1/` versioned endpoint prefix | **P1** | Current routes use `/api/` without versioning |
| `POST /api/v1/auth/signup` and `/login` | **P1** | No auth endpoints exist (Supabase handles auth client-side, but backend needs thin wrappers or direct JWT validation) |
| Token refresh flow | **P1** | Not implemented |
| Persist analysis results for MEDIUM+ risk | **P1** | Backend analyzes but doesn't write to Supabase `scans` table |
| `GET /api/v1/history` with pagination | **P2** | Not implemented |
| `GET /api/v1/stats` | **P2** | Not implemented |
| `GET/PATCH /api/v1/settings` | **P2** | Not implemented |
| `DELETE /api/v1/history/:id` | **P2** | Not implemented |
| `audit_log` table | **P2** | PRD specifies this; not yet created |
| Unit tests for risk scoring (80% coverage) | **P2** | Tests directory exists but coverage unknown |

---

## 3. Recommended Next Steps (Phase 2 Implementation)

### Step 1: Add JWT Auth Middleware to FastAPI

The backend needs to validate Supabase JWTs. Since Supabase issues standard JWTs signed with the project's JWT secret, the backend should:

1. Add `PyJWT` or `python-jose` to requirements
2. Create middleware that extracts the `Authorization: Bearer <token>` header
3. Validate the token against the Supabase JWT secret (stored as env var)
4. Extract `user_id` from the token's `sub` claim
5. Make user context available to route handlers

Keep existing unauthenticated endpoints working during transition (backward compat).

### Step 2: Connect Backend to Supabase for Persistence

The backend needs the Supabase client or direct PostgreSQL connection to:
1. Write analysis results to the `scans` table when risk is MEDIUM+
2. Read/write user settings from `profiles`
3. Write to a new `audit_log` table

Options: `supabase-py` client library or `asyncpg` for direct Postgres access.

### Step 3: Add Versioned Authenticated Endpoints

Create `/api/v1/` routes that require JWT auth:
- `POST /api/v1/analyze` — authenticated analysis that persists results
- `GET /api/v1/history` — paginated scan history for the user
- `GET /api/v1/stats` — summary stats
- `GET/PATCH /api/v1/settings` — user preferences
- `DELETE /api/v1/history/:id` — dismiss flagged email

### Step 4: Create audit_log Table

```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  email_hash TEXT,
  risk_score INTEGER,
  risk_level TEXT,
  duration_ms NUMERIC,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON audit_log FOR ALL TO service_role USING (true);
CREATE POLICY "user_read_own" ON audit_log FOR SELECT TO authenticated USING (auth.uid() = user_id);
```

### Step 5: Activate Google Web Risk

Investigate why `webrisk_service.py` is not active in production. Likely missing the `GOOGLE_WEBRISK_API_KEY` env var on DigitalOcean. This would add a second URL checking source alongside APIVoid.

---

## 4. Environment Variables Needed

Based on the codebase analysis, the backend likely needs these env vars for Phase 2:

```
# Existing (confirmed working)
OPENAI_API_KEY=...
APIVOID_API_KEY=...

# Needed for Phase 2
SUPABASE_URL=https://indcrrlvpotinxdhrthg.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...      # For server-side DB operations
SUPABASE_JWT_SECRET=...            # For JWT validation
GOOGLE_WEBRISK_API_KEY=...         # To activate Web Risk service

# Optional
DATABASE_URL=postgresql://...       # Direct Postgres connection string
```

---

## 5. Key Decisions Needed

1. **Auth strategy:** Should the backend validate JWTs itself (lightweight, recommended), or should it call Supabase's auth API to verify tokens (adds latency)?

2. **Persistence strategy:** Use `supabase-py` client (simpler, uses Supabase REST API) or direct `asyncpg` connection (faster, more control)?

3. **API versioning:** Add `/api/v1/` prefix to new auth-required endpoints while keeping existing `/api/` endpoints for backward compat? Or migrate everything at once?

4. **Credit system:** The `profiles` table already has `credits_remaining` (default 5) and `plan` fields. Should the backend enforce credit limits now, or defer to a later phase?
