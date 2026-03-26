"""
Changes needed in app/main.py to integrate Phase 2.

There are only two additions required:
1. Import the v1 router
2. Include it in the FastAPI app
"""

# ---------------------------------------------------------------
# 1. Add this import near the top of main.py, alongside the
#    existing "from app.api.email import router as email_router"
# ---------------------------------------------------------------

# from app.api.v1_routes import router as v1_router


# ---------------------------------------------------------------
# 2. In your startup or after creating the FastAPI app, include
#    the v1 router. Look for where email_router is included
#    (likely: app.include_router(email_router))
#    and add a line right after it:
# ---------------------------------------------------------------

# app.include_router(v1_router)


# ---------------------------------------------------------------
# 3. (Optional) Update the health check to report Supabase status.
#    In the /health endpoint handler, add:
# ---------------------------------------------------------------

# try:
#     from app.services.supabase_service import get_supabase_client
#     supabase_client = get_supabase_client()
#     services["supabase_configured"] = True
# except Exception:
#     services["supabase_configured"] = False


# That's it! The existing /api/ routes remain untouched.
# The new /api/v1/ routes require JWT auth.
