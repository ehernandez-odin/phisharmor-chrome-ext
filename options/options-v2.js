/**
 * PhishArmor Options Page v2.0
 *
 * User preferences only — no API key management.
 * Settings sync to backend for authenticated users.
 */

/**
 * Load tier information and update UI for premium features
 */
async function loadTierAndUpdateUI() {
    try {
        const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'getTierInfo' }, resolve);
        });

        if (!response || !response.success || !response.tierInfo) return;

        const tierInfo = response.tierInfo;
        const autoAnalyzeCheckbox = document.getElementById('auto-analyze');
        const lockNotice = document.getElementById('auto-analyze-lock');

        // Lock auto-analyze for free users
        if (tierInfo.tier === 'free') {
            if (autoAnalyzeCheckbox) {
                autoAnalyzeCheckbox.disabled = true;
                autoAnalyzeCheckbox.checked = false;
                autoAnalyzeCheckbox.style.opacity = '0.5';
                autoAnalyzeCheckbox.style.cursor = 'not-allowed';
            }
            // Also disable the label
            const label = autoAnalyzeCheckbox?.closest('label') || autoAnalyzeCheckbox?.parentElement;
            if (label) label.style.opacity = '0.6';

            if (lockNotice) lockNotice.style.display = 'block';
        } else {
            if (autoAnalyzeCheckbox) {
                autoAnalyzeCheckbox.disabled = false;
                autoAnalyzeCheckbox.style.opacity = '1';
                autoAnalyzeCheckbox.style.cursor = 'pointer';
            }
            if (lockNotice) lockNotice.style.display = 'none';
        }

        // Update account section
        const tierEl = document.getElementById('account-tier');
        const scansEl = document.getElementById('account-scans');
        const trialEl = document.getElementById('account-trial');

        if (tierEl) {
            const tierLabels = {
                'free': 'Free Plan — $0/forever',
                'trial': 'Premium Trial — $4.99/mo after trial',
                'premium': 'Premium Plan — $4.99/mo'
            };
            tierEl.textContent = `Plan: ${tierLabels[tierInfo.tier] || 'Free Plan'}`;
        }

        if (scansEl) {
            scansEl.textContent = `Daily scans: ${tierInfo.daily_scans_used || 0} of ${tierInfo.daily_scan_limit || 5} used today`;
        }

        if (trialEl && tierInfo.tier === 'trial') {
            trialEl.textContent = `Trial ends in ${tierInfo.trial_days_remaining || 0} days`;
            trialEl.style.display = 'block';
        } else if (trialEl) {
            trialEl.style.display = 'none';
        }

        // Update the existing plan display if there is one
        const planEl = document.getElementById('account-plan');
        if (planEl) {
            const used = tierInfo.daily_scans_used || 0;
            const limit = tierInfo.daily_scan_limit || 5;
            planEl.textContent = `Plan: ${tierInfo.tier === 'premium' ? 'Premium' : tierInfo.tier === 'trial' ? 'Premium Trial' : 'Free'} (${limit - used} scans remaining today)`;
        }
    } catch (e) {
        console.error('PhishArmor: Error loading tier info for options:', e);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Load current settings
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

  // Set checkboxes
  document.getElementById('show-notifications').checked = prefs.showNotifications;
  document.getElementById('auto-analyze').checked = prefs.autoAnalyze;

  // Load tier info and update UI
  await loadTierAndUpdateUI();

  // Show account status
  const accountStatus = document.getElementById('account-status');
  if (prefs.isLoggedIn && prefs.userEmail) {
    accountStatus.textContent = `Logged in as ${prefs.userEmail}`;

    // Try to get plan info from backend
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getSettings' }, resolve);
      });
      if (response.success && response.settings?.plan) {
        const planEl = document.getElementById('account-plan');
        planEl.textContent = `Plan: ${response.settings.plan} (${response.settings.credits_remaining || 0} credits remaining)`;
        planEl.style.display = 'block';
      }
    } catch (e) {
      // Not critical
    }
  } else {
    accountStatus.textContent = 'Not logged in. Open the extension popup to sign in.';
  }

  // Auto-analyze checkbox change handler
  const autoAnalyzeCheckbox = document.getElementById('auto-analyze');
  if (autoAnalyzeCheckbox) {
    autoAnalyzeCheckbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        // Check if user is on free tier
        chrome.runtime.sendMessage({ action: 'getTierInfo' }, (response) => {
          if (response?.tierInfo?.tier === 'free') {
            e.target.checked = false;
            // Show upgrade prompt
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

  // Save handler
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

    // Sync to backend
    try {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'updateSettings', settings }, resolve);
      });
    } catch (e) {
      // Local save succeeded, backend sync is best-effort
    }

    // Show success
    const status = document.getElementById('statusMessage');
    status.textContent = 'Settings saved!';
    status.style.color = '#22c55e';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});
