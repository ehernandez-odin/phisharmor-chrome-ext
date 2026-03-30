/**
 * PhishArmor Options Page v2.1
 *
 * Modern settings UI with connected account display.
 * Settings sync to backend for authenticated users.
 */

/**
 * Load tier information and update the account + features UI
 */
async function loadTierAndUpdateUI() {
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getTierInfo' }, resolve);
    });

    if (!response || !response.success || !response.tierInfo) return;

    const tierInfo = response.tierInfo;

    // --- Auto-analyze lock for free users ---
    const autoAnalyzeCheckbox = document.getElementById('auto-analyze');
    const lockNotice = document.getElementById('auto-analyze-lock');

    if (tierInfo.tier === 'free') {
      if (autoAnalyzeCheckbox) {
        autoAnalyzeCheckbox.disabled = true;
        autoAnalyzeCheckbox.checked = false;
      }
      if (lockNotice) lockNotice.style.display = 'block';
    } else {
      if (autoAnalyzeCheckbox) autoAnalyzeCheckbox.disabled = false;
      if (lockNotice) lockNotice.style.display = 'none';
    }

    // --- Tier badge ---
    const badgeContainer = document.getElementById('tier-badge-container');
    const badge = document.getElementById('tier-badge');
    if (badgeContainer && badge) {
      badgeContainer.style.display = 'block';
      badge.className = 'tier-badge ' + (tierInfo.tier || 'free');
      const labels = { free: 'Free Plan', trial: 'Premium Trial', premium: 'Premium' };
      badge.textContent = labels[tierInfo.tier] || 'Free Plan';
    }

    // --- Scan usage ---
    const usageSection = document.getElementById('scan-usage-section');
    if (usageSection) {
      usageSection.style.display = 'block';
      const used = tierInfo.daily_scans_used || 0;
      const limit = tierInfo.daily_scan_limit || 5;
      const remaining = Math.max(0, limit - used);
      const pct = Math.min(100, Math.round((used / limit) * 100));

      document.getElementById('scan-usage-label').textContent = `${used} of ${limit} scans used today`;
      document.getElementById('scan-usage-remaining').textContent = `${remaining} remaining`;

      const bar = document.getElementById('scan-bar-fill');
      bar.style.width = `${pct}%`;
      if (pct >= 80) bar.style.background = '#ef4444';
      else if (pct >= 60) bar.style.background = '#f59e0b';
      else bar.style.background = '#3b82f6';
    }

    // --- Trial notice ---
    const trialNotice = document.getElementById('trial-notice');
    if (trialNotice && tierInfo.tier === 'trial') {
      trialNotice.textContent = `Trial ends in ${tierInfo.trial_days_remaining || 0} days`;
      trialNotice.style.display = 'block';
    } else if (trialNotice) {
      trialNotice.style.display = 'none';
    }
  } catch (e) {
    console.error('PhishArmor: Error loading tier info for options:', e);
  }
}

/**
 * Update radio option visual state
 */
function updateRadioVisuals() {
  document.querySelectorAll('.radio-option').forEach(option => {
    const radio = option.querySelector('input[type="radio"]');
    if (radio.checked) {
      option.classList.add('selected');
    } else {
      option.classList.remove('selected');
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // --- Load current settings ---
  const prefs = await chrome.storage.sync.get({
    sensitivityLevel: 'medium',
    showNotifications: true,
    autoAnalyze: true,
    isLoggedIn: false,
    userEmail: null,
  });

  // Set radio buttons
  const sensitivityRadio = document.querySelector(`input[name="sensitivity"][value="${prefs.sensitivityLevel}"]`);
  if (sensitivityRadio) sensitivityRadio.checked = true;
  updateRadioVisuals();

  // Set checkboxes
  document.getElementById('show-notifications').checked = prefs.showNotifications;
  document.getElementById('auto-analyze').checked = prefs.autoAnalyze;

  // --- Radio click handlers for visual state ---
  document.querySelectorAll('.radio-option').forEach(option => {
    option.addEventListener('click', () => {
      const radio = option.querySelector('input[type="radio"]');
      radio.checked = true;
      updateRadioVisuals();
    });
  });

  // --- Account display ---
  const avatarEl = document.getElementById('account-avatar');
  const emailEl = document.getElementById('account-email');
  const notLoggedInEl = document.getElementById('account-not-logged-in');

  if (prefs.isLoggedIn && prefs.userEmail) {
    emailEl.textContent = prefs.userEmail;
    if (notLoggedInEl) notLoggedInEl.style.display = 'none';
    // Set avatar initial
    const initial = prefs.userEmail.charAt(0).toUpperCase();
    if (avatarEl) avatarEl.textContent = initial;
  } else {
    emailEl.textContent = 'Not connected';
    if (avatarEl) {
      avatarEl.textContent = '?';
      avatarEl.style.background = '#94a3b8';
    }
  }

  // --- Load tier info ---
  await loadTierAndUpdateUI();

  // --- Auto-analyze guard for free users ---
  const autoAnalyzeCheckbox = document.getElementById('auto-analyze');
  if (autoAnalyzeCheckbox) {
    autoAnalyzeCheckbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        chrome.runtime.sendMessage({ action: 'getTierInfo' }, (response) => {
          if (response?.tierInfo?.tier === 'free') {
            e.target.checked = false;
            const lockNotice = document.getElementById('auto-analyze-lock');
            if (lockNotice) {
              lockNotice.style.display = 'block';
              lockNotice.style.animation = 'none';
              lockNotice.offsetHeight; // trigger reflow
              lockNotice.style.animation = 'shake 0.3s ease';
            }
          }
        });
      }
    });
  }

  // --- Save handler ---
  document.getElementById('saveSettingsButton').addEventListener('click', async () => {
    const sensitivity = document.querySelector('input[name="sensitivity"]:checked')?.value || 'medium';
    const showNotifications = document.getElementById('show-notifications').checked;
    const autoAnalyze = document.getElementById('auto-analyze').checked;

    const settings = {
      sensitivityLevel: sensitivity,
      showNotifications,
      autoAnalyze,
    };

    // Save locally
    await chrome.storage.sync.set(settings);

    // Sync to backend (best-effort)
    try {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'updateSettings', settings }, resolve);
      });
    } catch (e) {
      // Local save succeeded
    }

    // Show success
    const status = document.getElementById('statusMessage');
    status.textContent = 'Settings saved!';
    status.style.color = '#22c55e';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});
