/**
 * PhishArmor Storage Module
 *
 * Centralized wrapper around chrome.storage for caching analysis results,
 * managing user preferences, and tracking extension state.
 *
 * Storage strategy:
 * - chrome.storage.session: Auth tokens (cleared on browser close)
 * - chrome.storage.local: Cached analysis results with TTL
 * - chrome.storage.sync: User preferences that sync across devices
 */

// Cache configuration
const CACHE_TTL_MS = 5 * 60 * 1000;  // 5 minutes for analysis results
const MAX_CACHED_RESULTS = 50;         // Keep last 50 analysis results
const CACHE_PREFIX = 'emailCache_';

// ---------------------------------------------------------------------------
// Analysis Result Caching
// ---------------------------------------------------------------------------

/**
 * Cache an analysis result for an email.
 * Results expire after CACHE_TTL_MS.
 */
async function cacheAnalysisResult(emailId, result) {
  const key = `${CACHE_PREFIX}${emailId}`;
  const entry = {
    result,
    cachedAt: Date.now(),
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  try {
    await chrome.storage.local.set({ [key]: entry });

    // Track cached keys for cleanup
    const meta = await chrome.storage.local.get(['_cacheKeys']);
    const keys = meta._cacheKeys || [];
    if (!keys.includes(key)) {
      keys.push(key);
      // Evict oldest if over limit
      if (keys.length > MAX_CACHED_RESULTS) {
        const toRemove = keys.splice(0, keys.length - MAX_CACHED_RESULTS);
        await chrome.storage.local.remove(toRemove);
      }
      await chrome.storage.local.set({ _cacheKeys: keys });
    }
  } catch (error) {
    console.warn('PhishArmor Storage: Failed to cache result:', error);
  }
}

/**
 * Get a cached analysis result if it exists and hasn't expired.
 * Returns null if not cached or expired.
 */
async function getCachedResult(emailId) {
  const key = `${CACHE_PREFIX}${emailId}`;
  try {
    const data = await chrome.storage.local.get([key]);
    const entry = data[key];

    if (!entry) return null;

    // Check expiry
    if (Date.now() > entry.expiresAt) {
      await chrome.storage.local.remove([key]);
      return null;
    }

    return entry.result;
  } catch (error) {
    console.warn('PhishArmor Storage: Failed to get cached result:', error);
    return null;
  }
}

/**
 * Clear all cached analysis results.
 */
async function clearCache() {
  try {
    const meta = await chrome.storage.local.get(['_cacheKeys']);
    const keys = meta._cacheKeys || [];
    if (keys.length > 0) {
      await chrome.storage.local.remove([...keys, '_cacheKeys']);
    }
    console.log('PhishArmor Storage: Cache cleared');
  } catch (error) {
    console.warn('PhishArmor Storage: Failed to clear cache:', error);
  }
}

/**
 * Clean up expired cache entries.
 * Called periodically via alarm.
 */
async function cleanExpiredCache() {
  try {
    const meta = await chrome.storage.local.get(['_cacheKeys']);
    const keys = meta._cacheKeys || [];
    const now = Date.now();
    const validKeys = [];

    for (const key of keys) {
      const data = await chrome.storage.local.get([key]);
      const entry = data[key];
      if (entry && now <= entry.expiresAt) {
        validKeys.push(key);
      } else {
        await chrome.storage.local.remove([key]);
      }
    }

    await chrome.storage.local.set({ _cacheKeys: validKeys });
    const removed = keys.length - validKeys.length;
    if (removed > 0) {
      console.log(`PhishArmor Storage: Cleaned ${removed} expired cache entries`);
    }
  } catch (error) {
    console.warn('PhishArmor Storage: Cache cleanup failed:', error);
  }
}


// ---------------------------------------------------------------------------
// User Preferences (synced across devices)
// ---------------------------------------------------------------------------

const DEFAULT_PREFERENCES = {
  isLoggedIn: false,
  userEmail: null,
  sensitivityLevel: 'medium',        // 'low', 'medium', 'high'
  showNotifications: true,
  autoAnalyze: true,                  // Auto-analyze when email is opened
  emailsScannedCount: 0,
  flaggedEmailsCount: 0,
  onboardingComplete: false,
};

/**
 * Get user preferences, with defaults for any missing values.
 */
async function getPreferences() {
  try {
    const result = await chrome.storage.sync.get(DEFAULT_PREFERENCES);
    return { ...DEFAULT_PREFERENCES, ...result };
  } catch (error) {
    console.warn('PhishArmor Storage: Failed to get preferences:', error);
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Update user preferences.
 */
async function updatePreferences(updates) {
  try {
    // Only allow known preference keys
    const allowed = Object.keys(DEFAULT_PREFERENCES);
    const filtered = {};
    for (const [key, value] of Object.entries(updates)) {
      if (allowed.includes(key)) {
        filtered[key] = value;
      }
    }
    await chrome.storage.sync.set(filtered);
    return true;
  } catch (error) {
    console.warn('PhishArmor Storage: Failed to update preferences:', error);
    return false;
  }
}

/**
 * Increment a counter preference (e.g., emailsScannedCount).
 */
async function incrementCounter(key) {
  try {
    const result = await chrome.storage.sync.get([key]);
    const current = result[key] || 0;
    await chrome.storage.sync.set({ [key]: current + 1 });
    return current + 1;
  } catch (error) {
    console.warn('PhishArmor Storage: Failed to increment counter:', error);
    return 0;
  }
}


// ---------------------------------------------------------------------------
// Legacy Migration
// ---------------------------------------------------------------------------

/**
 * Migrate data from the old storage format (v0.1.0) to the new format.
 * Call this once on extension update.
 */
async function migrateLegacyStorage() {
  try {
    const legacy = await chrome.storage.local.get([
      'isLoggedIn', 'userApiKey', 'abuseipdbApiKey',
      'useProVersion', 'blockedUrlsCount',
    ]);

    // Move login state to sync storage
    if (legacy.isLoggedIn !== undefined) {
      await chrome.storage.sync.set({
        isLoggedIn: false,  // Force re-login with new Supabase auth
      });
    }

    // Clean up old API key storage (security!)
    const keysToRemove = [
      'userApiKey', 'abuseipdbApiKey', 'useProVersion',
      'phishArmorProKey',
    ];
    await chrome.storage.local.remove(keysToRemove);

    // Migrate scan count
    if (legacy.blockedUrlsCount) {
      await chrome.storage.sync.set({
        flaggedEmailsCount: legacy.blockedUrlsCount,
      });
    }

    // Clean up old emailScore_ entries
    const allData = await chrome.storage.local.get(null);
    const oldScoreKeys = Object.keys(allData).filter(k => k.startsWith('emailScore_'));
    if (oldScoreKeys.length > 0) {
      await chrome.storage.local.remove(oldScoreKeys);
    }

    console.log('PhishArmor Storage: Legacy migration complete');
  } catch (error) {
    console.warn('PhishArmor Storage: Legacy migration failed:', error);
  }
}


// ---------------------------------------------------------------------------
// Cache Cleanup Alarm
// ---------------------------------------------------------------------------

// Set up periodic cache cleanup (every 30 minutes)
chrome.alarms.create('phisharmor-cache-cleanup', {
  periodInMinutes: 30,
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'phisharmor-cache-cleanup') {
    cleanExpiredCache();
  }
});


// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof globalThis !== 'undefined') {
  globalThis.PhishArmorStorage = {
    cacheAnalysisResult,
    getCachedResult,
    clearCache,
    cleanExpiredCache,
    getPreferences,
    updatePreferences,
    incrementCounter,
    migrateLegacyStorage,
    CACHE_TTL_MS,
  };
}
