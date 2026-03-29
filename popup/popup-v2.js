/**
 * PhishArmor Popup v2.0
 *
 * Real authentication via Supabase (email/password + Google OAuth).
 * Stats fetched from the backend API.
 * No hardcoded API keys or mock auth flows.
 */

class PopupManager {
  constructor() {
    this.currentView = 'loading-view';
    this.init();
  }

  async init() {
    try {
      this.setupEventListeners();
      await this.checkAuthStatus();
    } catch (error) {
      this.handleError('Failed to initialize', error);
      this.showView('logged-out-view');
    }
  }

  // -----------------------------------------------------------------------
  // Event Listeners
  // -----------------------------------------------------------------------

  setupEventListeners() {
    // Login form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    }

    // Google login
    const googleBtn = document.getElementById('google-login-button');
    if (googleBtn) {
      googleBtn.addEventListener('click', () => this.handleGoogleLogin());
    }

    // Signup form
    const signupForm = document.getElementById('signup-form');
    if (signupForm) {
      signupForm.addEventListener('submit', (e) => this.handleSignUp(e));
    }

    // Navigation links
    const signupLink = document.getElementById('signup-link');
    if (signupLink) {
      signupLink.addEventListener('click', (e) => {
        e.preventDefault();
        this.showView('signup-view');
      });
    }

    const backToLogin = document.getElementById('back-to-login-link');
    if (backToLogin) {
      backToLogin.addEventListener('click', (e) => {
        e.preventDefault();
        this.showView('logged-out-view');
      });
    }

    // Dashboard buttons
    const flaggedBtn = document.getElementById('flagged-emails-button');
    if (flaggedBtn) {
      flaggedBtn.addEventListener('click', () => this.handleViewFlaggedEmails());
    }

    const settingsBtn = document.getElementById('settings-button');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
      });
    }

    const logoutBtn = document.getElementById('logout-button');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.handleLogout());
    }

    // Upgrade button (free users - start trial)
    const upgradeBtn = document.getElementById('btn-upgrade');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', async () => {
        const btn = document.getElementById('btn-upgrade');
        btn.disabled = true;
        btn.textContent = 'Starting trial...';
        try {
          const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'startTrial' }, resolve);
          });
          if (response && response.success) {
            await this.loadTierInfo(); // Refresh tier display
          } else {
            // If trial already used, redirect to pricing
            window.open('https://phisharmor.com/pricing', '_blank');
          }
        } catch (e) {
          window.open('https://phisharmor.com/pricing', '_blank');
        }
        btn.disabled = false;
        btn.textContent = 'Try Premium Free — 7 Days';
      });
    }

    // Subscribe button (trial users)
    const subscribeBtn = document.getElementById('btn-subscribe');
    if (subscribeBtn) {
      subscribeBtn.addEventListener('click', () => {
        window.open('https://phisharmor.com/pricing', '_blank');
      });
    }

    // Escape to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') window.close();
    });
  }

  // -----------------------------------------------------------------------
  // Auth Status Check
  // -----------------------------------------------------------------------

  async checkAuthStatus() {
    this.showView('loading-view');

    const response = await this.sendMessage({ action: 'checkAuth' });

    if (response.isAuthenticated) {
      await this.loadDashboard(response.user);
      this.showView('logged-in-view');
    } else {
      this.showView('logged-out-view');
    }
  }

  // -----------------------------------------------------------------------
  // Login
  // -----------------------------------------------------------------------

  async handleLogin(event) {
    event.preventDefault();
    this.clearErrors();

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
      this.showError('login-error', 'Please enter email and password.');
      return;
    }

    const button = document.getElementById('login-button');
    this.setButtonLoading(button, true);

    try {
      const response = await this.sendMessage({
        action: 'authenticate',
        type: 'email',
        email,
        password,
      });

      if (response.success) {
        await this.loadDashboard(response.user);
        this.showView('logged-in-view');
      } else {
        this.showError('login-error', response.error || 'Login failed. Please check your credentials.');
      }
    } catch (error) {
      this.showError('login-error', 'Unable to connect. Please try again.');
    } finally {
      this.setButtonLoading(button, false);
    }
  }

  async handleGoogleLogin() {
    const button = document.getElementById('google-login-button');
    this.setButtonLoading(button, true);
    this.clearErrors();

    try {
      const response = await this.sendMessage({
        action: 'authenticate',
        type: 'google',
      });

      if (response.success) {
        await this.loadDashboard(response.user);
        this.showView('logged-in-view');
      } else {
        this.showError('login-error', response.error || 'Google sign-in failed.');
      }
    } catch (error) {
      this.showError('login-error', 'Google sign-in failed. Please try again.');
    } finally {
      this.setButtonLoading(button, false);
    }
  }

  // -----------------------------------------------------------------------
  // Sign Up
  // -----------------------------------------------------------------------

  async handleSignUp(event) {
    event.preventDefault();
    this.clearErrors();

    const fullName = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;

    if (!email || !password) {
      this.showError('signup-error', 'Email and password are required.');
      return;
    }

    if (password.length < 8) {
      this.showError('signup-error', 'Password must be at least 8 characters.');
      return;
    }

    const button = document.getElementById('signup-button');
    this.setButtonLoading(button, true);

    try {
      const response = await this.sendMessage({
        action: 'signUp',
        email,
        password,
        fullName,
      });

      if (response.success) {
        if (response.needsConfirmation) {
          this.showSuccess('signup-success', 'Account created! Check your email to confirm, then log in.');
        } else {
          await this.loadDashboard(response.user);
          this.showView('logged-in-view');
        }
      } else {
        this.showError('signup-error', response.error || 'Sign up failed.');
      }
    } catch (error) {
      this.showError('signup-error', 'Unable to create account. Please try again.');
    } finally {
      this.setButtonLoading(button, false);
    }
  }

  // -----------------------------------------------------------------------
  // Logout
  // -----------------------------------------------------------------------

  async handleLogout() {
    const button = document.getElementById('logout-button');
    this.setButtonLoading(button, true);

    try {
      await this.sendMessage({ action: 'logout' });
      this.showView('logged-out-view');
    } catch (error) {
      this.handleError('Logout failed', error);
    } finally {
      this.setButtonLoading(button, false);
    }
  }

  // -----------------------------------------------------------------------
  // Dashboard
  // -----------------------------------------------------------------------

  async loadDashboard(user) {
    // Show user email
    const emailDisplay = document.getElementById('user-email-display');
    if (emailDisplay && user?.email) {
      emailDisplay.textContent = user.email;
      emailDisplay.style.display = 'block';
    }

    // Fetch stats from backend
    try {
      const response = await this.sendMessage({ action: 'getUserStats' });
      if (response.success && response.userStats) {
        this.updateStats(response.userStats);
      }
    } catch (error) {
      console.warn('Failed to load stats:', error);
    }

    // Load tier information
    await this.loadTierInfo();
  }

  async loadTierInfo() {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getTierInfo' }, resolve);
      });

      if (!response || !response.success) return;

      const tierInfo = response.tierInfo;
      const tierSection = document.getElementById('tier-section');
      const tierFree = document.getElementById('tier-free');
      const tierTrial = document.getElementById('tier-trial');
      const tierPremium = document.getElementById('tier-premium');

      // Hide all tiers first
      tierFree.style.display = 'none';
      tierTrial.style.display = 'none';
      tierPremium.style.display = 'none';

      tierSection.style.display = 'block';

      const used = tierInfo.daily_scans_used || 0;
      const limit = tierInfo.daily_scan_limit || 5;
      const pct = Math.min(100, Math.round((used / limit) * 100));

      if (tierInfo.tier === 'free') {
        tierFree.style.display = 'block';
        tierSection.style.background = '#f8fafc';
        tierSection.style.border = '1px solid #e2e8f0';
        document.getElementById('scan-count-text').textContent = `${used} of ${limit} scans used today`;
        document.getElementById('scan-progress-bar').style.width = `${pct}%`;
        // Change bar color when near limit
        if (pct >= 80) document.getElementById('scan-progress-bar').style.background = '#ef4444';
        else if (pct >= 60) document.getElementById('scan-progress-bar').style.background = '#f59e0b';
      } else if (tierInfo.tier === 'trial') {
        tierTrial.style.display = 'block';
        tierSection.style.background = '#f0f9ff';
        tierSection.style.border = '1px solid #bae6fd';
        document.getElementById('trial-days-text').textContent = `${tierInfo.trial_days_remaining || 0} days remaining`;
        document.getElementById('trial-scan-count').textContent = `${used} of ${limit} scans used today`;
        document.getElementById('trial-progress-bar').style.width = `${pct}%`;
      } else if (tierInfo.tier === 'premium') {
        tierPremium.style.display = 'block';
        tierSection.style.background = '#f0fdf4';
        tierSection.style.border = '1px solid #bbf7d0';
        document.getElementById('premium-scan-count').textContent = `${used} of ${limit} scans used today`;
        document.getElementById('premium-progress-bar').style.width = `${pct}%`;
      }
    } catch (e) {
      console.error('PhishArmor: Error loading tier info:', e);
    }
  }

  updateStats(stats) {
    const score = document.getElementById('current-score');
    const blocked = document.getElementById('blocked-urls-count');
    const scanned = document.getElementById('emails-scanned');
    const explanation = document.getElementById('score-explanation');

    if (score) score.textContent = stats.securityScore || 'N/A';
    if (blocked) blocked.textContent = stats.blockedUrls || '0';
    if (scanned) scanned.textContent = stats.emailsScanned || '0';
    if (explanation) explanation.textContent = stats.explanation || 'Open an email to start scanning.';
  }

  async handleViewFlaggedEmails() {
    try {
      await this.sendMessage({ action: 'openFlaggedEmails' });
      // TODO: Open dashboard URL when Phase 4 is built
    } catch (error) {
      this.handleError('Could not load flagged emails', error);
    }
  }

  // -----------------------------------------------------------------------
  // UI Helpers
  // -----------------------------------------------------------------------

  showView(viewId) {
    const views = ['logged-out-view', 'logged-in-view', 'loading-view', 'signup-view'];
    views.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = id === viewId ? 'flex' : 'none';
    });
    this.currentView = viewId;
  }

  showError(elementId, message) {
    const el = document.getElementById(elementId);
    if (el) {
      el.textContent = message;
      el.style.display = 'block';
    }
  }

  showSuccess(elementId, message) {
    const el = document.getElementById(elementId);
    if (el) {
      el.textContent = message;
      el.style.display = 'block';
    }
  }

  clearErrors() {
    ['login-error', 'signup-error', 'signup-success'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  setButtonLoading(button, loading) {
    if (!button) return;
    button.disabled = loading;
    const textEl = button.querySelector('.button-text') || button;
    if (loading) {
      button._originalText = textEl.textContent;
      textEl.textContent = 'Loading...';
    } else if (button._originalText) {
      textEl.textContent = button._originalText;
    }
  }

  handleError(message, error) {
    console.error(`PhishArmor Popup: ${message}`, error);
  }

  // -----------------------------------------------------------------------
  // Messaging
  // -----------------------------------------------------------------------

  sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response || {});
        }
      });
    });
  }
}

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new PopupManager());
} else {
  new PopupManager();
}
