"""
PhishArmor API v1 - Authenticated Endpoints

All routes in this module require a valid Supabase JWT.
Mount this router at /api/v1 in main.py.

Endpoints:
    POST   /api/v1/analyze          - Submit email for analysis (persists results)
    GET    /api/v1/history           - Paginated scan history
    GET    /api/v1/history/{scan_id} - Get specific scan details
    DELETE /api/v1/history/{scan_id} - Dismiss/delete a scan
    PATCH  /api/v1/history/{scan_id}/classify - User feedback on a scan
    GET    /api/v1/stats             - Summary statistics
    GET    /api/v1/settings          - Get user settings/profile
    PATCH  /api/v1/settings          - Update user settings
"""

import time
import asyncio
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.auth import AuthenticatedUser, get_current_user, get_optional_user
from app.core.logging import get_logger
from app.services.supabase_service import (
    save_scan_result,
    get_scan_history,
    get_scan_by_id,
    delete_scan,
    classify_scan,
    get_user_stats,
    get_user_profile,
    update_user_profile,
    log_audit_event,
    hash_email_content,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1", tags=["v1"])


# ---------------------------------------------------------------------------
# Request/Response Models
# ---------------------------------------------------------------------------

class AnalyzeEmailRequest(BaseModel):
    """Request model for authenticated email analysis."""
    sender: str = Field(..., description="Email sender address")
    subject: str = Field(..., description="Email subject line")
    body: str = Field(..., description="Email body text (plain text)")
    body_html: Optional[str] = Field(None, description="Email body HTML (optional)")
    gmail_message_id: Optional[str] = Field(None, description="Gmail message ID for deduplication")
    urls: Optional[List[str]] = Field(default_factory=list, description="URLs extracted from email")


class AnalyzeEmailResponse(BaseModel):
    """Response model for authenticated email analysis."""
    scan_id: Optional[str] = None
    risk_level: str
    confidence: int
    overall_assessment: str
    reasoning: List[str] = []
    urgent_language_detected: bool = False
    sensitive_info_requested: bool = False
    grammar_issues_detected: bool = False
    urgent_language_details: Optional[str] = None
    sensitive_info_details: Optional[str] = None
    grammar_details: Optional[str] = None
    url_threats: Optional[Dict[str, Any]] = None
    domain_reputation: Optional[Dict[str, Any]] = None
    processing_time_ms: float = 0
    persisted: bool = False


class ScanHistoryResponse(BaseModel):
    scans: List[Dict[str, Any]]
    total: int
    page: int
    page_size: int
    total_pages: int


class UserStatsResponse(BaseModel):
    total_scans: int
    total_flagged: int
    security_score: int
    risk_distribution: Dict[str, int]
    scans_this_week: int
    scans_this_month: int


class UpdateSettingsRequest(BaseModel):
    email_notifications_enabled: Optional[bool] = None
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    avatar_url: Optional[str] = None


class ClassifyScanRequest(BaseModel):
    classification: str = Field(
        ...,
        description="User's classification: 'safe', 'phishing', 'spam', 'suspicious'"
    )


# ---------------------------------------------------------------------------
# POST /api/v1/analyze - Authenticated Email Analysis
# ---------------------------------------------------------------------------

@router.post("/analyze", response_model=AnalyzeEmailResponse)
async def analyze_email_authenticated(
    request: AnalyzeEmailRequest,
    user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Analyze an email for phishing threats (authenticated).

    This endpoint:
    1. Runs the same analysis pipeline as /api/analyze-email
    2. Persists the result to the user's scan history
    3. Logs an audit event (no email content stored)

    The existing analysis services (openai_service, apivoid_service, etc.)
    are reused — this is a thin wrapper that adds auth + persistence.
    """
    start_time = time.time()

    try:
        # ---------------------------------------------------------------
        # 1. Run the existing analysis pipeline
        # ---------------------------------------------------------------
        # Import the existing services that power /api/analyze-email
        from app.services.openai_service import get_openai_service
        from app.services.apivoid_service import get_apivoid_service

        openai_service = get_openai_service()
        apivoid_service = get_apivoid_service()

        # Run AI analysis and domain check in parallel
        ai_task = openai_service.analyze_email(
            sender=request.sender,
            subject=request.subject,
            body=request.body,
        )
        domain = request.sender.split("@")[-1] if "@" in request.sender else None
        domain_task = (
            apivoid_service.check_domain_reputation(domain)
            if domain else asyncio.coroutine(lambda: None)()
        )

        ai_result, domain_result = await asyncio.gather(
            ai_task, domain_task, return_exceptions=True
        )

        # Handle exceptions from parallel tasks
        if isinstance(ai_result, Exception):
            logger.error("AI analysis failed", error=str(ai_result), user_id=user.id)
            ai_result = {}
        if isinstance(domain_result, Exception):
            logger.warning("Domain check failed", error=str(domain_result))
            domain_result = None

        # ---------------------------------------------------------------
        # 2. Build the response
        # ---------------------------------------------------------------
        processing_time = round((time.time() - start_time) * 1000, 2)

        # Extract fields from the AI result (matching existing response format)
        risk_level = ai_result.get("riskLevel", "unknown") if isinstance(ai_result, dict) else "unknown"
        confidence = ai_result.get("confidence", 0) if isinstance(ai_result, dict) else 0

        response = AnalyzeEmailResponse(
            risk_level=risk_level,
            confidence=confidence,
            overall_assessment=ai_result.get("overallAssessment", "") if isinstance(ai_result, dict) else "",
            reasoning=ai_result.get("reasoning", []) if isinstance(ai_result, dict) else [],
            urgent_language_detected=ai_result.get("urgentLanguageAI", False) if isinstance(ai_result, dict) else False,
            sensitive_info_requested=ai_result.get("requestsSensitiveInfoAI", False) if isinstance(ai_result, dict) else False,
            grammar_issues_detected=ai_result.get("grammarIssuesAI", False) if isinstance(ai_result, dict) else False,
            urgent_language_details=ai_result.get("urgentLanguageDetails") if isinstance(ai_result, dict) else None,
            sensitive_info_details=ai_result.get("sensitiveInfoDetails") if isinstance(ai_result, dict) else None,
            grammar_details=ai_result.get("grammarDetails") if isinstance(ai_result, dict) else None,
            domain_reputation=domain_result if isinstance(domain_result, dict) else None,
            processing_time_ms=processing_time,
        )

        # ---------------------------------------------------------------
        # 3. Persist the scan result
        # ---------------------------------------------------------------
        risk_details = {
            "ai_analysis": ai_result if isinstance(ai_result, dict) else {},
            "domain_reputation": domain_result if isinstance(domain_result, dict) else {},
            "processing_time_ms": processing_time,
        }

        saved = await save_scan_result(
            user_id=user.id,
            sender=request.sender,
            subject=request.subject,
            risk_level=risk_level,
            risk_details=risk_details,
            gmail_message_id=request.gmail_message_id,
        )

        if saved:
            response.scan_id = saved.get("id")
            response.persisted = True

        # ---------------------------------------------------------------
        # 4. Audit log (fire and forget)
        # ---------------------------------------------------------------
        await log_audit_event(
            user_id=user.id,
            action="analyze_email",
            email_hash=hash_email_content(request.sender, request.subject),
            risk_score=confidence,
            risk_level=risk_level,
            duration_ms=processing_time,
            metadata={
                "sender_domain": domain,
                "has_urls": bool(request.urls),
                "url_count": len(request.urls) if request.urls else 0,
            },
        )

        logger.info(
            "Authenticated analysis complete",
            user_id=user.id,
            risk_level=risk_level,
            processing_time_ms=processing_time,
            persisted=response.persisted,
        )

        return response

    except Exception as e:
        processing_time = round((time.time() - start_time) * 1000, 2)
        logger.error(
            "Analysis failed",
            user_id=user.id,
            error=str(e),
            processing_time_ms=processing_time,
        )

        # Log the failure
        await log_audit_event(
            user_id=user.id,
            action="analyze_email_error",
            duration_ms=processing_time,
            metadata={"error": str(e)},
        )

        raise HTTPException(
            status_code=500,
            detail="Analysis failed. Please try again.",
        )


# ---------------------------------------------------------------------------
# GET /api/v1/history - Scan History
# ---------------------------------------------------------------------------

@router.get("/history", response_model=ScanHistoryResponse)
async def get_history(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    risk_level: Optional[str] = Query(None, description="Filter by risk level"),
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Get paginated scan history for the authenticated user."""
    result = await get_scan_history(
        user_id=user.id,
        page=page,
        page_size=page_size,
        risk_level=risk_level,
    )
    return ScanHistoryResponse(**result)


# ---------------------------------------------------------------------------
# GET /api/v1/history/{scan_id} - Scan Detail
# ---------------------------------------------------------------------------

@router.get("/history/{scan_id}")
async def get_scan_detail(
    scan_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Get detailed analysis result for a specific scan."""
    scan = await get_scan_by_id(user.id, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return scan


# ---------------------------------------------------------------------------
# DELETE /api/v1/history/{scan_id} - Dismiss Scan
# ---------------------------------------------------------------------------

@router.delete("/history/{scan_id}")
async def dismiss_scan(
    scan_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Dismiss/delete a scan from the user's history."""
    deleted = await delete_scan(user.id, scan_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Scan not found")

    await log_audit_event(
        user_id=user.id,
        action="dismiss_scan",
        metadata={"scan_id": scan_id},
    )

    return {"message": "Scan dismissed", "scan_id": scan_id}


# ---------------------------------------------------------------------------
# PATCH /api/v1/history/{scan_id}/classify - User Feedback
# ---------------------------------------------------------------------------

@router.patch("/history/{scan_id}/classify")
async def classify_scan_endpoint(
    scan_id: str,
    request: ClassifyScanRequest,
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Allow user to classify a scan (feedback for improving the system)."""
    result = await classify_scan(user.id, scan_id, request.classification)
    if not result:
        raise HTTPException(status_code=404, detail="Scan not found")

    await log_audit_event(
        user_id=user.id,
        action="classify_scan",
        metadata={"scan_id": scan_id, "classification": request.classification},
    )

    return {"message": "Classification saved", "scan_id": scan_id, "classification": request.classification}


# ---------------------------------------------------------------------------
# GET /api/v1/stats - User Statistics
# ---------------------------------------------------------------------------

@router.get("/stats", response_model=UserStatsResponse)
async def get_stats(
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Get summary statistics for the authenticated user."""
    stats = await get_user_stats(user.id)
    return UserStatsResponse(**stats)


# ---------------------------------------------------------------------------
# GET /api/v1/settings - User Settings
# ---------------------------------------------------------------------------

@router.get("/settings")
async def get_settings(
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Get user profile and settings."""
    profile = await get_user_profile(user.id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    # Strip sensitive fields before returning
    safe_fields = {
        "id", "full_name", "email", "phone_number", "plan",
        "credits_remaining", "email_notifications_enabled",
        "avatar_url", "created_at", "updated_at",
    }
    return {k: v for k, v in profile.items() if k in safe_fields}


# ---------------------------------------------------------------------------
# PATCH /api/v1/settings - Update Settings
# ---------------------------------------------------------------------------

@router.patch("/settings")
async def update_settings(
    request: UpdateSettingsRequest,
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Update user profile and settings."""
    updates = request.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    result = await update_user_profile(user.id, updates)
    if not result:
        raise HTTPException(status_code=500, detail="Failed to update settings")

    await log_audit_event(
        user_id=user.id,
        action="update_settings",
        metadata={"fields_updated": list(updates.keys())},
    )

    return {"message": "Settings updated", "updated_fields": list(updates.keys())}
