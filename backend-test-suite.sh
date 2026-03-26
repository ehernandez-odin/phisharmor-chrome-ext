#!/bin/bash
# =============================================================================
# PhishArmor Backend API - Comprehensive Test Suite
# =============================================================================
# Tests all known endpoints on the deployed DigitalOcean backend.
# Usage: chmod +x backend-test-suite.sh && ./backend-test-suite.sh
# =============================================================================

BASE_URL="https://phisharmor-backend-bd392.ondigitalocean.app"

PASS=0
FAIL=0
WARN=0

pass() { ((PASS++)); echo "  ✅ PASS: $1"; }
fail() { ((FAIL++)); echo "  ❌ FAIL: $1"; }
warn() { ((WARN++)); echo "  ⚠️  WARN: $1"; }

check_status() {
  local response="$1"
  local field="$2"
  local expected="$3"
  local label="$4"
  local actual=$(echo "$response" | jq -r "$field" 2>/dev/null)
  if [ "$actual" = "$expected" ]; then
    pass "$label (got: $actual)"
  else
    fail "$label (expected: $expected, got: $actual)"
  fi
}

check_field_exists() {
  local response="$1"
  local field="$2"
  local label="$3"
  local val=$(echo "$response" | jq -r "$field" 2>/dev/null)
  if [ "$val" != "null" ] && [ -n "$val" ]; then
    pass "$label (value: $val)"
  else
    fail "$label (field missing or null)"
  fi
}

echo "=============================================="
echo " PhishArmor Backend - Comprehensive Test Suite"
echo " Base URL: $BASE_URL"
echo " Date: $(date)"
echo "=============================================="
echo

# -----------------------------------------------
# 1. HEALTH CHECK
# -----------------------------------------------
echo "━━━ 1. Health Check ━━━"
HEALTH=$(curl -s "$BASE_URL/health")
check_status "$HEALTH" ".status" "healthy" "Health status"
check_field_exists "$HEALTH" ".version" "Version present"
check_field_exists "$HEALTH" ".environment" "Environment field"
check_field_exists "$HEALTH" ".uptime_seconds" "Uptime tracking"

# Check service configurations
check_status "$HEALTH" '.services.openai_configured' "true" "OpenAI configured"
check_status "$HEALTH" '.services.apivoid_url_configured' "true" "APIVoid URL configured"
check_status "$HEALTH" '.services.apivoid_domain_configured' "true" "APIVoid Domain configured"

# Check Google Web Risk (expected to be missing based on prior analysis)
WEB_RISK=$(echo "$HEALTH" | jq -r '.services.webrisk_configured // .services.google_webrisk_configured // "not_found"')
if [ "$WEB_RISK" = "true" ]; then
  pass "Google Web Risk configured"
else
  warn "Google Web Risk NOT configured (URL checks rely solely on APIVoid)"
fi
echo

# -----------------------------------------------
# 2. SERVICE HEALTH CHECKS
# -----------------------------------------------
echo "━━━ 2. Service Health Checks ━━━"

OPENAI_HEALTH=$(curl -s "$BASE_URL/api/openai/health")
check_status "$OPENAI_HEALTH" ".status" "healthy" "OpenAI service health"
check_field_exists "$OPENAI_HEALTH" ".latency_ms" "OpenAI latency"
check_field_exists "$OPENAI_HEALTH" ".model" "OpenAI model"
OPENAI_MODEL=$(echo "$OPENAI_HEALTH" | jq -r '.model')
echo "  📋 OpenAI model: $OPENAI_MODEL"

APIVOID_HEALTH=$(curl -s "$BASE_URL/api/apivoid/health")
check_status "$APIVOID_HEALTH" ".status" "healthy" "APIVoid service health"
check_field_exists "$APIVOID_HEALTH" ".latency_ms" "APIVoid latency"
echo

# -----------------------------------------------
# 3. SINGLE URL REPUTATION
# -----------------------------------------------
echo "━━━ 3. URL Reputation - Single ━━━"

# Test with known safe URL
URL_RESP=$(curl -s -X POST "$BASE_URL/api/url-reputation" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://google.com"}')
check_status "$URL_RESP" ".is_safe" "true" "google.com is safe"
check_field_exists "$URL_RESP" ".risk_score" "Risk score present"
check_field_exists "$URL_RESP" ".risk_level" "Risk level present"
check_field_exists "$URL_RESP" ".security_checks" "Security checks present"
check_field_exists "$URL_RESP" ".analysis_timestamp" "Timestamp present"
check_field_exists "$URL_RESP" ".processing_time_ms" "Processing time tracked"
RISK_LEVEL=$(echo "$URL_RESP" | jq -r '.risk_level')
echo "  📋 google.com risk level: $RISK_LEVEL"
echo

# -----------------------------------------------
# 4. BATCH URL REPUTATION
# -----------------------------------------------
echo "━━━ 4. URL Reputation - Batch ━━━"

BATCH_URL_RESP=$(curl -s -X POST "$BASE_URL/api/url-reputation/batch" \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://google.com", "https://github.com", "https://microsoft.com"]}')
check_field_exists "$BATCH_URL_RESP" ".total_urls" "Total URLs tracked"
check_field_exists "$BATCH_URL_RESP" ".successful_analyses" "Success count"
TOTAL=$(echo "$BATCH_URL_RESP" | jq -r '.total_urls')
SUCCESS=$(echo "$BATCH_URL_RESP" | jq -r '.successful_analyses')
FAILED=$(echo "$BATCH_URL_RESP" | jq -r '.failed_analyses')
echo "  📋 Batch: $SUCCESS/$TOTAL succeeded, $FAILED failed"
if [ "$SUCCESS" = "$TOTAL" ]; then
  pass "All batch URLs analyzed successfully"
else
  warn "Some batch URLs failed ($FAILED/$TOTAL)"
fi
echo

# -----------------------------------------------
# 5. SINGLE DOMAIN REPUTATION
# -----------------------------------------------
echo "━━━ 5. Domain Reputation - Single ━━━"

DOMAIN_RESP=$(curl -s -X POST "$BASE_URL/api/domain-reputation" \
  -H "Content-Type: application/json" \
  -d '{"domain": "google.com"}')
check_status "$DOMAIN_RESP" ".is_safe" "true" "google.com domain is safe"
check_field_exists "$DOMAIN_RESP" ".risk_score" "Risk score present"
check_field_exists "$DOMAIN_RESP" ".risk_level" "Risk level present"
check_field_exists "$DOMAIN_RESP" ".security_checks" "Security checks present"
check_field_exists "$DOMAIN_RESP" ".blacklist_detections" "Blacklist detections"
check_field_exists "$DOMAIN_RESP" ".domain_age_days" "Domain age"
DOMAIN_AGE=$(echo "$DOMAIN_RESP" | jq -r '.domain_age_days // "N/A"')
echo "  📋 google.com domain age: $DOMAIN_AGE days"
echo

# -----------------------------------------------
# 6. BATCH DOMAIN REPUTATION
# -----------------------------------------------
echo "━━━ 6. Domain Reputation - Batch ━━━"

BATCH_DOMAIN_RESP=$(curl -s -X POST "$BASE_URL/api/domain-reputation/batch" \
  -H "Content-Type: application/json" \
  -d '{"domains": ["google.com", "github.com"]}')
check_field_exists "$BATCH_DOMAIN_RESP" ".total_domains" "Total domains tracked"
TOTAL_D=$(echo "$BATCH_DOMAIN_RESP" | jq -r '.total_domains')
SUCCESS_D=$(echo "$BATCH_DOMAIN_RESP" | jq -r '.successful_analyses')
echo "  📋 Batch domains: $SUCCESS_D/$TOTAL_D succeeded"
echo

# -----------------------------------------------
# 7. EMAIL ANALYSIS (Core Feature)
# -----------------------------------------------
echo "━━━ 7. Email Analysis - Safe Email ━━━"

SAFE_EMAIL=$(curl -s -X POST "$BASE_URL/api/analyze-email" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test-safe-001",
    "sender": "newsletter@google.com",
    "subject": "Your weekly Google Cloud digest",
    "body": "Hi there, here is your weekly summary of Google Cloud updates. Check out the latest features at cloud.google.com. Best regards, Google Cloud Team."
  }')
check_field_exists "$SAFE_EMAIL" ".riskLevel" "Risk level in response"
check_field_exists "$SAFE_EMAIL" ".confidence" "Confidence score"
check_field_exists "$SAFE_EMAIL" ".overallAssessment" "Overall assessment"
check_field_exists "$SAFE_EMAIL" ".reasoning" "Reasoning provided"
SAFE_RISK=$(echo "$SAFE_EMAIL" | jq -r '.riskLevel')
SAFE_CONF=$(echo "$SAFE_EMAIL" | jq -r '.confidence')
echo "  📋 Safe email: risk=$SAFE_RISK, confidence=$SAFE_CONF"

if [ "$SAFE_RISK" = "Looks Safe" ] || [ "$SAFE_RISK" = "low" ]; then
  pass "Safe email correctly classified as low risk"
else
  warn "Safe email classified as: $SAFE_RISK (expected low/Looks Safe)"
fi
echo

echo "━━━ 8. Email Analysis - Suspicious Email ━━━"

PHISH_EMAIL=$(curl -s -X POST "$BASE_URL/api/analyze-email" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test-phish-001",
    "sender": "security@paypa1-alerts.com",
    "subject": "URGENT: Your account has been compromised!",
    "body": "Dear Customer, We detected unusual activity. Your account will be suspended in 24 hours unless you verify immediately. Click here to verify your identity. You must provide your SSN and credit card to complete verification. Act now or lose access permanently."
  }')
check_field_exists "$PHISH_EMAIL" ".riskLevel" "Risk level in response"
check_field_exists "$PHISH_EMAIL" ".confidence" "Confidence score"
check_field_exists "$PHISH_EMAIL" ".urgentLanguageAI" "Urgent language detection"
check_field_exists "$PHISH_EMAIL" ".requestsSensitiveInfoAI" "Sensitive info detection"
PHISH_RISK=$(echo "$PHISH_EMAIL" | jq -r '.riskLevel')
PHISH_CONF=$(echo "$PHISH_EMAIL" | jq -r '.confidence')
URGENT=$(echo "$PHISH_EMAIL" | jq -r '.urgentLanguageAI')
SENSITIVE=$(echo "$PHISH_EMAIL" | jq -r '.requestsSensitiveInfoAI')
echo "  📋 Phish email: risk=$PHISH_RISK, confidence=$PHISH_CONF"
echo "  📋 Urgent language detected: $URGENT"
echo "  📋 Sensitive info request detected: $SENSITIVE"

if [ "$PHISH_RISK" != "Looks Safe" ] && [ "$PHISH_RISK" != "low" ]; then
  pass "Suspicious email correctly flagged (risk: $PHISH_RISK)"
else
  fail "Suspicious email NOT flagged (risk: $PHISH_RISK)"
fi
echo

# -----------------------------------------------
# 9. ERROR HANDLING
# -----------------------------------------------
echo "━━━ 9. Error Handling ━━━"

# Missing required field
ERR_RESP=$(curl -s -X POST "$BASE_URL/api/analyze-email" \
  -H "Content-Type: application/json" \
  -d '{"id": "test", "sender": "test@test.com"}')
ERR_TYPE=$(echo "$ERR_RESP" | jq -r '.detail[0].type // .error // "unknown"')
if [ "$ERR_TYPE" != "unknown" ]; then
  pass "Missing field returns proper validation error (type: $ERR_TYPE)"
else
  fail "Missing field error handling unclear"
fi

# Invalid JSON
ERR_JSON=$(curl -s -X POST "$BASE_URL/api/analyze-email" \
  -H "Content-Type: application/json" \
  -d 'not json')
ERR_JSON_TYPE=$(echo "$ERR_JSON" | jq -r '.detail[0].type // .detail // "unknown"')
if [ "$ERR_JSON_TYPE" != "unknown" ]; then
  pass "Invalid JSON returns error"
else
  fail "Invalid JSON not properly handled"
fi

# 404 for unknown endpoint
ERR_404=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/nonexistent")
if [ "$ERR_404" = "404" ]; then
  pass "Unknown endpoint returns 404"
else
  fail "Unknown endpoint returns $ERR_404 (expected 404)"
fi

# Production endpoints blocked
METRICS_RESP=$(curl -s "$BASE_URL/metrics")
METRICS_ERR=$(echo "$METRICS_RESP" | jq -r '.error // "none"')
if [ "$METRICS_ERR" = "Not Found" ]; then
  pass "Metrics endpoint properly blocked in production"
else
  warn "Metrics endpoint accessible in production"
fi
echo

# -----------------------------------------------
# 10. PERFORMANCE BASELINE
# -----------------------------------------------
echo "━━━ 10. Performance Baseline ━━━"

# Health endpoint latency
HEALTH_TIME=$(curl -s -o /dev/null -w "%{time_total}" "$BASE_URL/health")
echo "  📋 Health endpoint: ${HEALTH_TIME}s"

# URL reputation latency
URL_TIME=$(curl -s -o /dev/null -w "%{time_total}" -X POST "$BASE_URL/api/url-reputation" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}')
echo "  📋 URL reputation: ${URL_TIME}s"

# Email analysis latency
EMAIL_TIME=$(curl -s -o /dev/null -w "%{time_total}" -X POST "$BASE_URL/api/analyze-email" \
  -H "Content-Type: application/json" \
  -d '{"id": "perf-test", "sender": "test@test.com", "subject": "Performance test", "body": "Simple test email for performance measurement."}')
echo "  📋 Email analysis: ${EMAIL_TIME}s"
echo

# -----------------------------------------------
# SUMMARY
# -----------------------------------------------
echo "=============================================="
echo " TEST SUMMARY"
echo "=============================================="
echo "  ✅ Passed:   $PASS"
echo "  ❌ Failed:   $FAIL"
echo "  ⚠️  Warnings: $WARN"
echo "=============================================="
TOTAL_TESTS=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
  echo "  🎉 All $TOTAL_TESTS tests passed!"
else
  echo "  ⚠️  $FAIL/$TOTAL_TESTS tests failed"
fi
echo "=============================================="
