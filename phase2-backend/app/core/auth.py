"""
JWT Authentication Middleware for PhishArmor Backend.

Validates Supabase-issued JWTs and extracts user context.
Designed to be added to FastAPI as a dependency.
"""

import time
from typing import Optional
from datetime import datetime, timezone

import jwt
from fastapi import Request, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# --- Configuration ---
# These should be added to your existing Settings class in app/core/config.py:
#
#   SUPABASE_URL: str = ""
#   SUPABASE_JWT_SECRET: str = ""
#   SUPABASE_SERVICE_ROLE_KEY: str = ""
#
# And set via environment variables on DigitalOcean.


class AuthenticatedUser(BaseModel):
    """Represents a validated, authenticated user from a Supabase JWT."""
    id: str                     # Supabase user UUID (from 'sub' claim)
    email: Optional[str] = None
    role: str = "authenticated"
    aud: str = "authenticated"


# FastAPI security scheme
bearer_scheme = HTTPBearer(auto_error=False)


def decode_jwt(token: str) -> dict:
    """
    Decode and validate a Supabase JWT.

    Supabase JWTs are signed with the project's JWT secret (HS256).
    The 'sub' claim contains the user's UUID.
    """
    try:
        payload = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
            options={
                "verify_exp": True,
                "verify_aud": True,
                "require": ["sub", "exp", "aud"],
            }
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=401,
            detail="Token has expired. Please refresh your session.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidAudienceError:
        raise HTTPException(
            status_code=401,
            detail="Invalid token audience.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.DecodeError:
        raise HTTPException(
            status_code=401,
            detail="Invalid token format.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError as e:
        logger.warning("JWT validation failed", error=str(e))
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> AuthenticatedUser:
    """
    FastAPI dependency that extracts and validates the current user from a JWT.

    Usage in route:
        @router.get("/api/v1/history")
        async def get_history(user: AuthenticatedUser = Depends(get_current_user)):
            # user.id is the Supabase user UUID
            ...
    """
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication required. Please log in.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_jwt(credentials.credentials)

    user = AuthenticatedUser(
        id=payload["sub"],
        email=payload.get("email"),
        role=payload.get("role", "authenticated"),
        aud=payload.get("aud", "authenticated"),
    )

    logger.debug("Authenticated user", user_id=user.id, email=user.email)
    return user


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> Optional[AuthenticatedUser]:
    """
    FastAPI dependency for endpoints that work both authenticated and unauthenticated.
    Returns None if no valid token is provided (instead of raising 401).

    Useful for the analyze endpoint where unauthenticated users get results
    but authenticated users also get their results persisted.
    """
    if credentials is None:
        return None

    try:
        payload = decode_jwt(credentials.credentials)
        return AuthenticatedUser(
            id=payload["sub"],
            email=payload.get("email"),
            role=payload.get("role", "authenticated"),
            aud=payload.get("aud", "authenticated"),
        )
    except HTTPException:
        # Token provided but invalid — treat as unauthenticated rather than erroring
        return None
