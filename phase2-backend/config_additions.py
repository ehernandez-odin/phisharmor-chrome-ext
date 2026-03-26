"""
Add these fields to your existing Settings class in app/core/config.py.

Your current Settings class likely uses pydantic-settings and reads from
environment variables. Just add these three fields:
"""

# In app/core/config.py, inside the Settings class, add:
#
#     # Supabase configuration (Phase 2)
#     SUPABASE_URL: str = ""
#     SUPABASE_JWT_SECRET: str = ""
#     SUPABASE_SERVICE_ROLE_KEY: str = ""
#
# These will be automatically read from environment variables of the same name.
