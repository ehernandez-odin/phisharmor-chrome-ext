/**
 * PhishArmor Background Script v2.0
 *
 * Refactored service worker that delegates to modules:
 * - api-client.js: All backend API communication
 * - auth.js: Supabase authentication and token management
 * - storage.js: Chrome storage wrapper with caching
 *
 * NO direct API calls to OpenAI, Web Risk, or APIVoid.
 * NO API keys stored in the extension.
 * ALL analysis is proxied through the PhishArmor backend.
 */

// Load modules — importScripts must be at the top level in MV3 service workers
importScripts('api-client.js', 'auth.js', 'storage.js');

console.log('PhishArmor Background v2.0 loaded.');

// Module references (loaded via importScripts in manifest.json)
const API = globalThis.PhishArmorAPI;
const Auth = globalThis.PhishArmorAuth;
const Storage = globalThis.PhishArmorStorage;

// ---------------------------------------------------------------------------
// Installation & Update Handlers
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('PhishArmor installed/updated:', details.reason);

  if (details.reason === 'install') {
    // First install — set defaults and show onboarding
    await Storage.updatePreferences({
      onboardingComplete: false,
      sensitivityLevel: 'medium',
      showNotifications: true,
      autoAnalyze: true,
    });

    // Create context menu
    chrome.contextMenus.create({
      id: 'analyzeSelectedText',
      title: 'Analyze for Phishing (PhishArmor)',
      contexts: ['selection'],
    });

    console.log('PhishArmor: First install setup complete');

  } else if (details.reason === 'update') {
    // Update from old version — migrate legacy storage
    if (details.previousVersion && details.previousVersion.startsWith('0.')) {
      console.log('PhishArmor: Migrating from v0.x to v2.0');
      await Storage.migrateLegacyStorage();
    }

    // Ensure context menu exists
    chrome.contextMenus.create({
      id: 'analyzeSelectedText',
      title: 'Analyze for Phishing (PhishArmor)',
      contexts: ['selection'],
    });
  }
});


// ---------------------------------------------------------------------------
// Context Menu Handler
// ---------------------------------------------------------------------------

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'analyzeSelectedText' && info.selectionText) {
    const emailData = {
      id: `selection-${Date.now()}`,
      sender: 'N/A (Selected Text)',
      subject: 'Selected Text Analysis',
      body: info.selectionText,
    };
    handleEmailAnalysis(emailData, tab.id, true);
  }
});


// ---------------------------------------------------------------------------
// Message Router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id || null;

  switch (message.action) {
    // --- Email Analysis ---
    case 'analyzeEmail':
      if (!message.emailData?.id) {
        sendResponse({ status: 'error', error: 'Invalid email data' });
        return true;
      }
      handleEmailAnalysis(message.emailData, tabId);
      sendResponse({ status: 'received', emailId: message.emailData.id });
      return true;

    // --- Tooltip Data ---
    case 'getReportDataForTooltip':
      handleGetReportData(message.emailId, sendResponse);
      return true;

    case 'showTooltip':
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          action: 'displayTooltipInTab',
          emailId: message.emailId,
          rect: message.rect,
        });
      }
      sendResponse({ status: 'tooltip_signal_sent' });
      return true;

    case 'closePhishArmorTooltip':
      if (message.tabId) {
        chrome.tabs.sendMessage(message.tabId, { action: 'closeTooltipInTab' });
      }
      sendResponse({ status: 'close_signal_sent' });
      return true;

    // --- Tab ID ---
    case 'getTabId':
      sendResponse({ tabId: tabId });
      return true;

    // --- Authentication ---
    case 'authenticate':
      handleAuthenticate(message, sendResponse);
      return true;

    case 'signUp':
      handleSignUp(message, sendResponse);
      return true;

    case 'logout':
      handleLogout(sendResponse);
      return true;

    case 'checkAuth':
      handleCheckAuth(sendResponse);
      return true;

    // --- User Data ---
    case 'getUserStats':
      handleGetUserStats(sendResponse);
      return true;

    case 'openFlaggedEmails':
      handleOpenFlaggedEmails(sendResponse);
      return true;

    case 'getScanHistory':
      handleGetScanHistory(message, sendResponse);
      return true;

    // --- Settings ---
    case 'getSettings':
      handleGetSettings(sendResponse);
      return true;

    case 'updateSettings':
      handleUpdateSettings(message.settings, sendResponse);
      return true;

    // --- Health Check ---
    case 'checkHealth':
      API.checkBackendHealth().then(result => sendResponse(result));
      return true;

    // --- Error Logging ---
    case 'logError':
      console.error('PhishArmor Error:', message.error);
      sendResponse({ status: 'logged' });
      return true;

    default:
      console.log('PhishArmor: Unknown message action:', message.action);
      sendResponse({ status: 'unknown_action' });
      return true;
  }
});


// ---------------------------------------------------------------------------
// Core Analysis Handler
// ---------------------------------------------------------------------------

async function handleEmailAnalysis(emailData, tabId, forceDisplay = false) {
  try {
    // 1. Check cache first (unless forced)
    if (!forceDisplay) {
      const cached = await Storage.getCachedResult(emailData.id);
      if (cached) {
        console.log('PhishArmor: Using cached result for', emailData.id);
        sendShieldUpdate(tabId, emailData.id, cached);
        return;
      }
    }

    // 2. Show loading state
    sendShieldUpdate(tabId, emailData.id, {
      level: 'loading',
      score: 'Analyzing...',
      message: 'AI analysis in progress...',
    });

    // 3. Call the backend (handles all AI/security checks)
    const startTime = Date.now();
    const rawSender = emailData.sender || emailData.from || 'unknown';
    const result = await API.analyzeEmail({
      id: emailData.id,
      sender: extractEmailAddress(rawSender),
      subject: emailData.subject || 'No subject',
      body: emailData.bodyText || emailData.body || '',
      bodyHtml: emailData.bodyHtml || '',
      gmailMessageId: emailData.id,
      urls: extractUrlsFromText(emailData.bodyText || emailData.body || ''),
    });
    const elapsed = Date.now() - startTime;

    // 4. Build score details for the shield/tooltip
    const scoreDetails = buildScoreDetails(result, emailData, elapsed);

    // 5. Cache the result
    await Storage.cacheAnalysisResult(emailData.id, scoreDetails);

    // 6. Increment scan counter
    await Storage.incrementCounter('emailsScannedCount');
    if (scoreDetails.level === 'high' || scoreDetails.level === 'critical') {
      await Storage.incrementCounter('flaggedEmailsCount');
    }

    // 7. Update the shield icon
    sendShieldUpdate(tabId, emailData.id, scoreDetails);

    console.log(`PhishArmor: Analysis complete for ${emailData.id} — ${scoreDetails.level} (${elapsed}ms)`);

  } catch (error) {
    console.error('PhishArmor: Analysis failed for', emailData.id,
      error.message || error,
      error.statusCode ? `(HTTP ${error.statusCode})` : '',
      error.details ? JSON.stringify(error.details) : ''
    );

    const errorDetails = {
      level: 'error',
      score: 'Error',
      message: error.isNetworkError
        ? 'Unable to reach PhishArmor servers. Please check your connection.'
        : error.isAuthError
        ? 'Please log in to continue scanning.'
        : `Analysis failed: ${error.message || 'Unknown error'}. Please try again.`,
      error: error.message,
    };

    sendShieldUpdate(tabId, emailData.id, errorDetails);
  }
}


// ---------------------------------------------------------------------------
// Score Details Builder
// ---------------------------------------------------------------------------

function buildScoreDetails(result, emailData, elapsedMs) {
  // Map risk level to shield level
  const riskLevel = (result.risk_level || result.riskLevel || 'unknown').toLowerCase();
  let level, score, color;

  if (['looks safe', 'safe', 'low', 'very_low'].includes(riskLevel)) {
    level = 'safe';
    score = 'Safe';
    color = 'green';
  } else if (['medium', 'moderate', 'caution needed'].includes(riskLevel)) {
    level = 'medium';
    score = 'Caution';
    color = 'yellow';
  } else if (['high', 'critical', 'dangerous', 'likely phishing'].includes(riskLevel)) {
    level = 'high';
    score = 'Danger';
    color = 'red';
  } else {
    level = 'unknown';
    score = 'Unknown';
    color = 'grey';
  }

  return {
    level,
    score,
    color,
    riskLevel: result.risk_level || result.riskLevel || 'unknown',
    confidence: result.confidence || 0,
    overallAssessment: result.overall_assessment || result.overallAssessment || '',
    reasoning: result.reasoning || [],
    urgentLanguage: result.urgent_language_detected || result.urgentLanguageAI || false,
    sensitiveInfo: result.sensitive_info_requested || result.requestsSensitiveInfoAI || false,
    grammarIssues: result.grammar_issues_detected || result.grammarIssuesAI || false,
    urgentLanguageDetails: result.urgent_language_details || result.urgentLanguageDetails || '',
    sensitiveInfoDetails: result.sensitive_info_details || result.sensitiveInfoDetails || '',
    grammarDetails: result.grammar_details || result.grammarDetails || '',
    domainReputation: result.domain_reputation || null,
    urlThreats: result.url_threats || null,
    processingTimeMs: result.processing_time_ms || elapsedMs,
    scanId: result.scan_id || null,
    persisted: result.persisted || false,
    sender: emailData.sender || 'unknown',
    subject: emailData.subject || 'No subject',
    analyzedAt: new Date().toISOString(),
  };
}


// ---------------------------------------------------------------------------
// Shield Communication
// ---------------------------------------------------------------------------

function sendShieldUpdate(tabId, emailId, scoreDetails) {
  if (!tabId) return;

  chrome.tabs.sendMessage(tabId, {
    action: 'updateShield',
    emailId,
    scoreDetails,
  }).catch(error => {
    // Tab might have been closed or navigated away
    console.warn('PhishArmor: Could not update shield for tab', tabId, error.message);
  });
}


// ---------------------------------------------------------------------------
// Auth Handlers
// ---------------------------------------------------------------------------

async function handleAuthenticate(message, sendResponse) {
  try {
    const { email, password, type } = message;

    let result;
    if (type === 'google') {
      result = await Auth.signInWithGoogle();
    } else {
      result = await Auth.signIn(email, password);
    }

    if (result.success) {
      // Fetch user stats after login
      try {
        const stats = await API.getUserStats();
        sendResponse({ success: true, user: result.user, userStats: stats });
      } catch {
        sendResponse({ success: true, user: result.user, userStats: null });
      }
    } else {
      sendResponse({ success: false, error: result.error });
    }
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleSignUp(message, sendResponse) {
  try {
    const { email, password, fullName } = message;
    const result = await Auth.signUp(email, password, fullName);
    sendResponse(result);
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleLogout(sendResponse) {
  try {
    await Auth.signOut();
    await Storage.clearCache();
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleCheckAuth(sendResponse) {
  try {
    const isAuthed = await Auth.isAuthenticated();
    const user = isAuthed ? await Auth.getCurrentUser() : null;
    sendResponse({ isAuthenticated: isAuthed, user });
  } catch (error) {
    sendResponse({ isAuthenticated: false, user: null });
  }
}


// ---------------------------------------------------------------------------
// Data Handlers
// ---------------------------------------------------------------------------

async function handleGetUserStats(sendResponse) {
  try {
    const isAuthed = await Auth.isAuthenticated();
    if (!isAuthed) {
      // Return local stats for unauthenticated users
      const prefs = await Storage.getPreferences();
      sendResponse({
        success: true,
        userStats: {
          securityScore: 'N/A',
          emailsScanned: prefs.emailsScannedCount || 0,
          blockedUrls: prefs.flaggedEmailsCount || 0,
        },
      });
      return;
    }

    const stats = await API.getUserStats();
    sendResponse({
      success: true,
      userStats: {
        securityScore: stats.security_score,
        emailsScanned: stats.total_scans,
        blockedUrls: stats.total_flagged,
        explanation: `${stats.total_scans} emails scanned, ${stats.total_flagged} flagged.`,
      },
    });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleOpenFlaggedEmails(sendResponse) {
  try {
    // Open the dashboard (when it exists) or show history in a tab
    // For now, we'll open a simple history page
    // TODO: Replace with actual dashboard URL when Phase 4 is built
    const isAuthed = await Auth.isAuthenticated();
    if (isAuthed) {
      const history = await API.getScanHistory(1, 20);
      // Store in local storage for a temporary history view
      await chrome.storage.local.set({ _flaggedHistory: history });
    }
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleGetScanHistory(message, sendResponse) {
  try {
    const { page = 1, pageSize = 20, riskLevel = null } = message;
    const result = await API.getScanHistory(page, pageSize, riskLevel);
    sendResponse({ success: true, data: result });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleGetSettings(sendResponse) {
  try {
    const localPrefs = await Storage.getPreferences();
    const isAuthed = await Auth.isAuthenticated();

    if (isAuthed) {
      try {
        const serverSettings = await API.getUserSettings();
        sendResponse({ success: true, settings: { ...localPrefs, ...serverSettings } });
        return;
      } catch {
        // Fall back to local prefs
      }
    }

    sendResponse({ success: true, settings: localPrefs });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleUpdateSettings(settings, sendResponse) {
  try {
    // Update local preferences
    await Storage.updatePreferences(settings);

    // Sync to server if authenticated
    const isAuthed = await Auth.isAuthenticated();
    if (isAuthed) {
      try {
        await API.updateUserSettings(settings);
      } catch {
        // Local update succeeded, server sync failed — not critical
      }
    }

    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleGetReportData(emailId, sendResponse) {
  try {
    const cached = await Storage.getCachedResult(emailId);
    if (cached) {
      sendResponse({ scoreDetails: cached });
    } else {
      sendResponse({ error: 'No report data found' });
    }
  } catch (error) {
    sendResponse({ error: 'Failed to retrieve report data' });
  }
}


// ---------------------------------------------------------------------------
// URL Extraction (kept locally since it's simple and fast)
// ---------------------------------------------------------------------------

function extractUrlsFromText(text) {
  if (!text) return [];
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  const matches = text.match(urlRegex) || [];
  return [...new Set(matches)].slice(0, 20); // Dedupe, max 20 URLs
}

/**
 * Extract a bare email address from a sender string.
 * Handles formats like:
 *   "Display Name <user@example.com>"  → "user@example.com"
 *   "user@example.com"                 → "user@example.com"
 *   "N/A (Selected Text)"             → "unknown@unknown.com"
 */
function extractEmailAddress(sender) {
  if (!sender) return 'unknown@unknown.com';

  // Try to extract email from "Name <email>" format
  const angleMatch = sender.match(/<([^>]+@[^>]+)>/);
  if (angleMatch) return angleMatch[1].trim();

  // Check if it's already a bare email
  const bareMatch = sender.match(/^[\w.+-]+@[\w.-]+\.\w+$/);
  if (bareMatch) return bareMatch[0].trim();

  // Try to find any email-like pattern in the string
  const anyMatch = sender.match(/[\w.+-]+@[\w.-]+\.\w+/);
  if (anyMatch) return anyMatch[0].trim();

  // No valid email found — return a placeholder
  return 'unknown@unknown.com';
}
