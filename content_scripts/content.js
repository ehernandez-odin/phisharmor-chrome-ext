// This script will be injected into email pages (Gmail, Outlook, etc.)
// It will be responsible for:
// 1. Identifying when an email is opened.
// 2. Extracting email content (sender, subject, body) from the opened email.
// 3. Sending this content to the background script for analysis.
// 4. Receiving the analysis result (confidence score and details) from the background script.
// 5. Injecting the shield icon next to the "Labels" icon in the opened email view.
// 6. Handling click events on the shield icon to display a dynamic tooltip.

console.log("PhishArmor content script loaded (v3 - dynamic tooltip).");

// Global test functions - defined immediately for console access
window.testPhishArmorWebRisk = function() {
    console.log("PhishArmor: Manually testing Web Risk API...");
    chrome.runtime.sendMessage({ action: "testWebRisk" }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("PhishArmor: Failed to test Web Risk API:", chrome.runtime.lastError.message);
        } else {
            console.log("PhishArmor: Web Risk API test result:", response);
        }
    });
};

window.diagnosePhishArmorWebRisk = function() {
    console.log("PhishArmor: Running comprehensive Web Risk API diagnostic...");
    chrome.runtime.sendMessage({ action: "diagnoseWebRisk" }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("PhishArmor: Failed to run Web Risk diagnostic:", chrome.runtime.lastError.message);
        } else {
            console.log("PhishArmor: Web Risk API diagnostic result:", response);
        }
    });
};

// Confirm functions are available
console.log("PhishArmor: Global functions available:");
console.log("  - testPhishArmorWebRisk()");
console.log("  - diagnosePhishArmorWebRisk()");

// let phishArmorTooltipIframe = null; // No longer using iframe
let phishArmorDynamicTooltip = null; // Will hold the dynamically created tooltip element
let currentOpenEmailIdForTooltip = null; // Tracks which email the tooltip is for
let currentOpenEmailId = null; // Tracks the currently open email ID - FIXED: Added missing variable
let currentHostTabId = null; // Will store the ID of this tab

// Function to get current tab ID (once)
function getCurrentTabId(callback) {
    if (currentHostTabId) {
        callback(currentHostTabId);
        return;
    }
    chrome.runtime.sendMessage({ action: "getTabId" }, response => {
        if (chrome.runtime.lastError) {
            console.error("Error getting tab ID:", chrome.runtime.lastError.message);
            callback(null);
        } else if (response && response.tabId) {
            currentHostTabId = response.tabId;
            callback(currentHostTabId);
        } else {
            callback(null);
        }
    });
}

// Function to create and inject the shield icon in OPEN EMAIL VIEW
function injectShieldIconOpenView(emailId, scoreDetails, targetToolbar) {
    if (!targetToolbar) {
        console.warn("PhishArmor: No target toolbar found for shield injection in open email.");
        return;
    }

    // Remove ALL existing PhishArmor shields from the page to prevent duplicates
    const allExistingShields = document.querySelectorAll('.phisharmor-shield-icon');
    allExistingShields.forEach(shield => shield.remove());

    // Create new shield icon
    const shieldIcon = document.createElement('img');
    shieldIcon.classList.add('phisharmor-shield-icon');
    shieldIcon.dataset.emailId = emailId;
    let iconName = 'shield-grey.png'; // Default

    if (scoreDetails && scoreDetails.level) {
        if (scoreDetails.level === 'safe') iconName = 'shield-green.png';
        else if (scoreDetails.level === 'caution' || scoreDetails.level === 'medium') iconName = 'shield-yellow.png';
        else if (scoreDetails.level === 'dangerous' || scoreDetails.level === 'high' || scoreDetails.level === 'critical') iconName = 'shield-red.png';
        else if (scoreDetails.level === 'error') iconName = 'shield-grey.png';
        else if (scoreDetails.level === 'loading') iconName = 'loading.gif';
        else if (scoreDetails.level === 'manual') iconName = 'shield-grey.png'; // Free user, click to scan
        else if (scoreDetails.level === 'limit_reached') iconName = 'shield-grey.png'; // Daily limit hit
    }

    shieldIcon.src = chrome.runtime.getURL(`icons/${iconName}`);
    shieldIcon.style.width = '20px';
    shieldIcon.style.height = '20px';
    shieldIcon.style.marginLeft = '8px';
    shieldIcon.style.marginRight = '8px';
    shieldIcon.style.cursor = 'pointer';
    shieldIcon.style.verticalAlign = 'middle';
    shieldIcon.style.zIndex = '1000';
    shieldIcon.style.position = 'relative'; // Ensure it's clickable

    // Update title attribute based on level
    if (scoreDetails && scoreDetails.level === 'manual') {
        shieldIcon.title = 'Click to scan this email (Free plan)';
    } else if (scoreDetails && scoreDetails.level === 'limit_reached') {
        shieldIcon.title = 'Daily scan limit reached. Upgrade for more scans.';
    } else {
        shieldIcon.title = 'Click to see PhishArmor Report';
    }

    // Store the level in the shield's dataset
    shieldIcon.dataset.level = scoreDetails?.level || 'unknown';

    // Always append to the end of the toolbar as per user preference
    targetToolbar.appendChild(shieldIcon);
    console.log("PhishArmor: Shield icon appended to end of toolbar for email ID:", emailId);

    // IMPROVED: Better click handler with immediate feedback
    shieldIcon.addEventListener('click', (event) => {
        console.log(`PhishArmor: Shield CLICKED for email ID: ${emailId}`);
        event.preventDefault();
        event.stopImmediatePropagation(); // Stop all propagation
        
        // Add visual feedback
        shieldIcon.style.opacity = '0.7';
        setTimeout(() => { shieldIcon.style.opacity = '1'; }, 200);
        
        // Check if shield is in manual or limit_reached state
        if (shieldIcon.dataset.level === 'manual' || shieldIcon.dataset.level === 'limit_reached') {
            // For manual state: trigger a manual scan with full email data
            if (shieldIcon.dataset.level === 'manual') {
                // Extract email data from the DOM (same as processOpenEmail does)
                const subjectElement = document.querySelector('h2.hP');
                const extractedData = subjectElement ? extractEmailDataFromDOM(emailId, subjectElement) : null;

                if (extractedData) {
                    extractedData.triggerType = 'manual';
                    chrome.runtime.sendMessage({
                        action: "analyzeEmail",
                        emailData: extractedData
                    });
                } else {
                    // Fallback: send minimal data with manual trigger
                    console.warn("PhishArmor: Could not extract email data for manual scan, sending ID only");
                    chrome.runtime.sendMessage({
                        action: "analyzeEmail",
                        emailData: { id: emailId, triggerType: 'manual' }
                    });
                }
                // Show loading state
                shieldIcon.src = chrome.runtime.getURL('icons/loading.gif');
                shieldIcon.dataset.level = 'loading';
                return;
            }
            // For limit_reached: show upgrade prompt in tooltip instead
        }
        
        toggleDynamicTooltip(emailId, shieldIcon);
    }, true); // Use capture phase to ensure we get the event first

    // Also add mousedown event as backup
    shieldIcon.addEventListener('mousedown', (event) => {
        console.log(`PhishArmor: Shield mousedown for email ID: ${emailId}`);
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);
}

function removeDynamicTooltip() {
    if (phishArmorDynamicTooltip) {
        phishArmorDynamicTooltip.remove();
        phishArmorDynamicTooltip = null;
        currentOpenEmailIdForTooltip = null;
    }
}

function toggleDynamicTooltip(emailId, anchorElement) {
    if (phishArmorDynamicTooltip && currentOpenEmailIdForTooltip === emailId) {
        removeDynamicTooltip();
        return;
    }
    removeDynamicTooltip(); // Remove any existing tooltip first

    currentOpenEmailIdForTooltip = emailId;

    // Check if the current shield is in loading state
    const currentShield = anchorElement;
    const isLoadingState = currentShield && currentShield.src && currentShield.src.includes('loading.gif');
    
    // Debug logging to understand the issue
    console.log("PhishArmor DEBUG: Shield click debug info:");
    console.log("  - Shield element:", currentShield);
    console.log("  - Shield src:", currentShield ? currentShield.src : "no src");
    console.log("  - isLoadingState:", isLoadingState);
    console.log("  - emailId:", emailId);

    // Create the main tooltip container
    phishArmorDynamicTooltip = document.createElement('div');
    phishArmorDynamicTooltip.id = 'phisharmor-dynamic-tooltip';
    // Basic styling (can be expanded or moved to content.css if preferred for cleanliness)
    phishArmorDynamicTooltip.style.position = 'absolute';
    phishArmorDynamicTooltip.style.zIndex = '2147483647';
    phishArmorDynamicTooltip.style.border = '1px solid #ccc';
    phishArmorDynamicTooltip.style.borderRadius = '8px';
    phishArmorDynamicTooltip.style.boxShadow = '0 5px 15px rgba(0,0,0,0.2)';
    phishArmorDynamicTooltip.style.width = '350px';
    phishArmorDynamicTooltip.style.minHeight = '200px'; // Auto-adjust height
    phishArmorDynamicTooltip.style.backgroundColor = 'white';
    phishArmorDynamicTooltip.style.padding = '15px';
    phishArmorDynamicTooltip.style.fontFamily = 'Arial, sans-serif';
    phishArmorDynamicTooltip.style.fontSize = '14px';
    phishArmorDynamicTooltip.style.color = '#333';
    phishArmorDynamicTooltip.style.overflowY = 'auto'; // For potentially long explanations
    phishArmorDynamicTooltip.style.maxHeight = '450px';


    // Positioning - IMPROVED for better reliability with new smaller size
    const rect = anchorElement.getBoundingClientRect();
    const tooltipWidth = 380;
    const tooltipHeight = 400; // Max height
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Calculate optimal position
    let top = window.scrollY + rect.bottom + 8;
    let left = window.scrollX + rect.left;
    
    // Adjust horizontal position if tooltip would go off screen
    if (left + tooltipWidth > viewportWidth - 10) {
        left = Math.max(10, viewportWidth - tooltipWidth - 10);
    }
    
    // If tooltip would go below viewport, show above the element instead
    if (rect.bottom + tooltipHeight > viewportHeight - 10) {
        top = Math.max(10, window.scrollY + rect.top - tooltipHeight - 8);
    }
    
    // Final bounds check
    top = Math.max(10, Math.min(top, window.scrollY + viewportHeight - tooltipHeight - 10));
    left = Math.max(10, left);
    
    phishArmorDynamicTooltip.style.top = `${top}px`;
    phishArmorDynamicTooltip.style.left = `${left}px`;

    // IMPROVED: Show better loading state initially
    phishArmorDynamicTooltip.innerHTML = `
        <div style="padding: 24px; text-align: center;">
            <div style="display: inline-block; width: 40px; height: 40px; border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 16px;"></div>
            <p style="margin: 0; color: #64748b;">Loading email analysis...</p>
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        </div>
    `;
    document.body.appendChild(phishArmorDynamicTooltip);

    // Add a close button to the tooltip itself
    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.style.position = 'absolute';
    closeButton.style.top = '5px';
    closeButton.style.right = '10px';
    closeButton.style.background = 'none';
    closeButton.style.border = 'none';
    closeButton.style.fontSize = '20px';
    closeButton.style.cursor = 'pointer';
    closeButton.style.color = '#777';
    closeButton.onclick = () => removeDynamicTooltip();
    phishArmorDynamicTooltip.appendChild(closeButton);


    // Fetch report data from background script
    chrome.runtime.sendMessage({ action: "getReportDataForTooltip", emailId: emailId }, response => {
        if (chrome.runtime.lastError) {
            console.error("PhishArmor: Error fetching report data:", chrome.runtime.lastError.message);
            phishArmorDynamicTooltip.innerHTML = '<p style="color:red; text-align:center;">Error loading report.</p>';
            phishArmorDynamicTooltip.appendChild(closeButton); // Re-add close button
            return;
        }
        if (response && response.error) {
            console.error("PhishArmor: Background error fetching report:", response.error);
            
            // Debug logging for error handling
            console.log("PhishArmor DEBUG: Error response debug info:");
            console.log("  - Error message:", response.error);
            console.log("  - isLoadingState at error time:", isLoadingState);
            console.log("  - Exact error comparison:", response.error === "No report data found");
            
            // Check if this is a "No report data found" error
            if (response.error === "No report data found") {
                if (isLoadingState) {
                    console.log("PhishArmor DEBUG: Showing loading content instead of error");
                    showLoadingTooltipContent(phishArmorDynamicTooltip, closeButton);
                } else {
                    // No cached data — auto-trigger a manual scan and show loading
                    console.log("PhishArmor DEBUG: No data found, triggering manual scan");
                    const subjectEl = document.querySelector('h2.hP');
                    const emailDataForScan = subjectEl ? extractEmailDataFromDOM(emailId, subjectEl) : null;
                    if (emailDataForScan) {
                        emailDataForScan.triggerType = 'manual';
                        chrome.runtime.sendMessage({ action: "analyzeEmail", emailData: emailDataForScan });
                        showLoadingTooltipContent(phishArmorDynamicTooltip, closeButton);
                        // Update the shield icon to loading
                        if (anchorElement) {
                            anchorElement.src = chrome.runtime.getURL('icons/loading.gif');
                            anchorElement.dataset.level = 'loading';
                        }
                    } else {
                        phishArmorDynamicTooltip.innerHTML = `<p style="color:red; text-align:center;">Error: ${response.error}</p>`;
                        phishArmorDynamicTooltip.appendChild(closeButton);
                    }
                }
            } else {
                console.log("PhishArmor DEBUG: Showing error message");
                phishArmorDynamicTooltip.innerHTML = `<p style="color:red; text-align:center;">Error: ${response.error}</p>`;
                phishArmorDynamicTooltip.appendChild(closeButton);
            }
        } else if (response && response.scoreDetails) {
            populateDynamicTooltip(phishArmorDynamicTooltip, response.scoreDetails, emailId);
             // The close button is already part of the structure if populateDynamicTooltip doesn't clear it
        } else {
            // No response data - check if we're in loading state
            if (isLoadingState) {
                showLoadingTooltipContent(phishArmorDynamicTooltip, closeButton);
            } else {
                phishArmorDynamicTooltip.innerHTML = '<p style="text-align:center;">No report data found.</p>';
                phishArmorDynamicTooltip.appendChild(closeButton); // Re-add close button
            }
        }
    });
}

function showLoadingTooltipContent(tooltipElement, closeButton) {
    tooltipElement.innerHTML = `
        <div style="padding: 32px 24px; text-align: center;">
            <div style="display: inline-block; width: 48px; height: 48px; border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px;"></div>
            <h3 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 600; color: #1e293b;">Analyzing Email Security</h3>
            <p style="margin: 0 0 16px 0; color: #64748b; line-height: 1.4;">
                PhishArmor is currently analyzing this email using AI and security databases. This usually takes a few seconds.
            </p>
            <div style="background: #f8fafc; border-radius: 6px; padding: 12px; border-left: 3px solid #3498db;">
                <p style="margin: 0; font-size: 13px; color: #475569; line-height: 1.4;">
                    💡 <strong>Tip:</strong> You can close this dialog and come back in a moment to see the complete security analysis.
                </p>
            </div>
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        </div>
    `;
    tooltipElement.appendChild(closeButton);
}

function populateDynamicTooltip(tooltipElement, scoreDetails, emailId) {
    // Check for login_required state
    if (scoreDetails.level === 'login_required') {
        tooltipElement.innerHTML = `
            <div style="padding: 32px 24px; text-align: center;">
                <div style="display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; border-radius: 50%; background: #f1f5f9; color: #64748b; font-size: 24px; margin-bottom: 16px;">🔑</div>
                <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #1e293b;">Login Required</h3>
                <p style="margin: 0 0 16px 0; color: #64748b; font-size: 13px; line-height: 1.4;">
                    Please log in via the PhishArmor extension popup to scan emails for phishing threats.
                </p>
                <p style="margin: 0; font-size: 12px; color: #94a3b8;">Click the PhishArmor icon in your browser toolbar to sign in.</p>
            </div>
        `;
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = 'position:absolute;top:5px;right:10px;background:none;border:none;font-size:20px;cursor:pointer;color:#777;';
        closeBtn.onclick = () => removeDynamicTooltip();
        tooltipElement.appendChild(closeBtn);
        return;
    }

    // Check for manual scan state (free tier, auto-scan blocked)
    if (scoreDetails.level === 'manual') {
        tooltipElement.innerHTML = `
            <div style="padding: 32px 24px; text-align: center;">
                <div style="display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; border-radius: 50%; background: #eff6ff; color: #3b82f6; font-size: 24px; margin-bottom: 16px;">🛡️</div>
                <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #1e293b;">Manual Scan Required</h3>
                <p style="margin: 0 0 16px 0; color: #64748b; font-size: 13px; line-height: 1.4;">
                    ${scoreDetails.message || 'Click the shield icon to scan this email. Free plan supports manual scanning only.'}
                </p>
                <a href="https://phisharmor.com/pricing" target="_blank"
                   style="display: inline-block; padding: 8px 20px; background: #2563eb; color: white; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 500;">
                    Upgrade for Auto-Scan
                </a>
            </div>
        `;
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = 'position:absolute;top:5px;right:10px;background:none;border:none;font-size:20px;cursor:pointer;color:#777;';
        closeBtn.onclick = () => removeDynamicTooltip();
        tooltipElement.appendChild(closeBtn);
        return;
    }

    // Check for limit_reached state
    if (scoreDetails.level === 'limit_reached') {
        tooltipElement.innerHTML = `
            <div style="padding: 32px 24px; text-align: center;">
                <div style="display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; border-radius: 50%; background: #f1f5f9; color: #64748b; font-size: 24px; margin-bottom: 16px;">🔒</div>
                <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #1e293b;">Daily Scan Limit Reached</h3>
                <p style="margin: 0 0 16px 0; color: #64748b; font-size: 13px; line-height: 1.4;">
                    You've used all ${scoreDetails.scanInfo?.daily_scan_limit || 5} of your free daily scans. Upgrade to Premium for 50 scans/day.
                </p>
                <a href="https://phisharmor.com/pricing" target="_blank" 
                   style="display: inline-block; padding: 10px 24px; background: #2563eb; color: white; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
                    Upgrade to Premium — $4.99/mo
                </a>
                <p style="margin: 12px 0 0 0; font-size: 11px; color: #94a3b8;">Resets at midnight UTC</p>
            </div>
        `;
        // Add close button
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = 'position:absolute;top:5px;right:10px;background:none;border:none;font-size:20px;cursor:pointer;color:#777;';
        closeBtn.onclick = () => removeDynamicTooltip();
        tooltipElement.appendChild(closeBtn);
        return;
    }
    
    // Clear previous content
    tooltipElement.innerHTML = '';

    // Set overall tooltip styling with improved sizing and scrolling
    tooltipElement.style.position = 'fixed';
    tooltipElement.style.zIndex = '2147483647';
    tooltipElement.style.border = 'none';
    tooltipElement.style.borderRadius = '12px';
    tooltipElement.style.boxShadow = '0 8px 32px rgba(0,0,0,0.12)';
    tooltipElement.style.width = '380px';
    tooltipElement.style.maxHeight = '400px'; // Reduced max height
    tooltipElement.style.backgroundColor = 'white';
    tooltipElement.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    tooltipElement.style.fontSize = '14px';
    tooltipElement.style.color = '#333';
    tooltipElement.style.overflow = 'hidden';
    tooltipElement.style.display = 'flex';
    tooltipElement.style.flexDirection = 'column';

    // Handle confidence score - check for both 'score' and 'confidenceScore' fields
    let confidenceScore = 0;
    if (scoreDetails.score && typeof scoreDetails.score === 'string') {
        confidenceScore = parseInt(scoreDetails.score.replace('%', '')) || 0;
    } else if (scoreDetails.confidenceScore) {
        confidenceScore = scoreDetails.confidenceScore;
    }
    
    // Use the new risk level display
    let displayText = scoreDetails.score || scoreDetails.riskLevel || 'Unknown';
    let scoreColor, scoreIcon;

    if (scoreDetails.level === 'safe') {
        scoreColor = '#22c55e'; // green for safe
        scoreIcon = '✓';
    } else if (scoreDetails.level === 'caution' || scoreDetails.level === 'medium') {
        scoreColor = '#f59e0b'; // amber/yellow for caution
        scoreIcon = '⚠';
    } else if (scoreDetails.level === 'dangerous' || scoreDetails.level === 'high' || scoreDetails.level === 'critical') {
        scoreColor = '#ef4444'; // red for dangerous
        scoreIcon = '✕';
    } else if (scoreDetails.level === 'error') {
        scoreColor = '#6b7280'; // gray
        scoreIcon = '?';
        displayText = 'Error';
        confidenceScore = 0;
    } else {
        // Unknown or unmapped level - default to grey, not green
        scoreColor = '#6b7280';
        scoreIcon = '?';
    }

    const htmlContent = `
        <!-- Header -->
        <div style="flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: 16px 20px 12px; border-bottom: 1px solid #f1f5f9;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${scoreColor}" stroke-width="2">
                    <path d="M9 12l2 2 4-4"></path>
                    <path d="M12 1a9 9 0 0 1 9 9v2.5a3.5 3.5 0 0 1-3.5 3.5H15"></path>
                    <path d="M3 12a9 9 0 0 1 9-9"></path>
                </svg>
                <h3 style="margin: 0; font-size: 15px; font-weight: 600; color: #1e293b;">Email Safety Report</h3>
            </div>
            <button id="phisharmor-close-btn" style="background: none; border: none; font-size: 16px; color: #64748b; cursor: pointer; padding: 2px; line-height: 1;">×</button>
        </div>

        <!-- Scrollable Content -->
        <div style="flex: 1; overflow-y: auto; padding: 0;">
            <!-- Risk Level Section -->
            <div style="padding: 20px; text-align: center; background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);">
                <div style="display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; border-radius: 50%; background: ${scoreColor}; color: white; font-size: 20px; font-weight: bold; margin-bottom: 10px;">
                    ${scoreIcon}
                </div>
                <div style="font-size: 18px; font-weight: 700; color: #1e293b; margin-bottom: 4px;">
                    ${displayText}
                </div>
                <div style="font-size: 12px; color: #64748b;">
                    Risk assessment based on AI and rule analysis
                </div>
            </div>

            <!-- Key Risk Indicators Section (hidden on error) -->
            ${scoreDetails.level === 'error' ? `
            <div style="padding: 18px 20px 16px;">
                <div style="background: #fef2f2; border-radius: 8px; padding: 16px; border-left: 3px solid #ef4444;">
                    <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #991b1b;">Analysis Failed</p>
                    <p style="margin: 0; font-size: 12px; color: #7f1d1d; line-height: 1.4;">${scoreDetails.message || 'An error occurred during analysis. Please try again.'}</p>
                </div>
            </div>
            ` : `
            <div style="padding: 18px 20px 16px;">
                <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #1e293b;">Key Risk Indicators</h4>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${generateIndicatorRows(scoreDetails.indicators || {}, scoreDetails.aiAnalysisDetails || {}, scoreDetails.level || 'unknown', scoreDetails.tierFeatures || {})}
                </div>
            </div>

            <!-- AI Analysis Summary Section -->
            <div style="padding: 0 20px 20px;">
                <h4 style="margin: 0 0 10px 0; font-size: 14px; font-weight: 600; color: #1e293b;">AI Analysis Summary</h4>
                <div style="background: #f8fafc; border-radius: 6px; padding: 12px; border-left: 3px solid ${scoreColor};">
                    <p style="margin: 0; line-height: 1.4; color: #475569; font-size: 13px;">
                        ${scoreDetails.overallAssessment || scoreDetails.explanation || scoreDetails.aiComments || 'Analysis completed successfully. No additional details available.'}
                    </p>
                    ${scoreDetails.aiAnalysisDetails && scoreDetails.aiAnalysisDetails.userRecommendation ? 
                        `<div style="margin-top: 12px; padding: 10px; background: #e0f2fe; border-radius: 4px; border-left: 3px solid #0284c7;">
                            <p style="margin: 0; font-size: 12px; color: #0c4a6e; font-weight: 500;">💡 Recommendation:</p>
                            <p style="margin: 4px 0 0 0; font-size: 12px; color: #0c4a6e; line-height: 1.3;">${scoreDetails.aiAnalysisDetails.userRecommendation}</p>
                        </div>` : ''
                    }
                </div>
                <div style="margin-top: 12px; text-align: center;">
                    <a href="https://example.com/phisharmor-learn-more" target="_blank" 
                       style="color: #3b82f6; text-decoration: none; font-size: 12px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;">
                        Learn more 
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M7 17L17 7M17 7H7M17 7V17"></path>
                        </svg>
                    </a>
                </div>
            </div>
            `}

                ${scoreDetails.showAds ? `
                    <div style="padding: 12px 20px; border-top: 1px solid #f1f5f9; text-align: center; background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);">
                        <p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 600; color: #0369a1;">Unlock Full Protection</p>
                        <p style="margin: 0 0 8px 0; font-size: 11px; color: #64748b;">Auto-scan, sender verification, safe link checking & more</p>
                        <a href="https://phisharmor.com/pricing" target="_blank" 
                           style="display: inline-block; padding: 6px 16px; background: #2563eb; color: white; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 500;">
                            Try Premium Free — 7 Days
                        </a>
                    </div>
                ` : ''}

                ${scoreDetails.scanInfo ? `
                    <div style="padding: 8px 20px; border-top: 1px solid #f1f5f9; text-align: center;">
                        <p style="margin: 0; font-size: 11px; color: #94a3b8;">${scoreDetails.scanInfo.daily_scans_used} of ${scoreDetails.scanInfo.daily_scan_limit} scans used today</p>
                    </div>
                ` : ''}
            </div>
        </div>
        
        <!-- No more script tag - JavaScript will be added programmatically -->
    `;
    
    tooltipElement.innerHTML = htmlContent;

    // Add close button functionality
    const closeBtn = tooltipElement.querySelector('#phisharmor-close-btn');
    if (closeBtn) {
        closeBtn.onclick = () => removeDynamicTooltip();
    }
    
    // Add dropdown functionality programmatically (since script tags in innerHTML don't execute)
    const clickableIndicators = tooltipElement.querySelectorAll('[data-dropdown-index]');
    clickableIndicators.forEach(indicator => {
        const index = indicator.getAttribute('data-dropdown-index');
        indicator.addEventListener('click', () => toggleDropdown(index, tooltipElement));
    });
}

function generateIndicatorRows(indicators, aiAnalysisDetails = {}, overallLevel = 'unknown', tierFeatures = {}) {
    const indicatorConfigs = [
        { 
            key: 'suspiciousSenderAddress', 
            label: 'Verified Sender',
            premiumFeatureKey: 'sender_verification',
            positiveIf: false,
            goodText: 'Sender verified',
            badText: 'Sender suspicious',
            threatLevel: 'high',
            getDetailText: (indicators, aiAnalysisDetails, isGood) => {
                const indicator = indicators.suspiciousSenderAddress;
                
                if (isGood && indicator?.reason) {
                    return `✅ PhishArmor AI verified this sender as legitimate.`;
                } else if (!isGood) {
                    // First try to use the AI-generated technical security summary (more user-friendly)
                    if (aiAnalysisDetails.technicalSecuritySummary) {
                        return `${aiAnalysisDetails.technicalSecuritySummary}`;
                    }
                    // Fallback to indicator reason if available
                    else if (indicator?.reason) {
                        const reason = indicator.reason;
                        if (reason.includes('High risk domain') || reason.includes('Suspicious domain')) {
                            return `🚨 PhishArmor AI detected security concerns with this sender's domain.`;
                        } else {
                            return `🔍 PhishArmor AI flagged potential security issues with this sender.`;
                        }
                    }
                    // Final fallback
                    else {
                        return 'PhishArmor AI flagged potential security concerns with this sender.';
                    }
                } else {
                    // Good sender fallback
                    return '✅ PhishArmor AI verified this sender as legitimate.';
                }
            }
        },
        { 
            key: 'suspiciousLinks', 
            label: 'Safe Links',
            premiumFeatureKey: 'safe_link_checking',
            positiveIf: false,
            goodText: 'No malicious URLs',
            badText: 'Suspicious links found',
            threatLevel: 'high',
            getDetailText: (indicators, aiAnalysisDetails, isGood) => {
                if (indicators.suspiciousLinks?.reason) {
                    return `URL Analysis: ${indicators.suspiciousLinks.reason}`;
                }
                return isGood ? 'All URLs passed security checks.' : 'URLs flagged by security analysis.';
            }
        },
        { 
            key: 'urgentLanguage', 
            label: 'Urgency Check',
            premiumFeatureKey: null,
            positiveIf: false,
            goodText: 'No urgency detected',
            badText: 'Urgent language found',
            threatLevel: 'medium',
            getDetailText: (indicators, aiAnalysisDetails, isGood) => {
                if (!isGood && aiAnalysisDetails.urgentLanguageDetails) {
                    return aiAnalysisDetails.urgentLanguageDetails;
                }
                return isGood ? 'No urgent or threatening language detected.' : 'Urgent language patterns identified.';
            }
        },
        { 
            key: 'requestsSensitiveInfo', 
            label: 'Info Security',
            premiumFeatureKey: null,
            positiveIf: false,
            goodText: 'No data requests',
            badText: 'Requests sensitive info',
            threatLevel: 'medium',
            getDetailText: (indicators, aiAnalysisDetails, isGood) => {
                if (!isGood && aiAnalysisDetails.sensitiveInfoDetails) {
                    return aiAnalysisDetails.sensitiveInfoDetails;
                }
                return isGood ? 'No requests for sensitive information detected.' : 'Requests for sensitive information identified.';
            }
        },
        { 
            key: 'spellingMistakes', 
            label: 'Grammar Check',
            premiumFeatureKey: null,
            positiveIf: false,
            goodText: 'Good grammar',
            badText: 'Grammar issues found',
            threatLevel: 'low',
            getDetailText: (indicators, aiAnalysisDetails, isGood) => {
                if (!isGood && aiAnalysisDetails.grammarQualityDetails) {
                    return aiAnalysisDetails.grammarQualityDetails;
                }
                return isGood ? 'Good grammar and spelling detected.' : 'Grammar or spelling issues identified.';
            }
        }
    ];

    console.log("PhishArmor: generateIndicatorRows called with indicators:", indicators);
    console.log("PhishArmor: AI analysis details available:", aiAnalysisDetails);

    return indicatorConfigs.map((config, configIndex) => {
        const isLocked = config.premiumFeatureKey && tierFeatures[config.premiumFeatureKey] === false;

        if (isLocked) {
            return `
                <div style="display: flex; flex-direction: column;">
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; opacity: 0.7;">
                        <span style="font-weight: 500; color: #94a3b8; font-size: 13px;">${config.label}</span>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-size: 11px; color: #94a3b8;">Premium feature</span>
                            <div style="display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: #cbd5e1; color: white; font-size: 8px;">🔒</div>
                        </div>
                    </div>
                </div>
            `;
        }

        const isPresent = indicators[config.key] && indicators[config.key].present;
        const isGood = config.positiveIf ? isPresent : !isPresent;
        
        // Get detail text for this indicator
        const detailText = config.getDetailText(indicators, aiAnalysisDetails, isGood);
        const shouldShowDropdown = !isGood; // Only show dropdown when there are issues (flagged)
        
        // Dynamic icon and color based on threat level
        let iconColor, icon, backgroundColor, borderColor;
        
        if (isGood) {
            iconColor = '#22c55e';
            icon = '✓';
            backgroundColor = '#f0fdf4';
            borderColor = '#dcfce7';
        } else {
            if (config.threatLevel === 'high') {
                iconColor = '#ef4444';
                icon = '✕';
                backgroundColor = '#fef2f2';
                borderColor = '#fecaca';
            } else if (config.threatLevel === 'medium') {
                iconColor = '#f59e0b';
                icon = '⚠';
                backgroundColor = '#fffbeb';
                borderColor = '#fed7aa';
            } else {
                iconColor = '#eab308';
                icon = '⚠';
                backgroundColor = '#fefce8';
                borderColor = '#fde68a';
            }
        }
        
        const text = isGood ? config.goodText : config.badText;
        
        console.log(`PhishArmor: Indicator ${config.key}: isPresent=${isPresent}, isGood=${isGood}, shouldShowDropdown=${shouldShowDropdown}`);
        
        // For non-safe emails, auto-expand flagged indicators so users see the details immediately
        const isNonSafe = overallLevel !== 'safe';
        const autoExpand = shouldShowDropdown && isNonSafe;

        // Generate the dropdown content only if needed
        const dropdownContent = shouldShowDropdown ? `
            <div id="dropdown-${configIndex}" style="display: ${autoExpand ? 'block' : 'none'}; margin-top: 8px; padding: 10px; background: #f9fafb; border-radius: 4px; border-left: 3px solid ${iconColor}; border-top: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb;">
                <p style="margin: 0; font-size: 12px; color: #374151; line-height: 1.5;">${detailText}</p>
            </div>
        ` : '';
        
        return `
            <div style="display: flex; flex-direction: column;">
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: ${backgroundColor}; border-radius: 6px; border: 1px solid ${borderColor}; ${shouldShowDropdown ? 'cursor: pointer; transition: all 0.2s ease;' : ''}" 
                     ${shouldShowDropdown ? `data-dropdown-index="${configIndex}"` : ''}
                     ${shouldShowDropdown ? `onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'"` : ''}>
                    <span style="font-weight: 500; color: #374151; font-size: 13px;">${config.label}</span>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 11px; color: #6b7280;">${text}</span>
                        <div style="display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: ${iconColor}; color: white; font-size: 10px; font-weight: bold;">
                            ${icon}
                        </div>
                        ${shouldShowDropdown ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" style="transition: transform 0.2s ease; ${autoExpand ? 'transform: rotate(180deg);' : ''}" id="arrow-${configIndex}"><path d="M6 9l6 6 6-6"></path></svg>` : ''}
                    </div>
                </div>
                ${dropdownContent}
            </div>
        `;
    }).join('');
}

// Global function to toggle dropdowns within the tooltip
function toggleDropdown(index, tooltipElement) {
    const dropdown = tooltipElement.querySelector(`#dropdown-${index}`);
    const arrow = tooltipElement.querySelector(`#arrow-${index}`);
    
    if (dropdown && (dropdown.style.display === 'none' || dropdown.style.display === '')) {
        dropdown.style.display = 'block';
        if (arrow) arrow.style.transform = 'rotate(180deg)';
    } else if (dropdown) {
        dropdown.style.display = 'none';
        if (arrow) arrow.style.transform = 'rotate(0deg)';
    }
}

// Clean up function to remove shields from inappropriate locations (like inbox list)
function cleanupShieldsInInboxList() {
    // Remove shields that appear in the main inbox list view
    const inboxShields = document.querySelectorAll('.phisharmor-shield-icon');
    inboxShields.forEach(shield => {
        const isInOpenEmailToolbar = shield.closest('div[gh="mtb"]');
        const isInCurrentOpenEmail = isInOpenEmailToolbar && 
            document.querySelector('h2.hP') && // Email is currently open
            document.querySelector('div[gh="mtb"]'); // Toolbar exists
        
        // Remove shields that are NOT in the current open email's toolbar
        if (!isInCurrentOpenEmail) {
            console.log("PhishArmor: Removing shield from inbox list or old email");
            shield.remove();
        }
    });
}

// Observe for when an email's detail view becomes visible
function observeOpenEmailView() {
    const mainMailPanel = document.querySelector('div[role="main"]');
    if (!mainMailPanel) {
        console.warn("PhishArmor: Main mail panel not found for observing open emails. Retrying...");
        setTimeout(observeOpenEmailView, 3000);
        return;
    }

    console.log("PhishArmor: Observing for open email views.");
    
    // Store the last processed email to avoid duplicates
    let lastProcessedEmailId = null;
    let processingInProgress = false; // Prevent concurrent processing
    
    const observer = new MutationObserver((mutationsList, obs) => {
        // Skip if already processing
        if (processingInProgress) return;
        
        // Clean up any shields in inappropriate locations first
        cleanupShieldsInInboxList();
        
        // IMPROVED: More comprehensive detection for Gmail navigation
        const emailSubjectHeader = document.querySelector('h2.hP');
        const emailActionToolbar = document.querySelector('div[gh="mtb"]');

        if (emailSubjectHeader && emailActionToolbar) {
            // Create a more robust unique identifier
            const currentEmailId = generateCurrentEmailId();
            
            // Check if this is actually a new email or if shield is missing
            if (currentEmailId !== lastProcessedEmailId) {
                console.log("PhishArmor: NEW email detected, processing...", currentEmailId);
                processingInProgress = true;
                lastProcessedEmailId = currentEmailId;
                currentOpenEmailId = currentEmailId; // Set the global tracking variable
                
                // Clear any existing processed markers and cleanup old shields
                const allToolbars = document.querySelectorAll('div[gh="mtb"]');
                allToolbars.forEach(tb => delete tb.dataset.phisharmorProcessed);
                cleanupShieldsInInboxList(); // Additional cleanup when switching emails
                
                // Mark this toolbar as processed
                emailActionToolbar.dataset.phisharmorProcessed = currentEmailId;
                
                // Process the email
                let emailParentContainer = emailSubjectHeader.closest('div.acZ'); 
                if (!emailParentContainer) {
                    console.log("PhishArmor: Did not find div.acZ, falling back to div.nH for email container.");
                    emailParentContainer = emailSubjectHeader.closest('div.nH');
                }
                processOpenEmail(emailParentContainer, emailActionToolbar);
                
                // Reset processing flag after a delay
                setTimeout(() => { processingInProgress = false; }, 1000);
                
            } else if (currentEmailId && !emailActionToolbar.querySelector('.phisharmor-shield-icon')) {
                // Same email but shield is missing - re-inject without full processing
                console.log("PhishArmor: Shield missing for current email, re-injecting...");
                chrome.storage.local.get([`emailScore_${currentEmailId}`], function(result) {
                    if (result[`emailScore_${currentEmailId}`]) {
                        injectShieldIconOpenView(currentEmailId, result[`emailScore_${currentEmailId}`].scoreDetails, emailActionToolbar);
                    } else {
                        injectShieldIconOpenView(currentEmailId, { level: 'loading' }, emailActionToolbar);
                    }
                });
            }
        } else {
            // No email is open, reset state and clean up all shields
            if (lastProcessedEmailId) {
                console.log("PhishArmor: No email open, resetting state and cleaning up shields.");
                lastProcessedEmailId = null;
                currentOpenEmailId = null; // Clear the global tracking variable
                processingInProgress = false;
                removeDynamicTooltip();
                cleanupShieldsInInboxList(); // Clean up when going back to inbox
            }
        }
    });

    // IMPROVED: Less aggressive observation to reduce noise
    observer.observe(document.body, { 
        childList: true, 
        subtree: true, 
        attributes: false // Reduced attribute watching to prevent excessive firing
    });
}

// Helper function to generate current email ID more reliably
function generateCurrentEmailId() {
    // Try multiple methods to get a stable email ID
    const dataLegacyElements = document.querySelectorAll('[data-legacy-message-id]');
    if (dataLegacyElements.length > 0) {
        return dataLegacyElements[dataLegacyElements.length - 1].getAttribute('data-legacy-message-id');
    }
    
    if (window.location.hash.includes('/')) {
        const potentialId = window.location.hash.substring(window.location.hash.lastIndexOf('/') + 1);
        if (potentialId.length > 15 && /[a-zA-Z0-9]/.test(potentialId)) {
            return potentialId;
        }
    }
    
    // Fallback: create ID from subject and URL
    const subjectElement = document.querySelector('h2.hP');
    const subject = subjectElement ? subjectElement.innerText : '';
    const urlPart = window.location.hash.substring(0, 20);
    return `phisharmor-${btoa(subject + urlPart).substring(0, 20)}`;
}

function processOpenEmail(emailContainer, emailActionToolbar) {
    if (!emailActionToolbar) {
        console.warn("PhishArmor: Action toolbar not found for processing.");
        return;
    }

    let emailId = null;
    // Try to find email ID from various sources in the document, not just the container
    const dataLegacyElements = document.querySelectorAll('[data-legacy-message-id]');
    if (dataLegacyElements.length > 0) {
        // Use the last one, which is usually the currently open email
        emailId = dataLegacyElements[dataLegacyElements.length - 1].getAttribute('data-legacy-message-id');
    } else if (window.location.hash.includes('/')) {
        const potentialId = window.location.hash.substring(window.location.hash.lastIndexOf('/') + 1);
        if (potentialId.length > 15 && /[a-zA-Z0-9]/.test(potentialId)) {
            emailId = potentialId;
        }
    }

    // Get subject from the known subject header element
    const subjectElement = document.querySelector('h2.hP');
    if (!subjectElement) {
        console.warn("PhishArmor: Subject element not found.");
        return;
    }

    // Fallback ID generation if no data-legacy-message-id found
    if (!emailId) {
        emailId = generateCurrentEmailId();
    }

    console.log("PhishArmor: Processing email with ID:", emailId);

    // Set the current open email ID for shield updates
    currentOpenEmailId = emailId;

    // Check if we already have a stored score for this email (check both new and legacy cache keys)
    const cacheKey = `emailCache_${emailId}`;
    const legacyKey = `emailScore_${emailId}`;
    chrome.storage.local.get([cacheKey, legacyKey], function(result) {
        if (chrome.runtime.lastError) {
            console.error("PhishArmor: Storage access error:", chrome.runtime.lastError.message);
            return;
        }

        // Check new cache format first, then legacy
        const cachedEntry = result[cacheKey];
        const legacyEntry = result[legacyKey];
        const cached = cachedEntry ? cachedEntry.result : (legacyEntry ? legacyEntry.scoreDetails : null);

        if (cached && cached.level && cached.level !== 'error') {
            console.log("PhishArmor: Found existing score for:", emailId);
            injectShieldIconOpenView(emailId, cached, emailActionToolbar);
        } else {
            console.log("PhishArmor: No score for open email ID:", emailId, ". Extracting data globally.");
            // Inject loading shield first
            injectShieldIconOpenView(emailId, { level: 'loading' }, emailActionToolbar);

            // Now extract email data - try multiple approaches for robustness
            const extractedEmailData = extractEmailDataFromDOM(emailId, subjectElement);
            if (!extractedEmailData) {
                console.error("PhishArmor: Failed to extract email data for ID:", emailId);
                return;
            }

            console.log("PhishArmor: Extracted email data:", {
                id: extractedEmailData.id,
                sender: extractedEmailData.sender,
                subject: extractedEmailData.subject,
                bodyLength: extractedEmailData.bodyText?.length || 0
            });

            console.log("PhishArmor: Sending open email data to background for analysis:", emailId);
            console.time(`PhishArmor Analysis ${emailId}`);
            
            // DEBUG: Add extensive logging for message sending
            console.log("PhishArmor: About to send analyzeEmail message to background script");
            console.log("PhishArmor: Message payload:", {
                action: "analyzeEmail",
                emailDataId: extractedEmailData.id,
                emailDataKeys: Object.keys(extractedEmailData),
                emailDataSender: extractedEmailData.sender,
                emailDataSubject: extractedEmailData.subject
            });
            
            // Add triggerType for auto-triggered analysis
            const emailDataWithTrigger = { ...extractedEmailData, triggerType: 'auto' };
            
            chrome.runtime.sendMessage({
                action: "analyzeEmail",
                emailData: emailDataWithTrigger
            }, function(response) {
                console.timeEnd(`PhishArmor Analysis ${emailId}`);
                console.log("PhishArmor: Background script response:", response);
                console.log("PhishArmor: Chrome runtime last error:", chrome.runtime.lastError);
                
                if (chrome.runtime.lastError) {
                    console.error("PhishArmor: Error sending message to background:", chrome.runtime.lastError.message);
                    return;
                }
                
                if (response && response.status === "received") {
                    console.log("PhishArmor: Background script acknowledged email data for:", response.emailId);
                } else {
                    console.warn("PhishArmor: Unexpected response from background script:", response);
                }
            });
        }
    });
}

// Extract email data from DOM with multiple fallback strategies
function extractEmailDataFromDOM(emailId, subjectElement) {
    console.log("PhishArmor: Starting extractEmailDataFromDOM for:", emailId);
    
    // Get subject
    const subject = subjectElement ? subjectElement.innerText : 'No Subject';
    console.log("PhishArmor Extracted Subject:", subject);

    // GLOBAL EMAIL SENDER EXTRACTION
    let sender = 'Unknown Sender';
    
    // Try multiple approaches to find sender information globally
    let senderElement = document.querySelector('span.gD[email]');
    if (!senderElement) {
        senderElement = document.querySelector('div.gE.iv.gt span[email]');
    }
    if (!senderElement) {
        senderElement = document.querySelector('[data-hovercard-id*="@"]');
    }
    
    if (senderElement) {
        const senderName = senderElement.getAttribute('name') || senderElement.innerText;
        const senderEmail = senderElement.getAttribute('email') || senderElement.getAttribute('data-hovercard-id');
        if (senderEmail) {
            sender = senderName && senderName !== senderEmail ? `${senderName} <${senderEmail}>` : senderEmail;
        }
    }

    console.log("PhishArmor Extracted Sender (global):", sender);

    // GLOBAL EMAIL BODY EXTRACTION
    let bodyText = '';
    let bodyHtml = '';
    
    // Try multiple global approaches to find email body content
    let emailBodyElement = null;
    
    // Approach 1: Look for the main content area that's currently visible and substantial
    const candidateBodyElements = [
        ...document.querySelectorAll('div.a3s.aiL:not([role="button"]):not([data-tooltip])'),
        ...document.querySelectorAll('div.ii.gt'),
        ...document.querySelectorAll('div[role="article"]'),
        ...document.querySelectorAll('div.adn.ads'),
        ...document.querySelectorAll('div[jsname="A5qFtc"]'),
        ...document.querySelectorAll('table[role="presentation"]'),
        ...document.querySelectorAll('[data-legacy-message-id] div')
    ];

    // Filter to find the most likely email body element
    emailBodyElement = candidateBodyElements.find(el => {
        if (!el || !el.offsetParent) return false; // Skip hidden elements
        const text = el.innerText || el.textContent || '';
        const height = el.offsetHeight;
        // Look for elements with substantial text content and reasonable height
        return text.length > 100 && height > 50 && text.length < 50000; // reasonable bounds
    });

    if (!emailBodyElement && candidateBodyElements.length > 0) {
        // Fallback: use the largest candidate by text content
        emailBodyElement = candidateBodyElements.reduce((largest, current) => {
            if (!current || !current.offsetParent) return largest;
            const currentText = (current.innerText || '').length;
            const largestText = largest ? (largest.innerText || '').length : 0;
            return currentText > largestText ? current : largest;
        }, null);
    }

    if (emailBodyElement) {
        console.log("PhishArmor Found body element (global approach):", emailBodyElement);
        bodyHtml = emailBodyElement.innerHTML;
        const bodyClone = emailBodyElement.cloneNode(true);
        // Enhanced cleanup
        bodyClone.querySelectorAll('div.ajR, div.ajT, button, style, script, .gmail_signature, [data-smartmail="gmail_signature"], .yj6qo, .adL, div.ado, .bHJ, .hj').forEach(el => el.remove());
        bodyText = bodyClone.innerText || bodyClone.textContent || '';
        console.log("PhishArmor Extracted Body Text (global, snippet):", bodyText.substring(0, 200));
    } else {
        console.warn("PhishArmor: Global body element search failed.");
        console.log("PhishArmor DEBUG: Found", candidateBodyElements.length, "candidate elements, but none met criteria.");
    }

    if (!subject && !bodyText.trim() && !bodyHtml.trim()) {
        console.error("PhishArmor: Insufficient email data extracted — no subject or body found");
        return null;
    }

    // Always return data even if body is empty — backend has safe defaults
    return {
        id: emailId,
        sender: sender || 'unknown@unknown.com',
        subject: subject || '(No subject)',
        bodyText: (bodyText || '').substring(0, 8000),
        bodyHtml: (bodyHtml || '').substring(0, 15000)
    };
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "updateShield") {
        console.log("PhishArmor (Content): Received updateShield message:", message);
        
        // Log debug information from background script if present
        if (message.scoreDetails && message.scoreDetails.debugInfo) {
            console.log("=== PhishArmor API Debug Information ===");
            console.log("Timestamp:", message.scoreDetails.debugInfo.timestamp);
            
            // Web Risk Debug Info
            if (message.scoreDetails.debugInfo.webRisk) {
                console.log("🔗 Google Web Risk Response:");
                if (message.scoreDetails.debugInfo.webRisk.error) {
                    console.log("  Error:", message.scoreDetails.debugInfo.webRisk.error);
                } else {
                    console.log("  Full Response:", message.scoreDetails.debugInfo.webRisk);
                    console.log("  URLs Found:", message.scoreDetails.debugInfo.webRisk.totalUrls);
                    console.log("  URLs Checked:", message.scoreDetails.debugInfo.webRisk.checkedUrls);
                    console.log("  Threats Detected:", message.scoreDetails.debugInfo.webRisk.threats?.length || 0);
                    console.log("  Has Threats:", message.scoreDetails.debugInfo.webRisk.hasThreats);
                    if (message.scoreDetails.debugInfo.webRisk.threats && message.scoreDetails.debugInfo.webRisk.threats.length > 0) {
                        console.log("  Threat Details:", message.scoreDetails.debugInfo.webRisk.threats);
                    }
                    if (message.scoreDetails.debugInfo.webRisk.urlDetails) {
                        console.log("  Individual URL Results:", message.scoreDetails.debugInfo.webRisk.urlDetails);
                    }
                }
            } else {
                console.log("🔗 Google Web Risk: Not checked");
            }
            
            // APIVoid Domain Reputation Debug Info
            if (message.scoreDetails.debugInfo.senderReputation) {
                console.log("🔍 APIVoid Sender Reputation:");
                if (message.scoreDetails.debugInfo.senderReputation.error) {
                    console.log("  Error:", message.scoreDetails.debugInfo.senderReputation.error);
                } else {
                    console.log("  Full Analysis:", message.scoreDetails.debugInfo.senderReputation);
                    console.log("  Is Suspicious:", message.scoreDetails.debugInfo.senderReputation.isSuspicious);
                    console.log("  Reasons:", message.scoreDetails.debugInfo.senderReputation.reasons);
                    
                    if (message.scoreDetails.debugInfo.senderReputation.domainReputationCheck) {
                        const domainCheck = message.scoreDetails.debugInfo.senderReputation.domainReputationCheck;
                        console.log("  📊 Domain Reputation Details:");
                        console.log("    Is Reputation Good:", domainCheck.isReputationGood);
                        console.log("    Risk Score:", domainCheck.riskScore + "/100");
                        console.log("    Detections:", domainCheck.detections);
                        console.log("    Risk Factors:", domainCheck.riskFactors);
                        console.log("    Reason:", domainCheck.reason);
                        
                        if (domainCheck.corsBlocked) {
                            console.log("    ⚠️ CORS Blocked: API call was blocked by browser security policy");
                        }
                        
                        if (domainCheck.apiResponse) {
                            console.log("  📋 Full APIVoid Response:");
                            console.log("    Raw Response:", domainCheck.apiResponse);
                            
                            // Break down key sections for easier reading
                            if (domainCheck.apiResponse.blacklists) {
                                console.log("    🛡️ Blacklist Analysis:");
                                console.log("      Engines Count:", domainCheck.apiResponse.blacklists.engines_count);
                                console.log("      Detections:", domainCheck.apiResponse.blacklists.detections);
                                console.log("      Detection Rate:", domainCheck.apiResponse.blacklists.detection_rate);
                                
                                if (domainCheck.apiResponse.blacklists.engines && domainCheck.apiResponse.blacklists.detections > 0) {
                                    console.log("      Detected By:");
                                    Object.values(domainCheck.apiResponse.blacklists.engines).forEach(engine => {
                                        if (engine.detected) {
                                            console.log(`        - ${engine.name}: ${engine.detected} (confidence: ${engine.confidence})`);
                                        }
                                    });
                                }
                            }
                            
                            if (domainCheck.apiResponse.server_details) {
                                console.log("    🌐 Server Details:");
                                console.log("      IP:", domainCheck.apiResponse.server_details.ip);
                                console.log("      ISP:", domainCheck.apiResponse.server_details.isp);
                                console.log("      Country:", domainCheck.apiResponse.server_details.country_name);
                                console.log("      ASN:", domainCheck.apiResponse.server_details.asn);
                            }
                            
                            if (domainCheck.apiResponse.security_checks) {
                                console.log("    🔒 Security Checks:");
                                const checks = domainCheck.apiResponse.security_checks;
                                console.log("      Domain Blacklisted:", checks.is_domain_blacklisted);
                                console.log("      Most Abused TLD:", checks.is_most_abused_tld);
                                console.log("      Website Popularity:", checks.website_popularity);
                                console.log("      Risky Category:", checks.is_risky_category);
                                
                                if (checks.domain_age_in_days !== undefined) {
                                    console.log("      Domain Age:", checks.domain_age_in_days + " days (" + checks.domain_age_in_years + " years)");
                                    console.log("      Recently Created:", checks.is_domain_recent);
                                    console.log("      Very Recently Created:", checks.is_domain_very_recent);
                                }
                            }
                            
                            if (domainCheck.apiResponse.category) {
                                console.log("    📂 Category Analysis:");
                                const category = domainCheck.apiResponse.category;
                                console.log("      Free Hosting:", category.is_free_hosting);
                                console.log("      Anonymizer:", category.is_anonymizer);
                                console.log("      URL Shortener:", category.is_url_shortener);
                                console.log("      Free Dynamic DNS:", category.is_free_dynamic_dns);
                                console.log("      Code Sandbox:", category.is_code_sandbox);
                                console.log("      Form Builder:", category.is_form_builder);
                                console.log("      Free File Sharing:", category.is_free_file_sharing);
                                console.log("      Pastebin:", category.is_pastebin);
                            }
                            
                            if (domainCheck.apiResponse.risk_score) {
                                console.log("    ⚠️ Final Risk Score:", domainCheck.apiResponse.risk_score.result + "/100");
                            }
                        }
                    } else {
                        console.log("🔍 APIVoid Sender Reputation: Not checked");
                    }
            
                    // OpenAI Debug Info
                    if (message.scoreDetails.debugInfo.openAI) {
                        console.log("🤖 OpenAI Response:");
                        if (message.scoreDetails.debugInfo.openAI.error) {
                            console.log("  Error:", message.scoreDetails.debugInfo.openAI.error);
                        } else {
                            console.log("  Full Response:", message.scoreDetails.debugInfo.openAI);
                            if (message.scoreDetails.debugInfo.openAI.choices && message.scoreDetails.debugInfo.openAI.choices[0]) {
                                console.log("  AI Analysis:", message.scoreDetails.debugInfo.openAI.choices[0].message.content);
                            }
                            if (message.scoreDetails.debugInfo.openAI.usage) {
                                console.log("  Token Usage:", message.scoreDetails.debugInfo.openAI.usage);
                            }
                        }
                    } else {
                        console.log("🤖 OpenAI: Not checked");
                    }
            
                    console.log("=== End Debug Information ===");
                }
            } else {
                console.log("🔍 APIVoid Sender Reputation: Not checked");
            }
            
            // OpenAI Debug Info
            if (message.scoreDetails.debugInfo.openAI) {
                console.log("🤖 OpenAI Response:");
                if (message.scoreDetails.debugInfo.openAI.error) {
                    console.log("  Error:", message.scoreDetails.debugInfo.openAI.error);
                } else {
                    console.log("  Full Response:", message.scoreDetails.debugInfo.openAI);
                    if (message.scoreDetails.debugInfo.openAI.choices && message.scoreDetails.debugInfo.openAI.choices[0]) {
                        console.log("  AI Analysis:", message.scoreDetails.debugInfo.openAI.choices[0].message.content);
                    }
                    if (message.scoreDetails.debugInfo.openAI.usage) {
                        console.log("  Token Usage:", message.scoreDetails.debugInfo.openAI.usage);
                    }
                }
            } else {
                console.log("🤖 OpenAI: Not checked");
            }
            
            console.log("=== End Debug Information ===");
        }
        
        if (message.emailId === currentOpenEmailId) { // currentOpenEmailId refers to the main email view
            // Try processed toolbar first, then fall back to any visible toolbar
            let emailActionToolbar = document.querySelector('div[gh="mtb"][data-phisharmor-processed]');
            if (!emailActionToolbar) {
                emailActionToolbar = document.querySelector('div[gh="mtb"]');
                if (emailActionToolbar) {
                    // Re-mark it as processed since Gmail may have re-rendered the toolbar
                    emailActionToolbar.dataset.phisharmorProcessed = message.emailId;
                    console.log("PhishArmor (Content): Re-marked toolbar as processed after Gmail re-render");
                }
            }
            if (emailActionToolbar) {
                injectShieldIconOpenView(message.emailId, message.scoreDetails, emailActionToolbar);
                // If this update is for the email whose tooltip is currently open, refresh the tooltip
                if (phishArmorDynamicTooltip && message.emailId === currentOpenEmailIdForTooltip) {
                    populateDynamicTooltip(phishArmorDynamicTooltip, message.scoreDetails, message.emailId);
                }
                sendResponse({status: "shieldUpdated_ack_content_open_email"});
            } else {
                console.warn("PhishArmor (Content): updateShield toolbar not found. ID:", message.emailId);
                sendResponse({status: "error_toolbar_not_found_for_current_open_email"});
            }
        } else {
            console.log("PhishArmor (Content): updateShield ignored, ID mismatch. Msg ID:", message.emailId, "Current ID:", currentOpenEmailId);
            sendResponse({status: "shieldUpdate_ignored_id_mismatch_or_not_open"});
        }
        return true; 

    } else if (message.action === "closeTooltipInTab") { // From background, perhaps for a different reason now
        // This message might be less relevant if tooltip has its own close button,
        // but can be kept if background needs to force-close.
        removeDynamicTooltip();
        console.log("PhishArmor (Content): Dynamic tooltip closed by background's request.");
        sendResponse({status: "tooltipClosed_ack_content"});
        return true;
    }
    // Removed redundant return true from here, each branch should manage its own if async.
});


// Initial setup when the content script loads
function init() {
    console.log("PhishArmor initializing content script for:", window.location.hostname);
    
    // Test message to verify background script communication
    console.log("PhishArmor: Testing background script communication...");
    chrome.runtime.sendMessage({ action: "test", message: "Content script loaded" }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("PhishArmor: Failed to communicate with background script:", chrome.runtime.lastError.message);
        } else {
            console.log("PhishArmor: Background script communication test successful:", response);
        }
    });
    
    getCurrentTabId(tabId => {
        if(tabId) console.log("PhishArmor: Content script running in tab ID:", tabId);
    });

    if (window.location.hostname.includes("mail.google.com")) {
        const readyInterval = setInterval(() => {
            if (document.querySelector('div[role="main"]')) {
                clearInterval(readyInterval);
                observeOpenEmailView();
                console.log("PhishArmor: Gmail interface ready, observation started.");
            }
        }, 500);
    } else if (window.location.hostname.includes("outlook.live.com") || window.location.hostname.includes("outlook.office.com")) {
        console.log("Outlook detected, specific observation logic to be implemented for open emails.");
    } else if (window.location.hostname.includes("mail.yahoo.com")) {
        console.log("Yahoo Mail detected, specific observation logic to be implemented for open emails.");
    }
}

if (window.self === window.top) {
    if (document.readyState === "complete" || document.readyState === "interactive") {
        init();
    } else {
        document.addEventListener("DOMContentLoaded", init);
    }
} else {
  console.log("PhishArmor content script not initializing in iframe:", window.location.href);
}

// Helper function to test APIVoid integration from console
window.testPhishArmorAPIVoid = function() {
    console.log("PhishArmor: Testing APIVoid integration...");
    chrome.runtime.sendMessage({ action: "testAPIVoid" }, function(response) {
        if (chrome.runtime.lastError) {
            console.error("PhishArmor: Error testing APIVoid:", chrome.runtime.lastError.message);
        } else {
            console.log("PhishArmor: APIVoid test response:", response);
        }
    });
};

// Helper function to test sender reputation workflow from console
window.testPhishArmorSenderReputation = function() {
    console.log("PhishArmor: Testing sender reputation workflow...");
    chrome.runtime.sendMessage({ action: "testSenderReputation" }, function(response) {
        if (chrome.runtime.lastError) {
            console.error("PhishArmor: Error testing sender reputation:", chrome.runtime.lastError.message);
        } else {
            console.log("PhishArmor: Sender reputation test response:", response);
        }
    });
};

// Helper function to test the new focused OpenAI prompt from console
window.testPhishArmorFocusedPrompt = function() {
    console.log("PhishArmor: Testing focused OpenAI prompt...");
    chrome.runtime.sendMessage({ action: "testFocusedPrompt" }, function(response) {
        if (chrome.runtime.lastError) {
            console.error("PhishArmor: Error testing focused prompt:", chrome.runtime.lastError.message);
        } else {
            console.log("PhishArmor: Focused prompt test response:", response);
        }
    });
};

// Test balanced risk assessment algorithm
window.testPhishArmorRiskAssessment = function() {
    console.log("PhishArmor: Testing balanced risk assessment algorithm...");
    chrome.runtime.sendMessage({ action: "testRiskAssessment" }, function(response) {
        if (chrome.runtime.lastError) {
            console.error("PhishArmor: Error testing risk assessment:", chrome.runtime.lastError.message);
        } else {
            console.log("PhishArmor: Risk assessment test response:", response);
        }
    });
};

console.log("PhishArmor: Console helpers loaded. Use testPhishArmorAPIVoid(), testPhishArmorSenderReputation(), testPhishArmorFocusedPrompt(), or testPhishArmorRiskAssessment() to test."); 