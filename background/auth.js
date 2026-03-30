/**
 * PhishArmor Auth Module
 *
 * Handles Supabase authentication, token storage (chrome.storage.session),
 * and token refresh flow.
 *
 * Tokens are stored in chrome.storage.session which is:
 * - Cleared when the browser closes (secure)
 * - Accessible from service worker and popup
 * - NOT accessible from content scripts (by design)
 */

// Supabase configuration
// These are public keys — safe to include in the extension
const SUPABASE_URL = 'https://indcrrlvpotinxdhrthg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImluZGNycmx2cG90aW54ZGhydGhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk4NDg2MzcsImV4cCI6MjA2NTQyNDYzN30.9RBDGPfVD1O67vV0xk4sU9ptHgI4rt4M3bi1LNciXC8';

const AUTH_ENDPOINTS = {
  signUp: `${SUPABASE_URL}/auth/v1/signup`,
  signIn: `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
  signInWithOAuth: `${SUPABASE_URL}/auth/v1/authorize`,
  refreshToken: `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
  signOut: `${SUPABASE_URL}/auth/v1/logout`,
  getUser: `${SUPABASE_URL}/auth/v1/user`,
};

// Token refresh interval (refresh 5 minutes before expiry)
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
let refreshTimerId = null;


// ---------------------------------------------------------------------------
// Core Auth Functions
// ---------------------------------------------------------------------------

/**
 * Sign up a new user with email and password.
 */
async function signUp(email, password, fullName = '') {
  try {
    const response = await fetch(AUTH_ENDPOINTS.signUp, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        email,
        password,
        data: { full_name: fullName },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error_description || data.msg || 'Sign up failed');
    }

    // If email confirmation is required, don't store tokens yet
    if (data.confirmation_sent_at && !data.access_token) {
      return {
        success: true,
        needsConfirmation: true,
        message: 'Please check your email to confirm your account.',
      };
    }

    // Store tokens if returned immediately (e.g., email confirmation disabled)
    if (data.access_token) {
      await storeTokens(data);
      scheduleTokenRefresh(data.expires_in);
    }

    return { success: true, user: data.user, needsConfirmation: false };

  } catch (error) {
    console.error('PhishArmor Auth: Sign up error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Sign in with email and password.
 */
async function signIn(email, password) {
  try {
    const response = await fetch(AUTH_ENDPOINTS.signIn, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error_description || data.msg || 'Sign in failed');
    }

    await storeTokens(data);
    scheduleTokenRefresh(data.expires_in);

    return { success: true, user: data.user };

  } catch (error) {
    console.error('PhishArmor Auth: Sign in error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Sign in with Google OAuth using PKCE flow.
 *
 * PKCE (Proof Key for Code Exchange) is required for Chrome extensions because
 * chrome.identity.launchWebAuthFlow doesn't reliably persist cookies across
 * the OAuth redirect chain. Without PKCE, Supabase loses the redirect_to URL
 * (stored in a cookie) and falls back to the Site URL instead of returning
 * tokens to the extension.
 *
 * PKCE flow:
 * 1. Generate code_verifier + code_challenge (URL params, no cookies needed)
 * 2. Supabase redirects back with ?code=xxx (not #access_token)
 * 3. Extension exchanges code + code_verifier for tokens via POST
 */
async function signInWithGoogle() {
  try {
    // 1. Generate PKCE code verifier and challenge
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    console.log('PhishArmor Auth: Starting Google OAuth with PKCE flow');

    // 2. Build the OAuth URL with PKCE params
    const redirectUrl = chrome.identity.getRedirectURL();
    console.log('PhishArmor Auth: Redirect URL:', redirectUrl);

    const authUrl = new URL(AUTH_ENDPOINTS.signInWithOAuth);
    authUrl.searchParams.set('provider', 'google');
    authUrl.searchParams.set('redirect_to', redirectUrl);
    // PKCE parameters — state is carried in URL, not cookies
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    // Request Gmail read-only access for email analysis via Gmail API
    authUrl.searchParams.set('scopes', 'https://www.googleapis.com/auth/gmail.readonly');

    // 3. Launch the OAuth flow
    const responseUrl = await new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        { url: authUrl.toString(), interactive: true },
        (callbackUrl) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(callbackUrl);
          }
        }
      );
    });

    console.log('PhishArmor Auth: OAuth callback received');

    // 4. Extract the authorization code from the callback URL
    //    PKCE returns ?code=xxx in query params (not #access_token in hash)
    const url = new URL(responseUrl);
    const authCode = url.searchParams.get('code');

    // Check for errors in the callback
    const oauthError = url.searchParams.get('error') || new URLSearchParams(url.hash.substring(1)).get('error');
    const oauthErrorDesc = url.searchParams.get('error_description') || new URLSearchParams(url.hash.substring(1)).get('error_description');
    if (oauthError) {
      console.error('PhishArmor Auth: OAuth returned error:', oauthError, oauthErrorDesc);
      throw new Error(oauthErrorDesc || oauthError || 'OAuth authentication failed');
    }

    if (!authCode) {
      // Fallback: check if tokens were returned in hash (implicit flow)
      const hashParams = new URLSearchParams(url.hash.substring(1));
      const fallbackToken = hashParams.get('access_token');
      if (fallbackToken) {
        console.log('PhishArmor Auth: Got implicit flow tokens (fallback)');
        return await handleImplicitTokens(hashParams);
      }
      console.error('PhishArmor Auth: No code or access_token in callback.',
        'Query:', url.search, 'Hash present:', !!url.hash);
      throw new Error('No authorization code received from OAuth flow');
    }

    console.log('PhishArmor Auth: Got authorization code, exchanging for tokens...');

    // 5. Exchange the code + code_verifier for tokens
    const tokenResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        auth_code: authCode,
        code_verifier: codeVerifier,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('PhishArmor Auth: Token exchange failed:', tokenData);
      throw new Error(tokenData.error_description || tokenData.msg || 'Token exchange failed');
    }

    console.log('PhishArmor Auth: Token exchange successful');

    // 6. Store Supabase tokens
    await storeTokens(tokenData);
    scheduleTokenRefresh(tokenData.expires_in || 3600);

    // 7. Store Google provider token for Gmail API calls
    const providerToken = tokenData.provider_token;
    const providerRefreshToken = tokenData.provider_refresh_token;
    if (providerToken) {
      await storeGoogleToken(providerToken, providerRefreshToken);
      console.log('PhishArmor Auth: Google provider token stored for Gmail API access');
    } else {
      console.warn('PhishArmor Auth: No Google provider token received — Gmail API calls may not work');
    }

    // 8. Get user profile and update sync storage
    const user = tokenData.user || await getCurrentUser();
    if (user?.email) {
      await chrome.storage.sync.set({ isLoggedIn: true, userEmail: user.email });
    }
    return { success: true, user };

  } catch (error) {
    console.error('PhishArmor Auth: Google sign in error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Handle implicit flow tokens (fallback if PKCE returns hash tokens).
 */
async function handleImplicitTokens(hashParams) {
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  const expiresIn = parseInt(hashParams.get('expires_in') || '3600');
  const providerToken = hashParams.get('provider_token');
  const providerRefreshToken = hashParams.get('provider_refresh_token');

  await storeTokens({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn,
  });
  scheduleTokenRefresh(expiresIn);

  if (providerToken) {
    await storeGoogleToken(providerToken, providerRefreshToken);
  }

  const user = await getCurrentUser();
  if (user?.email) {
    await chrome.storage.sync.set({ isLoggedIn: true, userEmail: user.email });
  }
  return { success: true, user };
}

// ---------------------------------------------------------------------------
// PKCE Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a random code verifier for PKCE (43-128 chars, URL-safe).
 */
function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Generate the code challenge from a code verifier using SHA-256.
 */
async function generateCodeChallenge(codeVerifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Base64url encode a Uint8Array (RFC 7636 compliant).
 */
function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Sign out the current user.
 */
async function signOut() {
  try {
    const token = await getStoredAccessToken();

    if (token) {
      // Notify Supabase (best effort)
      await fetch(AUTH_ENDPOINTS.signOut, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': SUPABASE_ANON_KEY,
        },
      }).catch(() => {}); // Don't fail if server is unreachable
    }

    // Clear all stored auth data
    await clearTokens();
    cancelTokenRefresh();

    return { success: true };

  } catch (error) {
    console.error('PhishArmor Auth: Sign out error:', error);
    // Clear tokens even if the server call failed
    await clearTokens();
    cancelTokenRefresh();
    return { success: true }; // Still report success since local state is cleared
  }
}

/**
 * Refresh the current access token.
 */
async function refreshAccessToken() {
  try {
    const stored = await chrome.storage.session.get(['refreshToken']);
    if (!stored.refreshToken) {
      console.warn('PhishArmor Auth: No refresh token available');
      await clearTokens();
      return false;
    }

    const response = await fetch(AUTH_ENDPOINTS.refreshToken, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ refresh_token: stored.refreshToken }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('PhishArmor Auth: Token refresh failed:', data);
      await clearTokens();
      return false;
    }

    await storeTokens(data);
    scheduleTokenRefresh(data.expires_in);

    console.log('PhishArmor Auth: Token refreshed successfully');
    return true;

  } catch (error) {
    console.error('PhishArmor Auth: Token refresh error:', error);
    return false;
  }
}

/**
 * Get the current authenticated user from Supabase.
 */
async function getCurrentUser() {
  try {
    const token = await getStoredAccessToken();
    if (!token) return null;

    const response = await fetch(AUTH_ENDPOINTS.getUser, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Try refreshing
        const refreshed = await refreshAccessToken();
        if (refreshed) return getCurrentUser();
        return null;
      }
      return null;
    }

    return await response.json();

  } catch (error) {
    console.error('PhishArmor Auth: Get user error:', error);
    return null;
  }
}

/**
 * Check if user is currently authenticated.
 */
async function isAuthenticated() {
  const token = await getStoredAccessToken();
  if (!token) return false;

  // Check if token is expired
  const stored = await chrome.storage.session.get(['tokenExpiresAt']);
  if (stored.tokenExpiresAt && Date.now() > stored.tokenExpiresAt) {
    // Try to refresh
    return await refreshAccessToken();
  }

  return true;
}


// ---------------------------------------------------------------------------
// Token Storage (chrome.storage.session — cleared on browser close)
// ---------------------------------------------------------------------------

async function storeTokens(data) {
  const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;

  await chrome.storage.session.set({
    authToken: data.access_token,
    refreshToken: data.refresh_token || null,
    tokenExpiresAt: expiresAt,
  });

  // Also update sync storage for popup to know login state
  await chrome.storage.sync.set({
    isLoggedIn: true,
    userEmail: data.user?.email || null,
  });

  console.log('PhishArmor Auth: Tokens stored, expires at', new Date(expiresAt).toISOString());
}

async function getStoredAccessToken() {
  try {
    const result = await chrome.storage.session.get(['authToken']);
    return result.authToken || null;
  } catch (error) {
    return null;
  }
}

/**
 * Store Google provider token for Gmail API access.
 */
async function storeGoogleToken(providerToken, providerRefreshToken) {
  await chrome.storage.session.set({
    googleAccessToken: providerToken,
    googleRefreshToken: providerRefreshToken || null,
  });
  console.log('PhishArmor Auth: Google provider token stored');
}

/**
 * Get the stored Google access token for Gmail API calls.
 * Returns null if no token is available (user needs to re-auth with Gmail scope).
 */
async function getGoogleAccessToken() {
  try {
    const result = await chrome.storage.session.get(['googleAccessToken']);
    return result.googleAccessToken || null;
  } catch (error) {
    return null;
  }
}

/**
 * Check if the user has Gmail API access (Google provider token stored).
 */
async function hasGmailAccess() {
  const token = await getGoogleAccessToken();
  return token !== null;
}

async function clearTokens() {
  await chrome.storage.session.remove([
    'authToken', 'refreshToken', 'tokenExpiresAt',
    'googleAccessToken', 'googleRefreshToken',
  ]);
  await chrome.storage.sync.set({ isLoggedIn: false, userEmail: null });
  console.log('PhishArmor Auth: All tokens cleared (Supabase + Google)');
}


// ---------------------------------------------------------------------------
// Token Refresh Scheduling
// ---------------------------------------------------------------------------

function scheduleTokenRefresh(expiresInSeconds) {
  cancelTokenRefresh();

  const refreshInMs = Math.max(
    (expiresInSeconds * 1000) - REFRESH_BUFFER_MS,
    60000 // Minimum 1 minute
  );

  // Use chrome.alarms for MV3 service worker reliability
  chrome.alarms.create('phisharmor-token-refresh', {
    delayInMinutes: refreshInMs / 60000,
  });

  console.log(`PhishArmor Auth: Token refresh scheduled in ${Math.round(refreshInMs / 60000)} minutes`);
}

function cancelTokenRefresh() {
  chrome.alarms.clear('phisharmor-token-refresh');
}

// Listen for the alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'phisharmor-token-refresh') {
    console.log('PhishArmor Auth: Refreshing token via alarm');
    refreshAccessToken();
  }
});


// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof globalThis !== 'undefined') {
  globalThis.PhishArmorAuth = {
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    refreshAccessToken,
    getCurrentUser,
    isAuthenticated,
    getStoredAccessToken,
    getGoogleAccessToken,
    hasGmailAccess,
    SUPABASE_URL,
  };
}
