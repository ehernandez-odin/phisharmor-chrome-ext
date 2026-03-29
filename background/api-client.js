/**
 * PhishArmor API Client Module
 *
 * Replaces all direct API calls (OpenAI, Web Risk, APIVoid) with a single
 * backend API call. The backend handles all third-party integrations.
 *
 * NO API KEYS are stored or used in the extension.
 */

const API_CLIENT_VERSION = '2.0.0';

// Backend API configuration
const BACKEND_BASE_URL = 'https://phisharmor-backend-bd392.ondigitalocean.app';
const API_V1_BASE = `${BACKEND_BASE_URL}/api/v1`;
const API_LEGACY_BASE = `${BACKEND_BASE_URL}/api`;

// Request timeouts
const ANALYSIS_TIMEOUT_MS = 15000;  // 15s for email analysis
const DEFAULT_TIMEOUT_MS = 10000;   // 10s for other requests

/**
 * Get the current auth token from storage.
 * Returns null if not authenticated.
 */
async function getAuthToken() {
  try {
    const result = await chrome.storage.session.get(['authToken']);
    return result.authToken || null;
  } catch (error) {
    console.warn('PhishArmor API: Failed to get auth token:', error);
    return null;
  }
}

/**
 * Make an authenticated request to the backend.
 * Automatically attaches JWT if available.
 */
async function apiRequest(endpoint, options = {}) {
  const {
    method = 'GET',
    body = null,
    timeout = DEFAULT_TIMEOUT_MS,
    requireAuth = false,
    useV1 = true,
  } = options;

  const baseUrl = useV1 ? API_V1_BASE : API_LEGACY_BASE;
  const url = `${baseUrl}${endpoint}`;

  // Build headers
  const headers = {
    'Content-Type': 'application/json',
    'X-Client-Version': API_CLIENT_VERSION,
  };

  // Attach auth token if available
  const token = await getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else if (requireAuth) {
    throw new ApiError('Authentication required. Please log in.', 401);
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      // Ensure message is always a string (detail/message can be objects)
      let errorMessage = errorBody.detail || errorBody.message || `Request failed: ${response.status}`;
      if (typeof errorMessage !== 'string') {
        errorMessage = JSON.stringify(errorMessage);
      }
      throw new ApiError(
        errorMessage,
        response.status,
        errorBody
      );
    }

    return await response.json();

  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof ApiError) throw error;

    if (error.name === 'AbortError') {
      throw new ApiError('Request timed out. Please try again.', 408);
    }

    // Network error — backend unreachable
    throw new ApiError(
      'Unable to connect to PhishArmor servers. Please check your connection.',
      0,
      { originalError: error.message }
    );
  }
}


/**
 * Custom error class for API errors.
 */
class ApiError extends Error {
  constructor(message, statusCode, details = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
  }

  get isAuthError() {
    return this.statusCode === 401;
  }

  get isNetworkError() {
    return this.statusCode === 0;
  }

  get isRateLimited() {
    return this.statusCode === 429;
  }
}


// ---------------------------------------------------------------------------
// PUBLIC API METHODS
// ---------------------------------------------------------------------------

/**
 * Analyze an email for phishing threats.
 * Uses authenticated /api/v1/analyze if logged in,
 * falls back to unauthenticated /api/analyze-email if not.
 *
 * @param {Object} emailData - Email to analyze
 * @param {string} emailData.sender - Sender email address
 * @param {string} emailData.subject - Email subject
 * @param {string} emailData.body - Email body text
 * @param {string} [emailData.gmailMessageId] - Gmail message ID
 * @param {string[]} [emailData.urls] - Extracted URLs
 * @returns {Object} Analysis result with risk level, confidence, assessment
 */
async function analyzeEmail(emailData) {
  const token = await getAuthToken();

  if (token) {
    // Authenticated path — results are persisted to user's history
    return apiRequest('/analyze', {
      method: 'POST',
      body: {
        sender: emailData.sender,
        subject: emailData.subject,
        body: emailData.body,
        body_html: emailData.bodyHtml || null,
        gmail_message_id: emailData.gmailMessageId || emailData.id || null,
        urls: emailData.urls || [],
      },
      timeout: ANALYSIS_TIMEOUT_MS,
      requireAuth: true,
      useV1: true,
    });
  } else {
    // Unauthenticated fallback — uses existing legacy endpoint
    const result = await apiRequest('/analyze-email', {
      method: 'POST',
      body: {
        id: emailData.id || `anon-${Date.now()}`,
        sender: emailData.sender,
        subject: emailData.subject,
        body: emailData.body || emailData.bodyText,
      },
      timeout: ANALYSIS_TIMEOUT_MS,
      useV1: false,
    });

    // Normalize the response to match v1 format
    return {
      risk_level: result.riskLevel || 'unknown',
      confidence: result.confidence || 0,
      overall_assessment: result.overallAssessment || '',
      reasoning: result.reasoning || [],
      urgent_language_detected: result.urgentLanguageAI || false,
      sensitive_info_requested: result.requestsSensitiveInfoAI || false,
      grammar_issues_detected: result.grammarIssuesAI || false,
      urgent_language_details: result.urgentLanguageDetails || null,
      sensitive_info_details: result.sensitiveInfoDetails || null,
      grammar_details: result.grammarDetails || null,
      processing_time_ms: 0,
      persisted: false,
      scan_id: null,
    };
  }
}

/**
 * Get the user's scan history (authenticated only).
 */
async function getScanHistory(page = 1, pageSize = 20, riskLevel = null) {
  let endpoint = `/history?page=${page}&page_size=${pageSize}`;
  if (riskLevel) endpoint += `&risk_level=${encodeURIComponent(riskLevel)}`;
  return apiRequest(endpoint, { requireAuth: true });
}

/**
 * Get a specific scan detail (authenticated only).
 */
async function getScanDetail(scanId) {
  return apiRequest(`/history/${scanId}`, { requireAuth: true });
}

/**
 * Dismiss a scan from history (authenticated only).
 */
async function dismissScan(scanId) {
  return apiRequest(`/history/${scanId}`, {
    method: 'DELETE',
    requireAuth: true,
  });
}

/**
 * Submit user classification feedback on a scan.
 */
async function classifyScan(scanId, classification) {
  return apiRequest(`/history/${scanId}/classify`, {
    method: 'PATCH',
    body: { classification },
    requireAuth: true,
  });
}

/**
 * Get user stats (authenticated only).
 */
async function getUserStats() {
  return apiRequest('/stats', { requireAuth: true });
}

/**
 * Get user settings/profile (authenticated only).
 */
async function getUserSettings() {
  return apiRequest('/settings', { requireAuth: true });
}

/**
 * Update user settings (authenticated only).
 */
async function updateUserSettings(updates) {
  return apiRequest('/settings', {
    method: 'PATCH',
    body: updates,
    requireAuth: true,
  });
}

/**
 * Get user tier information (authenticated only).
 */
async function getUserTier() {
  return apiRequest('/tier', {
    method: 'GET',
    requireAuth: true,
  });
}

/**
 * Start a trial for the user (authenticated only).
 */
async function startTrial() {
  return apiRequest('/trial/start', {
    method: 'POST',
    requireAuth: true,
  });
}

/**
 * Check backend health (no auth needed).
 */
async function checkBackendHealth() {
  try {
    const response = await fetch(`${BACKEND_BASE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { status: 'unhealthy', statusCode: response.status };
    return await response.json();
  } catch (error) {
    return { status: 'unreachable', error: error.message };
  }
}

// Export for use in other modules
// In MV3 service workers, we use globalThis instead of module.exports
if (typeof globalThis !== 'undefined') {
  globalThis.PhishArmorAPI = {
    analyzeEmail,
    getScanHistory,
    getScanDetail,
    dismissScan,
    classifyScan,
    getUserStats,
    getUserSettings,
    updateUserSettings,
    getUserTier,
    startTrial,
    checkBackendHealth,
    getAuthToken,
    ApiError,
    BACKEND_BASE_URL,
  };
}
