/**
 * PhishArmor Options Page v2.0
 *
 * User preferences only — no API key management.
 * Settings sync to backend for authenticated users.
 */

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
