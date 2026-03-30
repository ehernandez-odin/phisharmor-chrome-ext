/**
 * PhishArmor Gmail API Client
 *
 * Fetches email data via the Gmail API using the Google provider token
 * obtained through Supabase OAuth (with gmail.readonly scope).
 *
 * This replaces DOM scraping in the content script with clean, structured
 * API calls — better for privacy, reliability, and phishing detection
 * (we now get email authentication headers like SPF/DKIM/DMARC).
 */

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GMAIL_API_TIMEOUT = 10000; // 10 seconds

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch a single email message by ID and return structured data
 * ready for the PhishArmor backend.
 *
 * @param {string} messageId - Gmail message ID (from data-legacy-message-id or URL hash)
 * @returns {Object} Parsed email data with headers, body, URLs, and auth info
 * @throws {Error} If token is missing, expired, or API call fails
 */
async function fetchEmailById(messageId) {
  const token = await globalThis.PhishArmorAuth.getGoogleAccessToken();
  if (!token) {
    throw new GmailApiError(
      'No Google access token available. Please sign in again to grant Gmail access.',
      'NO_TOKEN'
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GMAIL_API_TIMEOUT);

  try {
    const response = await fetch(
      `${GMAIL_API_BASE}/messages/${messageId}?format=full`,
      {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (response.status === 401) {
      throw new GmailApiError(
        'Google access token expired. Please sign in again.',
        'TOKEN_EXPIRED'
      );
    }

    if (response.status === 404) {
      throw new GmailApiError(
        `Email message not found: ${messageId}`,
        'NOT_FOUND'
      );
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new GmailApiError(
        `Gmail API error: ${response.status} ${response.statusText} — ${errBody}`,
        'API_ERROR'
      );
    }

    const message = await response.json();
    return parseGmailMessage(message);

  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof GmailApiError) throw error;

    if (error.name === 'AbortError') {
      throw new GmailApiError('Gmail API request timed out', 'TIMEOUT');
    }

    throw new GmailApiError(
      `Network error fetching email: ${error.message}`,
      'NETWORK_ERROR'
    );
  }
}


// ---------------------------------------------------------------------------
// Gmail Message Parser
// ---------------------------------------------------------------------------

/**
 * Parse a Gmail API message response into the format expected by our backend.
 *
 * @param {Object} message - Raw Gmail API message object (format=full)
 * @returns {Object} Structured email data for analysis
 */
function parseGmailMessage(message) {
  const headers = extractHeaders(message.payload);

  // Extract body content from MIME parts
  const { textBody, htmlBody } = extractBody(message.payload);

  // Extract all URLs from both text and HTML bodies
  const urls = extractUrls(textBody, htmlBody);

  // Extract email authentication headers (phishing signals not available via DOM)
  const emailHeaders = extractAuthHeaders(headers);

  // Detect Reply-To mismatch (common phishing pattern)
  const fromDomain = extractDomain(headers['from'] || '');
  const replyToDomain = headers['reply-to'] ? extractDomain(headers['reply-to']) : null;
  emailHeaders.replyToMismatch = !!(replyToDomain && fromDomain && replyToDomain !== fromDomain);
  emailHeaders.replyTo = headers['reply-to'] || null;

  return {
    id: message.id,
    threadId: message.threadId,
    sender: headers['from'] || 'Unknown Sender',
    replyTo: headers['reply-to'] || null,
    subject: headers['subject'] || 'No Subject',
    to: headers['to'] || '',
    cc: headers['cc'] || '',
    date: headers['date'] || '',
    bodyText: textBody.substring(0, 8000),    // Match existing limits
    bodyHtml: htmlBody.substring(0, 15000),   // Match existing limits
    urls: urls.slice(0, 20),                  // Match existing limit
    emailHeaders: emailHeaders,
    // Metadata
    labelIds: message.labelIds || [],
    snippet: message.snippet || '',
    internalDate: message.internalDate || null,
  };
}

/**
 * Extract headers into a lowercase-keyed map for easy lookup.
 */
function extractHeaders(payload) {
  const headers = {};
  if (payload && payload.headers) {
    for (const header of payload.headers) {
      // Use lowercase keys; keep first occurrence for most headers
      const key = header.name.toLowerCase();
      if (!headers[key]) {
        headers[key] = header.value;
      } else if (key === 'received') {
        // Accumulate all Received headers (useful for routing analysis)
        headers[key] += '\n' + header.value;
      }
    }
  }
  return headers;
}


// ---------------------------------------------------------------------------
// MIME Body Extraction
// ---------------------------------------------------------------------------

/**
 * Recursively extract text/plain and text/html bodies from MIME parts.
 * Handles nested multipart structures (multipart/mixed, multipart/alternative, etc.)
 *
 * @param {Object} payload - Gmail API message payload
 * @returns {{ textBody: string, htmlBody: string }}
 */
function extractBody(payload) {
  let textBody = '';
  let htmlBody = '';

  if (!payload) return { textBody, htmlBody };

  // Single-part message: body data directly on payload
  if (payload.body && payload.body.data) {
    const decoded = base64UrlDecode(payload.body.data);
    if (payload.mimeType === 'text/plain') {
      textBody = decoded;
    } else if (payload.mimeType === 'text/html') {
      htmlBody = decoded;
    }
  }

  // Multi-part message: recurse into parts
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body && part.body.data) {
        textBody += base64UrlDecode(part.body.data);
      } else if (part.mimeType === 'text/html' && part.body && part.body.data) {
        htmlBody += base64UrlDecode(part.body.data);
      } else if (part.mimeType && part.mimeType.startsWith('multipart/') && part.parts) {
        // Nested multipart (e.g., multipart/alternative inside multipart/mixed)
        const nested = extractBody(part);
        if (nested.textBody) textBody += nested.textBody;
        if (nested.htmlBody) htmlBody += nested.htmlBody;
      }
      // Skip attachments (application/*, image/*, etc.)
    }
  }

  return { textBody, htmlBody };
}

/**
 * Decode a base64url-encoded string (Gmail API's encoding format).
 * Properly handles UTF-8 content.
 *
 * @param {string} encoded - Base64url-encoded string
 * @returns {string} Decoded UTF-8 string
 */
function base64UrlDecode(encoded) {
  // Convert base64url to standard base64
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  try {
    // Decode base64 to bytes, then UTF-8 decode
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    // Fallback for simple ASCII content
    try {
      return atob(base64);
    } catch (e2) {
      console.warn('PhishArmor Gmail API: Failed to decode base64 content:', e2);
      return '';
    }
  }
}


// ---------------------------------------------------------------------------
// Email Authentication Header Extraction
// ---------------------------------------------------------------------------

/**
 * Extract email authentication headers that are valuable for phishing detection.
 * These headers are NOT available via DOM scraping — a key advantage of the Gmail API.
 *
 * @param {Object} headers - Lowercase-keyed header map
 * @returns {Object} Authentication header analysis
 */
function extractAuthHeaders(headers) {
  const authResults = headers['authentication-results'] || '';

  return {
    // SPF (Sender Policy Framework) — verifies sender IP is authorized
    spf: extractAuthResult(authResults, 'spf'),
    receivedSpf: headers['received-spf'] || null,

    // DKIM (DomainKeys Identified Mail) — verifies email signature
    dkim: extractAuthResult(authResults, 'dkim'),
    dkimSignaturePresent: !!headers['dkim-signature'],

    // DMARC (Domain-based Message Authentication) — policy alignment
    dmarc: extractAuthResult(authResults, 'dmarc'),

    // Full authentication-results header for backend analysis
    authenticationResults: authResults || null,

    // Return-Path mismatch detection
    returnPath: headers['return-path'] || null,

    // X-headers that may indicate spam/phishing
    xSpamStatus: headers['x-spam-status'] || null,
    xSpamScore: headers['x-spam-score'] || null,
  };
}

/**
 * Extract a specific authentication result (spf, dkim, dmarc) from
 * the Authentication-Results header.
 *
 * @param {string} authResults - The authentication-results header value
 * @param {string} mechanism - 'spf', 'dkim', or 'dmarc'
 * @returns {string|null} Result like 'pass', 'fail', 'softfail', 'none', or null
 */
function extractAuthResult(authResults, mechanism) {
  if (!authResults) return null;
  // Match patterns like "spf=pass", "dkim=fail", "dmarc=none"
  const regex = new RegExp(`${mechanism}=([a-zA-Z]+)`, 'i');
  const match = authResults.match(regex);
  return match ? match[1].toLowerCase() : null;
}


// ---------------------------------------------------------------------------
// URL Extraction
// ---------------------------------------------------------------------------

/**
 * Extract unique URLs from email text and HTML bodies.
 *
 * @param {string} textBody - Plain text body
 * @param {string} htmlBody - HTML body
 * @returns {string[]} Deduplicated array of URLs
 */
function extractUrls(textBody, htmlBody) {
  const urlSet = new Set();

  // Extract from plain text
  const textUrls = (textBody || '').match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  textUrls.forEach(url => urlSet.add(normalizeUrl(url)));

  // Extract href values from HTML (more reliable than regex on raw HTML)
  const hrefUrls = (htmlBody || '').match(/href=["']?(https?:\/\/[^"'\s>]+)/gi) || [];
  hrefUrls.forEach(match => {
    const url = match.replace(/^href=["']?/i, '');
    urlSet.add(normalizeUrl(url));
  });

  return [...urlSet];
}

/**
 * Normalize a URL by removing trailing punctuation and fragments.
 */
function normalizeUrl(url) {
  // Remove trailing punctuation that's likely not part of the URL
  return url.replace(/[.,;:!?)}\]]+$/, '');
}


// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Extract domain from an email address string.
 * Handles formats like "Name <user@domain.com>" and plain "user@domain.com".
 */
function extractDomain(emailStr) {
  const match = emailStr.match(/@([^\s>,]+)/);
  return match ? match[1].toLowerCase().replace(/[>)]+$/, '') : '';
}


// ---------------------------------------------------------------------------
// Custom Error Class
// ---------------------------------------------------------------------------

/**
 * Custom error for Gmail API failures with an error code for handling.
 */
class GmailApiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'GmailApiError';
    this.code = code; // NO_TOKEN, TOKEN_EXPIRED, NOT_FOUND, API_ERROR, TIMEOUT, NETWORK_ERROR
  }

  get isTokenError() {
    return this.code === 'NO_TOKEN' || this.code === 'TOKEN_EXPIRED';
  }

  get isNetworkError() {
    return this.code === 'NETWORK_ERROR' || this.code === 'TIMEOUT';
  }
}


// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof globalThis !== 'undefined') {
  globalThis.PhishArmorGmailAPI = {
    fetchEmailById,
    parseGmailMessage,
    GmailApiError,
  };
}
