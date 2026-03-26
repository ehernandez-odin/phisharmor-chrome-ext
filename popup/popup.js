/**
 * PhishArmor Extension Popup Script
 * Handles authentication, dashboard display, and user interactions
 * Following Chrome Extension Manifest V3 best practices
 */

class PopupManager {
  constructor() {
    this.currentView = 'logged-out-view';
    this.i18nData = {};
    this.init();
  }

  /**
   * Initialize the popup
   */
  async init() {
    try {
      await this.loadI18n();
      this.setupEventListeners();
      this.setupAccessibility();
      await this.checkAuthStatus();
      this.updateI18nText();
    } catch (error) {
      this.handleError('Failed to initialize popup', error);
    }
  }

  /**
   * Load internationalization data
   */
  async loadI18n() {
    try {
      // Try to use Chrome i18n API first, fallback to English
      if (chrome.i18n) {
        this.i18nData = {
          'login.title': chrome.i18n.getMessage('loginTitle') || 'PhishArmor Protection',
          'login.description': chrome.i18n.getMessage('loginDescription') || 'Protect your emails with AI-powered phishing detection.',
          'login.button': chrome.i18n.getMessage('loginButton') || 'Login to Continue',
          'login.no_account': chrome.i18n.getMessage('loginNoAccount') || "Don't have an account? ",
          'login.signup': chrome.i18n.getMessage('loginSignup') || 'Sign up',
          'dashboard.title': chrome.i18n.getMessage('dashboardTitle') || 'Dashboard',
          'dashboard.security_score': chrome.i18n.getMessage('dashboardSecurityScore') || 'Security Score',
          'dashboard.scan_prompt': chrome.i18n.getMessage('dashboardScanPrompt') || 'Scan your latest email to see your score.',
          'dashboard.urls_blocked': chrome.i18n.getMessage('dashboardUrlsBlocked') || 'URLs Blocked',
          'dashboard.emails_scanned': chrome.i18n.getMessage('dashboardEmailsScanned') || 'Emails Scanned',
          'dashboard.view_flagged': chrome.i18n.getMessage('dashboardViewFlagged') || 'View Flagged Emails',
          'dashboard.settings': chrome.i18n.getMessage('dashboardSettings') || 'Settings',
          'dashboard.logout': chrome.i18n.getMessage('dashboardLogout') || 'Logout',
          'common.loading': chrome.i18n.getMessage('commonLoading') || 'Loading...',
        };
      }
    } catch (error) {
      console.warn('Failed to load i18n data, using defaults:', error);
    }
  }

  /**
   * Update text content with i18n values
   */
  updateI18nText() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
      const key = element.getAttribute('data-i18n');
      if (this.i18nData[key]) {
        if (element.tagName === 'INPUT' && element.type === 'button') {
          element.value = this.i18nData[key];
        } else {
          element.textContent = this.i18nData[key];
        }
      }
    });
  }

  /**
   * Set up event listeners for user interactions
   */
  setupEventListeners() {
    // Login button
    const loginButton = document.getElementById('login-button');
    if (loginButton) {
      loginButton.addEventListener('click', this.handleLogin.bind(this));
      this.setupRippleEffect(loginButton);
    }

    // Signup link
    const signupLink = document.getElementById('signup-link');
    if (signupLink) {
      signupLink.addEventListener('click', this.handleSignup.bind(this));
      signupLink.addEventListener('keydown', this.handleKeyboardActivation.bind(this));
    }

    // Dashboard buttons
    const flaggedEmailsButton = document.getElementById('flagged-emails-button');
    if (flaggedEmailsButton) {
      flaggedEmailsButton.addEventListener('click', this.handleViewFlaggedEmails.bind(this));
      this.setupRippleEffect(flaggedEmailsButton);
    }

    const settingsButton = document.getElementById('settings-button');
    if (settingsButton) {
      settingsButton.addEventListener('click', this.handleSettings.bind(this));
      this.setupRippleEffect(settingsButton);
    }

    const logoutButton = document.getElementById('logout-button');
    if (logoutButton) {
      logoutButton.addEventListener('click', this.handleLogout.bind(this));
      this.setupRippleEffect(logoutButton);
    }

    // Global keyboard shortcuts
    document.addEventListener('keydown', this.handleGlobalKeyboard.bind(this));
  }

  /**
   * Set up accessibility features
   */
  setupAccessibility() {
    // Announce view changes to screen readers
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          const target = mutation.target;
          if (target.style.display !== 'none' && target.classList.contains('popup-container')) {
            target.setAttribute('aria-live', 'polite');
            setTimeout(() => target.removeAttribute('aria-live'), 1000);
          }
        }
      });
    });

    document.querySelectorAll('.popup-container').forEach(container => {
      observer.observe(container, { attributes: true });
    });
  }

  /**
   * Add Material Design ripple effect to buttons
   */
  setupRippleEffect(button) {
    button.addEventListener('click', (e) => {
      if (!button.querySelector('.button-ripple')) return;
      
      const ripple = button.querySelector('.button-ripple');
      const rect = button.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;
      
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = x + 'px';
      ripple.style.top = y + 'px';
      
      ripple.classList.remove('animate');
      ripple.classList.add('animate');
      
      setTimeout(() => ripple.classList.remove('animate'), 600);
    });
  }

  /**
   * Handle keyboard activation for links
   */
  handleKeyboardActivation(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.target.click();
    }
  }

  /**
   * Handle global keyboard shortcuts
   */
  handleGlobalKeyboard(event) {
    // Escape key to close popup
    if (event.key === 'Escape') {
      window.close();
    }
    
    // Alt+L for login shortcut
    if (event.altKey && event.key === 'l' && this.currentView === 'logged-out-view') {
      document.getElementById('login-button')?.click();
    }
  }

  /**
   * Check authentication status from storage
   */
  async checkAuthStatus() {
    try {
      this.showLoading();
      
      const result = await chrome.storage.sync.get(['isLoggedIn', 'userStats']);
      const isLoggedIn = result.isLoggedIn || false;
      
      if (isLoggedIn) {
        await this.updateDashboardData(result.userStats);
        this.showView('logged-in-view');
      } else {
        this.showView('logged-out-view');
      }
    } catch (error) {
      this.handleError('Failed to check authentication status', error);
      this.showView('logged-out-view');
    }
  }

  /**
   * Handle login button click
   */
  async handleLogin(event) {
    event.preventDefault();
    
    try {
      const button = event.target.closest('button');
      this.setButtonLoading(button, true);
      
      // Send message to background script for authentication
      const response = await chrome.runtime.sendMessage({
        action: 'authenticate',
        type: 'login'
      });
      
      if (response.success) {
        await this.updateDashboardData(response.userStats);
        this.showView('logged-in-view');
      } else {
        throw new Error(response.error || 'Login failed');
      }
    } catch (error) {
      this.handleError('Login failed', error);
    } finally {
      this.setButtonLoading(event.target.closest('button'), false);
    }
  }

  /**
   * Handle signup link click
   */
  async handleSignup(event) {
    event.preventDefault();
    
    try {
      // Open signup page in new tab
      await chrome.tabs.create({
        url: 'https://phisharmor.com/signup',
        active: true
      });
      
      // Close popup after opening signup
      window.close();
    } catch (error) {
      this.handleError('Failed to open signup page', error);
    }
  }

  /**
   * Handle view flagged emails
   */
  async handleViewFlaggedEmails(event) {
    event.preventDefault();
    
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'openFlaggedEmails'
      });
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to open flagged emails');
      }
    } catch (error) {
      this.handleError('Failed to view flagged emails', error);
    }
  }

  /**
   * Handle settings button click
   */
  async handleSettings(event) {
    event.preventDefault();
    
    try {
      await chrome.runtime.openOptionsPage();
    } catch (error) {
      this.handleError('Failed to open settings', error);
    }
  }

  /**
   * Handle logout button click
   */
  async handleLogout(event) {
    event.preventDefault();
    
    try {
      const button = event.target.closest('button');
      this.setButtonLoading(button, true);
      
      const response = await chrome.runtime.sendMessage({
        action: 'logout'
      });
      
      if (response.success) {
        this.showView('logged-out-view');
      } else {
        throw new Error(response.error || 'Logout failed');
      }
    } catch (error) {
      this.handleError('Logout failed', error);
    } finally {
      this.setButtonLoading(event.target.closest('button'), false);
    }
  }

  /**
   * Update dashboard with user statistics
   */
  async updateDashboardData(stats = {}) {
    try {
      const currentScore = document.getElementById('current-score');
      const blockedUrls = document.getElementById('blocked-urls-count');
      const emailsScanned = document.getElementById('emails-scanned');
      const scoreExplanation = document.getElementById('score-explanation');
      
      if (currentScore) {
        currentScore.textContent = stats.securityScore || 'N/A';
        currentScore.setAttribute('aria-label', `Security score: ${stats.securityScore || 'Not available'}`);
      }
      
      if (blockedUrls) {
        blockedUrls.textContent = stats.blockedUrls || '0';
      }
      
      if (emailsScanned) {
        emailsScanned.textContent = stats.emailsScanned || '0';
      }
      
      if (scoreExplanation) {
        scoreExplanation.textContent = stats.explanation || 'Scan your latest email to see your score.';
      }
    } catch (error) {
      this.handleError('Failed to update dashboard data', error);
    }
  }

  /**
   * Show a specific view and hide others
   */
  showView(viewId) {
    const views = ['logged-out-view', 'logged-in-view', 'loading-view'];
    
    views.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.style.display = id === viewId ? 'flex' : 'none';
      }
    });
    
    this.currentView = viewId;
    
    // Announce view change for accessibility
    const activeView = document.getElementById(viewId);
    if (activeView) {
      activeView.focus();
    }
  }

  /**
   * Show loading state
   */
  showLoading() {
    this.showView('loading-view');
  }

  /**
   * Set button loading state
   */
  setButtonLoading(button, isLoading) {
    if (!button) return;
    
    button.disabled = isLoading;
    button.setAttribute('aria-busy', isLoading.toString());
    
    if (isLoading) {
      button.setAttribute('data-original-text', button.textContent);
      button.textContent = 'Loading...';
    } else {
      const originalText = button.getAttribute('data-original-text');
      if (originalText) {
        button.textContent = originalText;
        button.removeAttribute('data-original-text');
      }
    }
  }

  /**
   * Handle errors with proper logging and user feedback
   */
  handleError(message, error) {
    console.error(`PhishArmor Popup Error: ${message}`, error);
    
    // Log error to background script for analytics
    try {
      chrome.runtime.sendMessage({
        action: 'logError',
        error: {
          message,
          details: error.message || error.toString(),
          timestamp: new Date().toISOString(),
          location: 'popup'
        }
      });
    } catch (sendError) {
      console.error('Failed to send error to background:', sendError);
    }
    
    // Show user-friendly error message
    this.showUserError(message);
  }

  /**
   * Show user-friendly error message
   */
  showUserError(message) {
    // Create a temporary error notification
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-notification';
    errorDiv.textContent = message;
    errorDiv.style.cssText = `
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: #fed7d7;
      color: #c53030;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 12px;
      z-index: 1000;
      animation: slideDown 0.3s ease;
    `;
    
    document.body.appendChild(errorDiv);
    
    // Remove after 3 seconds
    setTimeout(() => {
      if (errorDiv.parentNode) {
        errorDiv.remove();
      }
    }, 3000);
  }
}

// Initialize popup when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
  });
} else {
  new PopupManager();
}

// Export for testing purposes
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PopupManager;
} 