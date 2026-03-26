"""
Supabase Client Service for PhishArmor Backend.

Handles all database persistence: scan results, audit logging,
user settings, and history retrieval.

Uses the Supabase Python client with the service_role key for
server-side operations (bypasses RLS for writes, which is appropriate
since the backend validates JWTs before calling these methods).
"""

import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from supabase import create_client, Client
from postgrest.exceptions import APIError

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# Module-level client (initialized lazily)
_supabase_client: Optional[Client] = None


def get_supabase_client() -> Client:
    """Get or create the Supabase client singleton."""
    global _supabase_client
    if _supabase_client is None:
        if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
            raise RuntimeError(
                "Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
            )
        _supabase_client = create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_SERVICE_ROLE_KEY,
        )
        logger.info("Supabase client initialized", url=settings.SUPABASE_URL)
    return _supabase_client


# ---------------------------------------------------------------------------
# Scan Persistence
# ---------------------------------------------------------------------------

async def save_scan_result(
    user_id: str,
    sender: str,
    subject: str,
    risk_level: str,
    risk_details: Dict[str, Any],
    gmail_message_id: Optional[str] = None,
    scan_components: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Persist an email scan result to the scans table.

    Called after analysis completes for authenticated users.
    Per PRD: persist metadata for MEDIUM+ risk emails.
    We persist ALL scans for authenticated users so they have full history.
    """
    try:
        client = get_supabase_client()
        data = {
            "user_id": user_id,
            "sender": sender,
            "subject": subject,
            "risk_level": risk_level,
            "risk_details": risk_details,
            "status": "completed",
            "gmail_message_id": gmail_message_id,
            "requested_scan_components": scan_components,
        }

        result = client.table("scans").insert(data).execute()
        logger.info(
            "Scan result saved",
            user_id=user_id,
            risk_level=risk_level,
            scan_id=result.data[0]["id"] if result.data else None,
        )
        return result.data[0] if result.data else None

    except APIError as e:
        logger.error("Failed to save scan result", error=str(e), user_id=user_id)
        return None
    except Exception as e:
        logger.error("Unexpected error saving scan", error=str(e), user_id=user_id)
        return None


# ---------------------------------------------------------------------------
# Scan History
# ---------------------------------------------------------------------------

async def get_scan_history(
    user_id: str,
    page: int = 1,
    page_size: int = 20,
    risk_level: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Get paginated scan history for a user.

    Returns:
        {
            "scans": [...],
            "total": int,
            "page": int,
            "page_size": int,
            "total_pages": int
        }
    """
    try:
        client = get_supabase_client()
        offset = (page - 1) * page_size

        # Build query
        query = (
            client.table("scans")
            .select("*", count="exact")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .range(offset, offset + page_size - 1)
        )

        if risk_level:
            query = query.eq("risk_level", risk_level)

        result = query.execute()
        total = result.count or 0
        total_pages = (total + page_size - 1) // page_size if total > 0 else 0

        return {
            "scans": result.data or [],
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }

    except Exception as e:
        logger.error("Failed to get scan history", error=str(e), user_id=user_id)
        return {"scans": [], "total": 0, "page": page, "page_size": page_size, "total_pages": 0}


async def get_scan_by_id(user_id: str, scan_id: str) -> Optional[Dict[str, Any]]:
    """Get a specific scan by ID, scoped to the user."""
    try:
        client = get_supabase_client()
        result = (
            client.table("scans")
            .select("*")
            .eq("id", scan_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        return result.data
    except Exception as e:
        logger.error("Failed to get scan", error=str(e), scan_id=scan_id)
        return None


async def delete_scan(user_id: str, scan_id: str) -> bool:
    """Delete (dismiss) a scan from the user's history."""
    try:
        client = get_supabase_client()
        result = (
            client.table("scans")
            .delete()
            .eq("id", scan_id)
            .eq("user_id", user_id)
            .execute()
        )
        return len(result.data) > 0 if result.data else False
    except Exception as e:
        logger.error("Failed to delete scan", error=str(e), scan_id=scan_id)
        return False


async def classify_scan(
    user_id: str, scan_id: str, classification: str
) -> Optional[Dict[str, Any]]:
    """
    Allow user to classify a scan (e.g., 'safe', 'phishing', 'spam').
    Used for feedback to improve the system over time.
    """
    try:
        client = get_supabase_client()
        result = (
            client.table("scans")
            .update({
                "user_classification": classification,
                "user_classified_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", scan_id)
            .eq("user_id", user_id)
            .execute()
        )
        return result.data[0] if result.data else None
    except Exception as e:
        logger.error("Failed to classify scan", error=str(e), scan_id=scan_id)
        return None


# ---------------------------------------------------------------------------
# User Stats
# ---------------------------------------------------------------------------

async def get_user_stats(user_id: str) -> Dict[str, Any]:
    """
    Get summary statistics for a user.

    Returns total scans, flagged count, risk distribution, etc.
    """
    try:
        client = get_supabase_client()

        # Get all scans for the user (we just need counts, not full data)
        result = (
            client.table("scans")
            .select("risk_level, created_at", count="exact")
            .eq("user_id", user_id)
            .execute()
        )

        scans = result.data or []
        total = result.count or 0

        # Calculate risk distribution
        risk_counts = {}
        for scan in scans:
            level = scan.get("risk_level", "unknown")
            risk_counts[level] = risk_counts.get(level, 0) + 1

        # Count flagged (anything not "Looks Safe" or "low" or "very_low")
        safe_levels = {"Looks Safe", "low", "very_low", "safe"}
        flagged = sum(
            count for level, count in risk_counts.items()
            if level not in safe_levels
        )

        # Calculate a simple security score (0-100)
        # Higher = safer. Based on ratio of safe to total.
        if total > 0:
            safe_count = total - flagged
            security_score = round((safe_count / total) * 100)
        else:
            security_score = 100  # No scans = clean slate

        return {
            "total_scans": total,
            "total_flagged": flagged,
            "security_score": security_score,
            "risk_distribution": risk_counts,
            "scans_this_week": sum(
                1 for s in scans
                if _is_within_days(s.get("created_at"), 7)
            ),
            "scans_this_month": sum(
                1 for s in scans
                if _is_within_days(s.get("created_at"), 30)
            ),
        }

    except Exception as e:
        logger.error("Failed to get user stats", error=str(e), user_id=user_id)
        return {
            "total_scans": 0,
            "total_flagged": 0,
            "security_score": 100,
            "risk_distribution": {},
            "scans_this_week": 0,
            "scans_this_month": 0,
        }


def _is_within_days(timestamp_str: Optional[str], days: int) -> bool:
    """Check if an ISO timestamp is within the last N days."""
    if not timestamp_str:
        return False
    try:
        ts = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        return (now - ts).days <= days
    except (ValueError, TypeError):
        return False


# ---------------------------------------------------------------------------
# User Settings / Profile
# ---------------------------------------------------------------------------

async def get_user_profile(user_id: str) -> Optional[Dict[str, Any]]:
    """Get user profile/settings."""
    try:
        client = get_supabase_client()
        result = (
            client.table("profiles")
            .select("*")
            .eq("id", user_id)
            .single()
            .execute()
        )
        return result.data
    except Exception as e:
        logger.error("Failed to get profile", error=str(e), user_id=user_id)
        return None


async def update_user_profile(
    user_id: str, updates: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """
    Update user profile/settings.

    Allowed fields: email_notifications_enabled, full_name, phone_number, avatar_url
    """
    allowed_fields = {
        "email_notifications_enabled",
        "full_name",
        "phone_number",
        "avatar_url",
    }
    filtered = {k: v for k, v in updates.items() if k in allowed_fields}

    if not filtered:
        return await get_user_profile(user_id)

    try:
        client = get_supabase_client()
        result = (
            client.table("profiles")
            .update(filtered)
            .eq("id", user_id)
            .execute()
        )
        return result.data[0] if result.data else None
    except Exception as e:
        logger.error("Failed to update profile", error=str(e), user_id=user_id)
        return None


# ---------------------------------------------------------------------------
# Audit Logging
# ---------------------------------------------------------------------------

async def log_audit_event(
    user_id: Optional[str],
    action: str,
    email_hash: Optional[str] = None,
    risk_score: Optional[int] = None,
    risk_level: Optional[str] = None,
    duration_ms: Optional[float] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """
    Write an entry to the audit_log table.

    This is fire-and-forget — failures are logged but don't affect the request.
    Per PRD SEC-08: logs request metadata but never email content.
    """
    try:
        client = get_supabase_client()
        data = {
            "user_id": user_id,
            "action": action,
            "email_hash": email_hash,
            "risk_score": risk_score,
            "risk_level": risk_level,
            "duration_ms": duration_ms,
            "metadata": metadata or {},
        }
        client.table("audit_log").insert(data).execute()
    except Exception as e:
        # Audit logging should never fail the request
        logger.warning("Audit log write failed", error=str(e), action=action)


def hash_email_content(sender: str, subject: str) -> str:
    """
    Create a privacy-safe hash of email metadata for audit logging.
    Per PRD: we never store email content, only a hash for deduplication.
    """
    content = f"{sender}:{subject}"
    return hashlib.sha256(content.encode()).hexdigest()[:16]
