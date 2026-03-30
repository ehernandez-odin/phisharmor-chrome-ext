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
importScripts('api-client.js', 'auth.js', 'storage.js', 'gmail-api.js');

console.log('PhishArmor Background v2.1 loaded (Gmail API).');

// Module references (loaded via importScripts in manifest.json)
const API = globalThis.PhishArmorAPI;
const Auth = globalThis.PhishArmorAuth;
const Storage = globalThis.PhishArmorStorage;
const GmailAPI = globalThis.PhishArmorGmailAPI;

// ---------------------------------------------------------------------------
// Tier Info Cache
// ---------------------------------------------------------------------------

let cachedTierInfo = null;
let tierCacheExpiry = 0;
const TIER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getCachedTierInfo(forceRefresh = false) {
  if (!forceRefresh && cachedTierInfo && Date.now() < tierCacheExpiry) {
    return cachedTierInfo;
  }
  try {
    cachedTierInfo = await API.getUserTier();
    tierCacheExpiry = Date.now() + TIER_CACHE_TTL;
    return cachedTierInfo;
  } catch (err) {
    console.warn('PhishArmor: Failed to fetch tier info, using cached or defaults', err);
    if (cachedTierInfo) return cachedTierInfo;
    // Default to free tier
    return {
      tier: 'free', plan: 'free', daily_scan_limit: 5,
      daily_scans_used: 0, scans_remaining: 5,
      can_auto_scan: false, can_scan: true, show_ads: true,
      trial_ends_at: null, trial_days_remaining: null,
      features: {
        auto_scan: false, sender_verification: false,
        safe_link_checking: false, full_scan_history: false,
        export: false, priority_support: false, ad_free: false
      }
    };
  }
}

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
// External Message Handler (Portal → Extension Auth Bridge)
// ---------------------------------------------------------------------------
// The PhishArmor portal (app.phisharmor.ai) sends Supabase tokens after login.
// This allows users who sign in on the web portal to automatically activate
// their extension for scanning.

chrome.runtime.onMessageExternal.addListener(async (message, sender, sendResponse) => {
  // Only accept messages from PhishArmor domains
  const allowedOrigins = [
    'https://app.phisharmor.ai',
    'https://phisharmor.ai',
    'https://phisharmor.com',
    'https://www.phisharmor.com',
  ];

  if (!allowedOrigins.some(origin => sender.url?.startsWith(origin))) {
    console.warn('PhishArmor: Rejected external message from:', sender.url);
    sendResponse({ success: false, error: 'Unauthorized origin' });
    return;
  }

  if (message.action === 'setAuthToken' || message.action === 'portalLogin') {
    try {
      // Portal sends: { action: 'setAuthToken', token, userId, expiresAt }
      // Also support: { action: 'portalLogin', access_token, refresh_token, expires_in, user_email }
      const accessToken = message.token || message.access_token;
      const refreshToken = message.refresh_token || null;
      const userId = message.userId || null;
      const userEmail = message.user_email || null;

      if (!accessToken) {
        sendResponse({ success: false, error: 'No access token provided' });
        return;
      }

      // Calculate expiry: portal sends expiresAt (epoch seconds) or expires_in (seconds from now)
      let tokenExpiresAt;
      if (message.expiresAt) {
        // Portal sends epoch seconds — convert to ms
        tokenExpiresAt = message.expiresAt * 1000;
      } else if (message.expires_in) {
        tokenExpiresAt = Date.now() + (message.expires_in * 1000);
      } else {
        tokenExpiresAt = Date.now() + (3600 * 1000); // Default 1 hour
      }

      // Store Supabase tokens (same keys as internal auth)
      await chrome.storage.session.set({
        authToken: accessToken,
        refreshToken: refreshToken,
        tokenExpiresAt: tokenExpiresAt,
      });

      // Update sync storage so popup and content script know user is logged in
      await chrome.storage.sync.set({
        isLoggedIn: true,
        userEmail: userEmail,
      });

      // Schedule token refresh before expiry
      const expiresInSeconds = Math.max(Math.floor((tokenExpiresAt - Date.now()) / 1000), 60);
      schedulePortalTokenRefresh(expiresInSeconds);

      // Refresh tier info
      cachedTierInfo = null;
      tierCacheExpiry = 0;

      console.log('PhishArmor: Portal login tokens received and stored. userId:', userId);

      // Notify any open Gmail tabs to refresh their state
      const tabs = await chrome.tabs.query({ url: '*://mail.google.com/*' });
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { action: 'authStateChanged', isLoggedIn: true }).catch(() => {});
      }

      sendResponse({ success: true, message: 'Extension activated' });
    } catch (err) {
      console.error('PhishArmor: Portal login bridge error:', err);
      sendResponse({ success: false, error: err.message });
    }
    return;
  }

  if (message.action === 'checkExtensionInstalled') {
    sendResponse({ installed: true, version: chrome.runtime.getManifest().version });
    return;
  }

  sendResponse({ success: false, error: 'Unknown action' });
});

function schedulePortalTokenRefresh(expiresInSeconds) {
  const refreshInMs = Math.max(
    (expiresInSeconds * 1000) - (5 * 60 * 1000),
    60000
  );
  chrome.alarms.create('phisharmor-token-refresh', {
    delayInMinutes: refreshInMs / 60000,
  });
}


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

    // --- Tier Management ---
    case 'getTierInfo':
      getCachedTierInfo().then(tierInfo => sendResponse({ success: true, tierInfo }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'startTrial':
      handleStartTrial(sendResponse);
      return true;

    case 'refreshTierInfo':
      getCachedTierInfo(true).then(tierInfo => sendResponse({ success: true, tierInfo }))
        .catch(err => sendResponse({ success: false, error: err.message }));
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
    // 0. Check authentication and tier gating
    const isAuthed = await Auth.isAuthenticated();
    if (!isAuthed) {
      // User not logged in — show login required shield
      const loginDetails = {
        level: 'login_required',
        score: 'Login Required',
        message: 'Please log in to scan emails.',
        indicators: {},
        aiAnalysisDetails: {},
      };
      // Cache so tooltip can display it
      await Storage.cacheAnalysisResult(emailData.id, loginDetails);
      sendShieldUpdate(tabId, emailData.id, loginDetails);
      return;
    }

    // Get tier info for analysis gating
    const tierInfo = await getCachedTierInfo();

    // Check user preference for auto-analyze
    if (emailData.triggerType === 'auto') {
      const prefs = await chrome.storage.sync.get({ autoAnalyze: true });
      if (!prefs.autoAnalyze) {
        console.log('PhishArmor: Auto-analyze disabled by user preference');
        const manualDetails = {
          level: 'manual',
          score: 'Manual Only',
          message: 'Click the shield to scan this email.',
          indicators: {},
          aiAnalysisDetails: {},
        };
        await Storage.cacheAnalysisResult(emailData.id, manualDetails);
        sendShieldUpdate(tabId, emailData.id, manualDetails);
        return;
      }
    }

    // Check if auto-scan is being triggered but not allowed by tier
    if (emailData.triggerType === 'auto' && !tierInfo.can_auto_scan) {
      console.log('PhishArmor: Auto-scan not allowed for tier', tierInfo.tier);
      const manualDetails = {
        level: 'manual',
        score: 'Manual Only',
        message: 'Click the shield to scan this email. Free plan supports manual scanning only.',
        indicators: {},
        aiAnalysisDetails: {},
      };
      // Cache so tooltip can display it
      await Storage.cacheAnalysisResult(emailData.id, manualDetails);
      sendShieldUpdate(tabId, emailData.id, manualDetails);
      return;
    }

    // Check if scanning is allowed at all
    if (!tierInfo.can_scan) {
      console.log('PhishArmor: Scanning limit reached for tier', tierInfo.tier);
      const limitDetails = {
        level: 'limit_reached',
        score: 'Limit Reached',
        message: 'Your daily scan limit has been reached. Please try again tomorrow.',
        indicators: {},
        aiAnalysisDetails: {},
        scanInfo: {
          daily_scans_used: tierInfo.daily_scans_used,
          daily_scan_limit: tierInfo.daily_scan_limit,
        },
      };
      // Cache so tooltip can display it
      await Storage.cacheAnalysisResult(emailData.id, limitDetails);
      sendShieldUpdate(tabId, emailData.id, limitDetails);
      return;
    }

    // 1. Check cache first (unless forced)
    //    Skip cached non-analysis states (manual, login_required, limit_reached, error)
    //    so that manual re-scans and post-login scans proceed to actual analysis.
    if (!forceDisplay) {
      const cached = await Storage.getCachedResult(emailData.id);
      const nonAnalysisLevels = ['manual', 'login_required', 'limit_reached', 'loading', 'error'];
      if (cached && !nonAnalysisLevels.includes(cached.level)) {
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

    // 2.5. Fetch email data via Gmail API if we only have a message ID
    //      (content script now sends just the ID instead of scraped DOM data)
    if (emailData.id && !emailData.bodyText && !emailData.body) {
      console.log('PhishArmor: Fetching email via Gmail API for:', emailData.id);
      try {
        const gmailData = await GmailAPI.fetchEmailById(emailData.id);
        // Merge Gmail API data into emailData (preserving triggerType, etc.)
        const triggerType = emailData.triggerType;
        emailData = { ...emailData, ...gmailData };
        emailData.triggerType = triggerType;
        console.log('PhishArmor: Gmail API fetch successful —', emailData.sender, '—', emailData.subject);
      } catch (gmailError) {
        console.error('PhishArmor: Gmail API fetch failed:', gmailError.message, gmailError.code);

        if (gmailError.isTokenError) {
          // Google token missing or expired — user needs to re-authenticate
          const reAuthDetails = {
            level: 'login_required',
            score: 'Sign In Again',
            message: 'Your Gmail access has expired. Please sign in again to enable email scanning.',
            indicators: {},
            aiAnalysisDetails: {},
          };
          await Storage.cacheAnalysisResult(emailData.id, reAuthDetails);
          sendShieldUpdate(tabId, emailData.id, reAuthDetails);
          return;
        }

        // Other Gmail API errors (network, not found, etc.)
        const errorDetails = {
          level: 'error',
          score: 'Error',
          color: 'grey',
          message: gmailError.isNetworkError
            ? 'Unable to reach Gmail. Please check your connection.'
            : `Failed to fetch email: ${gmailError.message}`,
          indicators: {},
          aiAnalysisDetails: {},
        };
        await Storage.cacheAnalysisResult(emailData.id, errorDetails);
        sendShieldUpdate(tabId, emailData.id, errorDetails);
        return;
      }
    }

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
      urls: emailData.urls || extractUrlsFromText(emailData.bodyText || emailData.body || ''),
      emailHeaders: emailData.emailHeaders || null,
    });
    const elapsed = Date.now() - startTime;

    // 4. Build score details for the shield/tooltip
    const scoreDetails = buildScoreDetails(result, emailData, elapsed);

    // 5. Cache the result
    await Storage.cacheAnalysisResult(emailData.id, scoreDetails);

    // 6. Update cached tier's daily_scans_used counter
    if (cachedTierInfo) {
      cachedTierInfo.daily_scans_used = (cachedTierInfo.daily_scans_used || 0) + 1;
      cachedTierInfo.scans_remaining = Math.max(0, cachedTierInfo.daily_scan_limit - cachedTierInfo.daily_scans_used);
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
      color: 'grey',
      message: error.isNetworkError
        ? 'Unable to reach PhishArmor servers. Please check your connection.'
        : error.isAuthError
        ? 'Please log in to continue scanning.'
        : `Analysis failed: ${error.message || 'Unknown error'}. Please try again.`,
      error: error.message,
      indicators: {},
      aiAnalysisDetails: {},
    };

    // Cache error results so the tooltip can display them
    await Storage.cacheAnalysisResult(emailData.id, errorDetails);

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
  } else if (['medium', 'moderate', 'caution needed', 'suspicious'].includes(riskLevel)) {
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

  // Build the indicators object that the tooltip's generateIndicatorRows expects
  const urgentLanguage = result.urgent_language_detected || result.urgentLanguageAI || false;
  const sensitiveInfo = result.sensitive_info_requested || result.requestsSensitiveInfoAI || false;
  const grammarIssues = result.grammar_issues_detected || result.grammarIssuesAI || false;
  const suspiciousSender = result.suspicious_sender || result.suspiciousSender || (level !== 'safe' && result.domain_reputation?.risk === 'high') || false;
  const suspiciousLinks = result.suspicious_links_detected || result.suspiciousLinks || (result.url_threats && result.url_threats.length > 0) || false;

  const indicators = {
    suspiciousSenderAddress: {
      present: suspiciousSender,
      reason: result.sender_analysis || result.senderAnalysis || result.domain_reputation?.summary || '',
    },
    suspiciousLinks: {
      present: suspiciousLinks,
      reason: result.link_analysis || result.linkAnalysis || (result.url_threats ? `${result.url_threats.length} suspicious URL(s) detected` : ''),
    },
    urgentLanguage: {
      present: urgentLanguage,
      reason: result.urgent_language_details || result.urgentLanguageDetails || '',
    },
    requestsSensitiveInfo: {
      present: sensitiveInfo,
      reason: result.sensitive_info_details || result.sensitiveInfoDetails || '',
    },
    spellingMistakes: {
      present: grammarIssues,
      reason: result.grammar_details || result.grammarDetails || '',
    },
  };

  // Build aiAnalysisDetails for the tooltip's detail text in each indicator dropdown
  const aiAnalysisDetails = {
    technicalSecuritySummary: result.technical_security_summary || result.technicalSecuritySummary || '',
    urgentLanguageDetails: result.urgent_language_details || result.urgentLanguageDetails || '',
    sensitiveInfoDetails: result.sensitive_info_details || result.sensitiveInfoDetails || '',
    grammarQualityDetails: result.grammar_details || result.grammarDetails || '',
    userRecommendation: result.user_recommendation || result.userRecommendation || '',
  };

  return {
    level,
    score,
    color,
    riskLevel: result.risk_level || result.riskLevel || 'unknown',
    confidence: result.confidence || 0,
    overallAssessment: result.overall_assessment || result.overallAssessment || '',
    reasoning: result.reasoning || [],
    indicators,
    aiAnalysisDetails,
    urgentLanguage,
    sensitiveInfo,
    grammarIssues,
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
      // Invalidate tier cache on login
      cachedTierInfo = null;
      tierCacheExpiry = 0;
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
    // Invalidate tier cache on logout
    cachedTierInfo = null;
    tierCacheExpiry = 0;
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
        explanation: `${stats.total_scans} emails scanned, ${stats.total_flagged} flagged this month.`,
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

async function handleStartTrial(sendResponse) {
  try {
    const result = await API.startTrial();
    // Invalidate tier cache so it refreshes on next call
    cachedTierInfo = null;
    tierCacheExpiry = 0;
    sendResponse({ success: true, result });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
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
