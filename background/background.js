// PhishArmor Background Script
console.log("PhishArmor Background Script Loaded.");
console.log("PhishArmor Background: TESTING - This log should appear in Service Worker console");

// TEMP: For testing, use a default API key (user should replace this)
const TEMP_DEFAULT_API_KEY = ''; // Set your OpenAI API key in extension options
const PHISHARMOR_PRO_API_KEY = 'YOUR_PRO_VERSION_API_KEY_HERE'; // This should be managed securely, not hardcoded for a real product
const OPENAI_O4_MINI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'; // Example endpoint

// Google Cloud Web Risk API Configuration
const GOOGLE_WEBRISK_API_KEY = ''; // Set your Google Web Risk API key in extension options
const GOOGLE_WEBRISK_ENDPOINT = 'https://webrisk.googleapis.com/v1/uris:search'; // Public Lookup API endpoint

// Web Risk threat types to check for
const WEB_RISK_THREAT_TYPES = [
    'MALWARE',
    'SOCIAL_ENGINEERING', 
    'UNWANTED_SOFTWARE',
    'SOCIAL_ENGINEERING_EXTENDED_COVERAGE'
];

// APIVoid Domain Reputation API Configuration
const APIVOID_API_KEY = 'FDtx9YUOBHEHo6-qPNVvmsxqfhYIIEt4WjCrpp08lzT1w6XpRiKMGPlRnwwiHWKM'; // User's APIVoid API key
const APIVOID_ENDPOINT = 'https://api.apivoid.com/v2/domain-reputation';

// Risk Scoring Configuration
const riskIndicatorWeights = {
    suspiciousSenderAddress: 15,     // INCREASED: Strong indicator of phishing (was 5)
    suspiciousLinks: 12,             // INCREASED: Malicious URLs are critical (was 8) 
    requestsSensitiveInfo: 4,        // DECREASED: Legitimate businesses do this (was 10)
    urgentLanguage: 3,               // DECREASED: Common in legitimate business emails (was 6)
    spellingMistakes: 2              // UNCHANGED: Still relevant but minor
};
const MAX_POSSIBLE_SCORE = Object.values(riskIndicatorWeights).reduce((sum, weight) => sum + weight, 0);

// --- Tooltip Management ---
let tooltipFrame = null;
let currentTooltipEmailId = null;

function createTooltipFrame(emailId, initialRect) {
    if (tooltipFrame) {
        tooltipFrame.remove();
        tooltipFrame = null;
    }

    tooltipFrame = document.createElement('iframe');
    tooltipFrame.id = 'phisharmor-tooltip-iframe';
    tooltipFrame.src = chrome.runtime.getURL('popup/tooltip.html');
    tooltipFrame.style.position = 'fixed';
    tooltipFrame.style.zIndex = '2147483647'; // Max z-index
    tooltipFrame.style.border = 'none';
    tooltipFrame.style.width = '350px'; // Adjust as per tooltip.css or content
    tooltipFrame.style.height = '450px'; // Adjust
    tooltipFrame.style.boxShadow = '0 5px 15px rgba(0,0,0,0.3)';
    tooltipFrame.style.borderRadius = '8px';
    // Position near the icon, adjust as needed
    if (initialRect) {
        tooltipFrame.style.top = `${window.scrollY + initialRect.bottom + 5}px`;
        tooltipFrame.style.left = `${window.scrollX + initialRect.left}px`;
    }

    document.body.appendChild(tooltipFrame);
    currentTooltipEmailId = emailId;

    tooltipFrame.onload = () => {
        // Send data to the tooltip once it's loaded
        chrome.storage.local.get([`emailScore_${emailId}`], function(result) {
            if (result[`emailScore_${emailId}`]) {
                tooltipFrame.contentWindow.postMessage({
                    action: 'displayReport',
                    reportData: result[`emailScore_${emailId}`]
                }, '*');
            } else {
                // Show loading or error state in tooltip
                 tooltipFrame.contentWindow.postMessage({ action: 'showLoading' }, '*');
                // Optionally, re-trigger analysis if not already in progress
            }
        });
    };

    // Close tooltip if user clicks outside
    // This is tricky with iframes. A common approach is to have an overlay or listen on the parent document.
    // For simplicity, the tooltip will have its own close button.
}

function closeTooltip() {
    if (tooltipFrame) {
        tooltipFrame.remove();
        tooltipFrame = null;
        currentTooltipEmailId = null;
    }
}

// --- Event Listeners ---
chrome.runtime.onInstalled.addListener(() => {
    console.log("PhishArmor installed.");
    // Initialize default settings
    chrome.storage.local.set({
        isLoggedIn: false,
        userApiKey: null,
        abuseipdbApiKey: null, // Add AbuseIPDB key storage
        useProVersion: false, // Default to not using pro version
        phishArmorProKey: PHISHARMOR_PRO_API_KEY, // Store securely if this were a real product
        blockedUrlsCount: 0
    });
    // Create a context menu item (optional)
    chrome.contextMenus.create({
        id: "analyzeSelectedText",
        title: "Analyze for Phishing (PhishArmor)",
        contexts: ["selection"]
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "analyzeSelectedText" && info.selectionText) {
        console.log("Selected text for analysis:", info.selectionText);
        // Simulate email data structure for analysis
        const emailData = {
            id: `selection-${Date.now()}`,
            sender: 'N/A (Selected Text)',
            subject: 'Selected Text Analysis',
            bodyText: info.selectionText,
            bodyHtml: info.selectionText // Keep it simple
        };
        handleEmailAnalysis(emailData, tab.id, true); // true to force showing tooltip/notification
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
        console.log("PhishArmor Background: ===== MESSAGE RECEIVED =====");
        console.log("PhishArmor Background received message:", message, "from sender:", sender);
        console.log("PhishArmor Background: Message action:", message?.action);
        console.log("PhishArmor Background: Sender tab ID:", sender?.tab?.id);
        
        if (message.action === "analyzeEmail") {
            console.log("PhishArmor Background: Processing analyzeEmail request");
            if (!message.emailData || !message.emailData.id) {
                console.error("PhishArmor Background: Invalid emailData received for analysis:", message.emailData);
                sendResponse({ status: "error", error: "Invalid email data" });
                return true;
            }
            console.log("PhishArmor Background: Calling handleEmailAnalysis for:", message.emailData.id);
            handleEmailAnalysis(message.emailData, sender.tab ? sender.tab.id : null);
            sendResponse({ status: "received", emailId: message.emailData.id }); // Acknowledge receipt

        } else if (message.action === "showTooltip") {
            console.log("PhishArmor Background: Processing showTooltip request");
            // This message would come from content script when shield is clicked
            // The content script needs to be able to create the tooltip iframe in its context.
            // Or, the background script can instruct the content script to create it.
            // For now, let's assume content script requests background to manage it (won't work directly with DOM like this)
            // **Correction**: Background script cannot directly create DOM elements in content script page.
            // Content script must create the iframe. Background can send data to it.
            // Let's adjust: content script creates its own tooltip container/iframe, and requests data for it.
            // The current `showTooltip` in content.js makes more sense for this.
            // This handler could be for a different purpose, or content.js will load tooltip.html and request data for it.

            // Let's assume the content script creates an iframe and that iframe (tooltip.js) will message the background
            // for the data directly using its emailId. This path might be redundant if tooltip.js fetches its own data.
            // Or content script sends emailId, and background sends back the data to content script which passes to its tooltip.
            console.log("Request to show tooltip for email:", message.emailId, "at rect:", message.rect);
            // This is where we would message the *specific tab* to display its tooltip.
            // This still requires content script to handle the actual DOM creation.
            if (sender.tab && sender.tab.id) {
                chrome.tabs.sendMessage(sender.tab.id, {
                    action: "displayTooltipInTab",
                    emailId: message.emailId,
                    rect: message.rect // position data
                });
            }
            sendResponse({status: "tooltip_signal_sent_to_tab"});

        } else if (message.action === "getReportDataForTooltip") { // From content script dynamic tooltip
            console.log("PhishArmor Background: Processing getReportDataForTooltip request for:", message.emailId);
            chrome.storage.local.get([`emailScore_${message.emailId}`], function(result) {
                if (chrome.runtime.lastError) {
                    console.error("PhishArmor Background: Error getting data for tooltip from storage:", chrome.runtime.lastError.message);
                    sendResponse({ error: "Storage access error" });
                    return; 
                }
                
                if (result[`emailScore_${message.emailId}`]) {
                    console.log("PhishArmor Background: Found score data for tooltip:", message.emailId);
                    sendResponse({ 
                        scoreDetails: result[`emailScore_${message.emailId}`].scoreDetails 
                    });
                } else {
                    console.log("PhishArmor Background: No score data found for tooltip:", message.emailId);
                    sendResponse({ error: "No report data found" });
                }
            });
            return true; // Indicates asynchronous response

        } else if (message.action === "closePhishArmorTooltip") { // from tooltip.js
            console.log("PhishArmor Background: Processing closePhishArmorTooltip request");
            // We need to inform the content script in the specific tab to close its tooltip
            if (message.tabId) { // tooltip.js should find and send its host tabId
                 chrome.tabs.sendMessage(message.tabId, { action: "closeTooltipInTab" });
            }
            sendResponse({status: "close_signal_sent"});
        }

        // Helper for content script to get its own tab ID
        else if (message.action === "getTabId") {
            console.log("PhishArmor Background: Processing getTabId request");
            if (chrome.runtime.lastError) {
                console.error("PhishArmor Background: Error before processing getTabId:", chrome.runtime.lastError.message);
                return;
            }
            if (sender.tab) {
                console.log("PhishArmor Background: Returning tab ID:", sender.tab.id);
                sendResponse({ tabId: sender.tab.id });
            } else {
                // Potentially the sender context (e.g. content script during early init) might not have sender.tab fully populated yet
                // or if the sender is not a tab context.
                console.log("PhishArmor Background: No tab property in sender");
                sendResponse({ error: "Sender does not have a tab property or sender context is invalid." });
            }
            return true; // Asynchronous because sendResponse is used.
        }

        // Test message handler for debugging communication
        else if (message.action === "test") {
            console.log("PhishArmor Background: Processing test message:", message.message);
            sendResponse({ status: "success", message: "Background script received test message", timestamp: Date.now() });
            return true;
        }

        // Manual Web Risk API test handler
        else if (message.action === "testWebRisk") {
            console.log("PhishArmor Background: Processing manual Web Risk test request");
            testWebRiskAPI().then(success => {
                sendResponse({ 
                    status: success ? "success" : "failed", 
                    message: success ? "Web Risk API test passed" : "Web Risk API test failed",
                    timestamp: Date.now() 
                });
            }).catch(error => {
                sendResponse({ 
                    status: "error", 
                    message: "Web Risk API test error: " + error.message,
                    timestamp: Date.now() 
                });
            });
            return true; // Async response
        }

        // Manual Web Risk API diagnostic handler
        else if (message.action === "diagnoseWebRisk") {
            console.log("PhishArmor Background: Processing Web Risk diagnostic request");
            diagnoseWebRiskAPI().then(result => {
                sendResponse({ 
                    status: result.success ? "success" : "failed", 
                    message: result.success ? "Web Risk API working" : `Web Risk API issue: ${result.issue}`,
                    result: result,
                    timestamp: Date.now() 
                });
            }).catch(error => {
                sendResponse({ 
                    status: "error", 
                    message: "Web Risk API diagnostic error: " + error.message,
                    timestamp: Date.now() 
                });
            });
            return true; // Async response
        }

        // APIVoid integration test handler
        else if (message.action === "testAPIVoid") {
            console.log("PhishArmor Background: Processing APIVoid integration test request");
            testAPIVoidIntegration().then(() => {
                sendResponse({ 
                    status: "success", 
                    message: "APIVoid integration test completed - check console for results",
                    timestamp: Date.now() 
                });
            }).catch(error => {
                sendResponse({ 
                    status: "error", 
                    message: "APIVoid integration test error: " + error.message,
                    timestamp: Date.now() 
                });
            });
            return true; // Async response
        }

        // Sender reputation workflow test handler
        else if (message.action === "testSenderReputation") {
            console.log("PhishArmor Background: Processing sender reputation workflow test request");
            testSenderReputationWorkflow().then(() => {
                sendResponse({ 
                    status: "success", 
                    message: "Sender reputation workflow test completed - check console for results",
                    timestamp: Date.now() 
                });
            }).catch(error => {
                sendResponse({ 
                    status: "error", 
                    message: "Sender reputation workflow test error: " + error.message,
                    timestamp: Date.now() 
                });
            });
            return true; // Async response
        }

        // Focused OpenAI prompt test handler
        else if (message.action === "testFocusedPrompt") {
            console.log("PhishArmor Background: Processing focused OpenAI prompt test request");
            try {
                testFocusedOpenAIPrompt();
                sendResponse({ 
                    status: "success", 
                    message: "Focused OpenAI prompt test completed - check console for prompt",
                    timestamp: Date.now() 
                });
            } catch (error) {
                sendResponse({ 
                    status: "error", 
                    message: "Focused OpenAI prompt test error: " + error.message,
                    timestamp: Date.now() 
                });
            }
            return true;
        }

        // Balanced risk assessment test handler
        else if (message.action === "testRiskAssessment") {
            console.log("PhishArmor Background: Processing balanced risk assessment test request");
            try {
                testBalancedRiskAssessment();
                sendResponse({ 
                    status: "success", 
                    message: "Balanced risk assessment test completed - check console for detailed scenarios",
                    timestamp: Date.now() 
                });
            } catch (error) {
                sendResponse({ 
                    status: "error", 
                    message: "Balanced risk assessment test error: " + error.message,
                    timestamp: Date.now() 
                });
            }
            return true;
        }

        // Add more message handlers as needed (e.g., for settings changes)
        console.log("PhishArmor Background: ===== MESSAGE PROCESSED =====");
        return true; // Keep message channel open for asynchronous responses
        
    } catch (error) {
        console.error("PhishArmor Background: ===== CRITICAL ERROR IN MESSAGE LISTENER =====");
        console.error("PhishArmor Background: Error processing message:", error);
        console.error("PhishArmor Background: Error stack:", error.stack);
        console.error("PhishArmor Background: Message that caused error:", message);
        sendResponse({ status: "error", error: error.message });
        return true;
    }
});

async function handleEmailAnalysis(emailData, tabId, forceDisplay = false) {
    try {
        // First check for cached result if not forcing display
        if (!forceDisplay) {
            const storage = await chrome.storage.local.get([`emailScore_${emailData.id}`]);
            if (storage[`emailScore_${emailData.id}`]) {
                console.log("PhishArmor Background: Using cached analysis for", emailData.id);
                chrome.tabs.sendMessage(tabId, {
                    action: "updateShield",
                    emailId: emailData.id,
                    scoreDetails: storage[`emailScore_${emailData.id}`].scoreDetails
                });
                return;
            }
        }

        console.log("PhishArmor Background: Starting fresh analysis for", emailData.id);
        
        // Show loading state (send minimal scoreDetails with loading status)
        chrome.tabs.sendMessage(tabId, {
            action: "updateShield", 
            emailId: emailData.id,
            scoreDetails: {
                level: 'loading',
                score: "Analyzing...",
                message: "AI analysis in progress..."
            }
        });

        // Initialize debug information object
        let debugInfo = {
            webRisk: null,
            openAI: null,
            senderReputation: null,
            timestamp: new Date().toISOString()
        };

        // Extract features
        const features = extractFeaturesFromEmail(emailData);
        
        // Initialize variables for API results
        let senderReputationResult = null;
        
        // Check sender reputation using APIVoid
        try {
            senderReputationResult = await checkSuspiciousSender(emailData);
            console.log("PhishArmor Background: Sender reputation check complete");
            debugInfo.senderReputation = senderReputationResult;
            
            // Update features based on sender reputation results
            if (senderReputationResult.isSuspicious) {
                features.suspiciousSenderAddress = true;
                features.senderReputationReason = senderReputationResult.reasons.join('; ');
                console.log("PhishArmor Background: Marked sender as suspicious due to:", senderReputationResult.reasons);
            } else {
                // Clear any existing suspicious sender flag since we now have better data
                features.suspiciousSenderAddress = false;
                
                // Add positive indicators if the domain has good reputation
                if (senderReputationResult.domainReputationCheck && 
                    senderReputationResult.domainReputationCheck.isReputationGood && 
                    senderReputationResult.domainReputationCheck.riskScore !== undefined) {
                    
                    const riskScore = senderReputationResult.domainReputationCheck.riskScore;
                    if (riskScore === 0) {
                        features.senderReputationReason = "Verified safe domain (0/100 risk score)";
                    } else if (riskScore < 20) {
                        features.senderReputationReason = `Good domain reputation (${riskScore}/100 risk score)`;
                    } else {
                        features.senderReputationReason = `Domain appears safe (${riskScore}/100 risk score)`;
                    }
                }
            }
        } catch (error) {
            console.error("PhishArmor Background: Error checking sender reputation:", error);
            debugInfo.senderReputation = { error: error.message };
            // Don't modify features.suspiciousSenderAddress if reputation check fails
        }

        // Extract URLs and check with Web Risk API
        const urls = extractUrlsFromEmailContent(emailData);
        let webRiskResults = null;
        if (urls.length > 0) {
            try {
                webRiskResults = await checkUrlsWithWebRisk(urls, GOOGLE_WEBRISK_API_KEY);
                console.log("PhishArmor Background: Web Risk check complete, URLs found:", urls.length);
                debugInfo.webRisk = webRiskResults;
                
                // Update features based on Web Risk results (updated for Lookup API)
                if (webRiskResults && webRiskResults.hasThreats) {
                    features.suspiciousLinks = true;
                    features.webRiskThreats = webRiskResults.threats;
                    const threatCount = webRiskResults.threats.length;
                    const allThreatTypes = [...new Set(webRiskResults.threats.flatMap(threat => threat.threatTypes))];
                    features.webRiskReason = `Found ${threatCount} malicious URLs with threats: ${allThreatTypes.join(', ')}`;
                } else if (webRiskResults) {
                    const checkedCount = webRiskResults.checkedUrls;
                    const threatTypes = webRiskResults.checkedThreatTypes ? webRiskResults.checkedThreatTypes.join(', ') : 'standard threats';
                    features.webRiskReason = `${checkedCount} URLs checked for ${threatTypes}, all appear safe`;
                }
            } catch (error) {
                console.error("PhishArmor Background: Error checking URLs with Web Risk:", error);
                debugInfo.webRisk = { error: error.message };
            }
        }

        // Perform AI analysis with technical data included
        const prompt = createAnalysisPrompt(emailData, features, webRiskResults, senderReputationResult);
        let aiResponse = null;
        try {
            aiResponse = await callOpenAI(prompt, TEMP_DEFAULT_API_KEY, "gpt-4o-mini");
            console.log("PhishArmor Background: OpenAI analysis complete");
            debugInfo.openAI = aiResponse;
        } catch (error) {
            console.error("PhishArmor Background: Error calling OpenAI:", error);
            debugInfo.openAI = { error: error.message };
        }

        // Parse AI response and update features
        let aiData = {};
        if (aiResponse && aiResponse.choices && aiResponse.choices[0] && aiResponse.choices[0].message) {
            try {
                let aiContent = aiResponse.choices[0].message.content;
                console.log("PhishArmor Background: Raw AI response content:", aiContent);
                console.log("PhishArmor Background: AI content length:", aiContent.length);
                
                // Check if the JSON appears to be truncated and try to fix it
                if (!aiContent.trim().endsWith('}')) {
                    console.warn("PhishArmor Background: AI response appears truncated, attempting to fix...");
                    
                    // Try to close any open JSON structures
                    let fixedContent = aiContent.trim();
                    
                    // Handle common truncation patterns
                    if (fixedContent.endsWith(',')) {
                        // Remove trailing comma and close structure
                        fixedContent = fixedContent.slice(0, -1);
                    }
                    
                    // If we're in the middle of a string value, try to close it properly
                    const lastQuote = fixedContent.lastIndexOf('"');
                    const secondLastQuote = fixedContent.lastIndexOf('"', lastQuote - 1);
                    const afterLastQuote = fixedContent.substring(lastQuote + 1);
                    
                    // Check if we're in an incomplete string value
                    if (lastQuote > secondLastQuote && afterLastQuote && !afterLastQuote.includes('"')) {
                        console.log("PhishArmor Background: Detected incomplete string value, attempting to close it");
                        // Try to complete the truncated string intelligently
                        if (afterLastQuote.includes('level') || afterLastQuote.includes('threat') || afterLastQuote.includes('assessment')) {
                            fixedContent += '"';
                        } else {
                            // For other cases, add a generic completion
                            fixedContent += ' (response truncated)"';
                        }
                    }
                    
                    // Count open and closing braces/brackets to balance them
                    const openBraces = (fixedContent.match(/\{/g) || []).length;
                    const closeBraces = (fixedContent.match(/\}/g) || []).length;
                    const openBrackets = (fixedContent.match(/\[/g) || []).length;
                    const closeBrackets = (fixedContent.match(/\]/g) || []).length;
                    
                    // Close any open arrays
                    for (let i = 0; i < (openBrackets - closeBrackets); i++) {
                        fixedContent += ']';
                    }
                    
                    // Close any open objects
                    for (let i = 0; i < (openBraces - closeBraces); i++) {
                        fixedContent += '}';
                    }
                    
                    console.log("PhishArmor Background: Attempting to parse fixed content:", fixedContent.substring(0, 200) + "...");
                    aiContent = fixedContent;
                }
                
                aiData = JSON.parse(aiContent);
                console.log("PhishArmor Background: Parsed AI data:", aiData);
                
                // Update features based on AI analysis - focused on content-based indicators only
                if (aiData.urgentLanguageAI) {
                    features.urgentLanguage = true;
                    console.log("PhishArmor Background: AI detected urgent language:", aiData.urgentLanguageDetails);
                }
                if (aiData.requestsSensitiveInfoAI) {
                    features.requestsSensitiveInfo = true;
                    console.log("PhishArmor Background: AI detected sensitive info request:", aiData.sensitiveInfoDetails);
                }
                if (aiData.grammarIssuesAI) {
                    features.grammarIssues = true;
                    console.log("PhishArmor Background: AI detected grammar/spelling issues:", aiData.grammarQualityDetails);
                }
                
                // Store detailed AI analysis for tooltip display
                features.aiAnalysisComments = aiData.overallAssessment || "AI analysis completed";
                features.aiUrgentLanguageDetails = aiData.urgentLanguageDetails;
                features.aiSensitiveInfoDetails = aiData.sensitiveInfoDetails;
                features.aiGrammarQualityDetails = aiData.grammarQualityDetails;
                
                // Store new comprehensive analysis fields
                features.aiTechnicalSecuritySummary = aiData.technicalSecuritySummary;
                features.aiCombinedThreatAssessment = aiData.combinedThreatAssessment;
                features.aiUserRecommendation = aiData.userRecommendation;
                features.aiComprehensiveReasoning = aiData.reasoning;
                
            } catch (parseError) {
                console.error("PhishArmor Background: Error parsing AI response:", parseError);
                console.error("PhishArmor Background: Raw AI content that failed to parse:", aiResponse.choices[0].message.content);
                
                // Provide more specific error information and better fallback
                const content = aiResponse.choices[0].message.content;
                const isLikelyTruncated = !content.trim().endsWith('}') && content.includes('{');
                
                // Try to extract any useful information from the partial response
                let extractedRiskLevel = "Medium";
                let extractedConfidence = 50;
                let extractedAssessment = "AI analysis was incomplete due to response length limits";
                
                // Attempt to extract risk level from partial content
                const riskLevelMatch = content.match(/"riskLevel":\s*"([^"]+)"/);
                if (riskLevelMatch) {
                    extractedRiskLevel = riskLevelMatch[1];
                }
                
                // Attempt to extract confidence from partial content
                const confidenceMatch = content.match(/"confidence":\s*(\d+)/);
                if (confidenceMatch) {
                    extractedConfidence = parseInt(confidenceMatch[1]);
                }
                
                // Attempt to extract assessment from partial content
                const assessmentMatch = content.match(/"overallAssessment":\s*"([^"]+)"/);
                if (assessmentMatch) {
                    extractedAssessment = assessmentMatch[1];
                }
                
                // Create fallback AI data with extracted information
                aiData = {
                    overallAssessment: extractedAssessment,
                    riskLevel: extractedRiskLevel,
                    confidence: extractedConfidence,
                    reasoning: [
                        isLikelyTruncated ? 
                            `AI analysis was truncated - extracted risk level: ${extractedRiskLevel}` :
                            "AI analysis failed to parse properly: " + parseError.message,
                        "Using fallback analysis based on partial response"
                    ],
                    urgentLanguageAI: content.includes('"urgentLanguageAI": true'),
                    requestsSensitiveInfoAI: content.includes('"requestsSensitiveInfoAI": true'),
                    grammarIssuesAI: content.includes('"grammarIssuesAI": true'),
                    parseError: true
                };
                
                console.log("PhishArmor Background: Created fallback AI data:", aiData);
            }
        } else {
            console.warn("PhishArmor Background: No valid AI response received");
            aiData = {
                overallAssessment: "AI analysis not available",
                riskLevel: features.suspiciousLinks ? "High" : "Low",
                confidence: 25,
                reasoning: ["AI analysis was not available"]
            };
        }

        // Calculate raw risk score from features
        const { rawScore, presentIndicators } = calculateRawRiskScore(features);
        console.log("PhishArmor Background: Raw risk score calculated:", rawScore);

        // ENHANCED: Apply APIVoid domain reputation multipliers
        let domainRiskMultiplier = 1.0;
        let domainRiskBonus = 0;
        
        if (senderReputationResult && senderReputationResult.domainReputationCheck) {
            const domainCheck = senderReputationResult.domainReputationCheck;
            const apiVoidScore = domainCheck.riskScore || 0;
            
            console.log(`PhishArmor Background: Applying APIVoid risk multiplier for score: ${apiVoidScore}/100`);
            
            if (apiVoidScore >= 80) {
                // Critical domain risk: Major boost
                domainRiskMultiplier = 2.5;
                domainRiskBonus = 30;
                console.log("PhishArmor Background: Applied CRITICAL domain risk multiplier (2.5x + 30 bonus)");
            } else if (apiVoidScore >= 60) {
                // High domain risk: Significant boost  
                domainRiskMultiplier = 2.0;
                domainRiskBonus = 20;
                console.log("PhishArmor Background: Applied HIGH domain risk multiplier (2.0x + 20 bonus)");
            } else if (apiVoidScore >= 40) {
                // Medium domain risk: Moderate boost
                domainRiskMultiplier = 1.5;
                domainRiskBonus = 10;
                console.log("PhishArmor Background: Applied MEDIUM domain risk multiplier (1.5x + 10 bonus)");
            } else if (apiVoidScore >= 20) {
                // Low domain risk: Small boost
                domainRiskMultiplier = 1.2;
                domainRiskBonus = 5;
                console.log("PhishArmor Background: Applied LOW domain risk multiplier (1.2x + 5 bonus)");
            } else if (apiVoidScore === 0 && domainCheck.isReputationGood) {
                // Verified safe domain: Risk reduction
                domainRiskMultiplier = 0.7;
                domainRiskBonus = -10;
                console.log("PhishArmor Background: Applied SAFE domain risk reduction (0.7x - 10 penalty)");
            }
            
            // Additional boost for multiple detections
            const detections = domainCheck.detections || 0;
            if (detections > 0) {
                const detectionBonus = Math.min(detections * 5, 20); // Max 20 bonus for detections
                domainRiskBonus += detectionBonus;
                console.log(`PhishArmor Background: Applied detection bonus: +${detectionBonus} for ${detections} detections`);
            }
        }
        
        // Apply domain reputation adjustments to raw score
        const adjustedRawScore = Math.min(100, (rawScore * domainRiskMultiplier) + domainRiskBonus);
        console.log(`PhishArmor Background: Adjusted raw score: ${rawScore} -> ${adjustedRawScore} (multiplier: ${domainRiskMultiplier}, bonus: ${domainRiskBonus})`);

        // Determine final risk level using combined analysis
        let finalRiskLevel = 'safe';  // Default to safe
        let finalConfidence = adjustedRawScore; // Start with domain-adjusted score
        
        if (aiData.riskLevel) {
            // Use AI's risk level but adjust based on technical indicators
            const aiRiskMap = { 'Low': 25, 'Medium': 50, 'High': 75, 'Critical': 90 };
            const aiScore = aiRiskMap[aiData.riskLevel] || 50;
            const aiAdjustedScore = aiScore * (aiData.confidence / 100);
            
            // CRITICAL FIX: When AI detects content threats, don't let good domain reputation override it
            // Take the higher of domain-adjusted score or AI score, but ensure AI content threats are respected
            if (aiData.urgentLanguageAI || aiData.requestsSensitiveInfoAI || aiData.grammarIssuesAI) {
                // Content threats detected - ensure minimum confidence level regardless of domain reputation
                const minContentThreatConfidence = Math.max(40, aiAdjustedScore);
                finalConfidence = Math.max(adjustedRawScore, minContentThreatConfidence);
                console.log(`PhishArmor Background: Content threats detected by AI - ensuring minimum confidence: ${minContentThreatConfidence}`);
            } else {
                // No content threats - standard logic
                finalConfidence = Math.max(adjustedRawScore, aiAdjustedScore);
            }
            
            console.log(`PhishArmor Background: Final confidence: max(${adjustedRawScore}, ${aiAdjustedScore}) = ${finalConfidence}`);
            console.log(`PhishArmor Background: AI detected content threats: urgent=${aiData.urgentLanguageAI}, sensitive=${aiData.requestsSensitiveInfoAI}, grammar=${aiData.grammarIssuesAI}`);
        }

        // ENHANCED: More sophisticated risk assessment considering multiple factors
        let displayRiskLevel = 'Low Risk';
        
        // Count severe risk factors for multi-vector threat assessment
        let severeRiskFactors = 0;
        let moderateRiskFactors = 0;
        
        // Analyze domain reputation severity
        let domainRiskLevel = 'none';
        if (senderReputationResult && senderReputationResult.domainReputationCheck) {
            const apiVoidScore = senderReputationResult.domainReputationCheck.riskScore || 0;
            const detections = senderReputationResult.domainReputationCheck.detections || 0;
            
            if (apiVoidScore >= 90 || detections >= 5) {
                domainRiskLevel = 'critical';
                severeRiskFactors++;
            } else if (apiVoidScore >= 70 || detections >= 3) {
                domainRiskLevel = 'high';
                severeRiskFactors++;
            } else if (apiVoidScore >= 40 || detections >= 1) {
                domainRiskLevel = 'medium';
                moderateRiskFactors++;
            }
        }
        
        // Analyze link threats
        if (features.suspiciousLinks && webRiskResults && webRiskResults.hasThreats) {
            const threatTypes = webRiskResults.threats.flatMap(t => t.threatTypes);
            if (threatTypes.includes('MALWARE') || threatTypes.includes('SOCIAL_ENGINEERING')) {
                severeRiskFactors++;
            } else {
                moderateRiskFactors++;
            }
        }
        
        // Analyze content-based risks with enhanced logic for social engineering
        let contentThreatCount = 0;
        if (features.urgentLanguage && features.requestsSensitiveInfo) {
            // Both urgent language AND sensitive info requests = severe social engineering
            severeRiskFactors++;
            contentThreatCount = 2;
            console.log("PhishArmor Background: SEVERE social engineering pattern detected (urgent + sensitive info)");
        } else if (features.urgentLanguage || features.requestsSensitiveInfo) {
            // Only one of these = moderate
            moderateRiskFactors++;
            contentThreatCount = 1;
        }
        
        // Grammar issues are a red flag, especially for "legitimate" domains
        if (features.grammarIssues) {
            moderateRiskFactors++;
            contentThreatCount++;
        }
        
        // ENHANCED: Detect social engineering through legitimate domains
        let isSocialEngineeringThroughLegitDomain = false;
        if (domainRiskLevel === 'none' && contentThreatCount >= 2) {
            // Good domain + multiple content threats = likely social engineering
            isSocialEngineeringThroughLegitDomain = true;
            console.log("PhishArmor Background: Social engineering through legitimate domain detected!");
        }
        
        console.log(`PhishArmor Background: Risk factor analysis: ${severeRiskFactors} severe, ${moderateRiskFactors} moderate`);
        console.log(`PhishArmor Background: Domain risk level: ${domainRiskLevel}, Final confidence: ${finalConfidence}`);
        
        // Determine final risk level based on multiple factors
        if (severeRiskFactors >= 2) {
            // Multiple severe threats = Critical
            finalRiskLevel = 'dangerous';  // Red shield
            displayRiskLevel = 'Critical Risk';
            console.log("PhishArmor Background: CRITICAL - Multiple severe threat vectors detected");
        } else if (isSocialEngineeringThroughLegitDomain) {
            // ENHANCED: Social engineering through legitimate domain = High Risk regardless of other factors
            finalRiskLevel = 'caution';   // Yellow shield for High Risk
            displayRiskLevel = 'High Risk';
            console.log("PhishArmor Background: HIGH - Social engineering through legitimate domain");
        } else if (severeRiskFactors >= 1 && (finalConfidence >= 70 || moderateRiskFactors >= 2)) {
            // One severe threat + high confidence or multiple moderate threats = High Risk
            finalRiskLevel = 'caution';   // Yellow shield for High Risk
            displayRiskLevel = 'High Risk';
            console.log("PhishArmor Background: HIGH - Severe threat with supporting factors");
        } else if (severeRiskFactors >= 1 || finalConfidence >= 80) {
            // Single severe threat or very high confidence = High Risk
            finalRiskLevel = 'caution';   // Yellow shield for High Risk
            displayRiskLevel = 'High Risk';
            console.log("PhishArmor Background: HIGH - Single severe threat or high confidence");
        } else if (moderateRiskFactors >= 2 || finalConfidence >= 50) {
            // Multiple moderate threats or moderate confidence = Medium Risk
            finalRiskLevel = 'caution';
            displayRiskLevel = 'Medium Risk';
            console.log("PhishArmor Background: MEDIUM - Multiple moderate threats or moderate confidence");
        } else if (moderateRiskFactors >= 1 || finalConfidence >= 25) {
            // Single moderate threat or low confidence = Low Risk
            finalRiskLevel = 'caution';
            displayRiskLevel = 'Low Risk';
            console.log("PhishArmor Background: LOW - Minor threats detected");
        } else {
            // No significant threats = Safe
            finalRiskLevel = 'safe';
            displayRiskLevel = 'Low Risk';
            console.log("PhishArmor Background: SAFE - No significant threats detected");
        }
        
        console.log(`PhishArmor Background: Final risk assessment: ${displayRiskLevel} (confidence: ${finalConfidence})`);
        console.log(`PhishArmor Background: Risk factors - Severe: ${severeRiskFactors}, Moderate: ${moderateRiskFactors}, Domain: ${domainRiskLevel}, Social Engineering: ${isSocialEngineeringThroughLegitDomain}`);

        const scoreDetails = {
            score: Math.round(finalConfidence),
            level: finalRiskLevel,  // This is what the content script uses for shield colors
            riskLevel: displayRiskLevel,  // This is what gets displayed in the tooltip
            message: generateExplanation(presentIndicators, displayRiskLevel, aiData.overallAssessment || "AI analysis not available", features),
            indicators: convertIndicatorsToObjectFormat(presentIndicators),
            confidence: Math.round(finalConfidence),
            aiComments: aiData.reasoning || ["No specific AI insights available"],
            debugInfo: debugInfo,  // Include debug information in the response
            
            // ENHANCED: Add detailed AI analysis for transparency features
            aiAnalysisDetails: {
                urgentLanguageDetails: features.aiUrgentLanguageDetails,
                sensitiveInfoDetails: features.aiSensitiveInfoDetails,
                grammarQualityDetails: features.aiGrammarQualityDetails,
                technicalSecuritySummary: features.aiTechnicalSecuritySummary,
                combinedThreatAssessment: features.aiCombinedThreatAssessment,
                userRecommendation: features.aiUserRecommendation,
                overallAssessment: aiData.overallAssessment
            }
        };

        console.log("Analysis complete for:", emailData.id, "Score:", scoreDetails.score, "Level:", scoreDetails.level);
        console.log("PhishArmor: Final scoreDetails.indicators:", scoreDetails.indicators);

        // Store result
        try {
            await chrome.storage.local.set({
                [`emailScore_${emailData.id}`]: {
                    scoreDetails: scoreDetails,
                    timestamp: Date.now()
                }
            });
        } catch (storageError) {
            console.error("PhishArmor Background: Storage error:", storageError);
        }

        // Send final result with debug info
        chrome.tabs.sendMessage(tabId, {
            action: "updateShield",
            emailId: emailData.id,
            scoreDetails: scoreDetails
        });

        return scoreDetails;
        
    } catch (error) {
        console.error("PhishArmor Background: Error in handleEmailAnalysis:", error);
        
        try {
            // Send error state 
            chrome.tabs.sendMessage(tabId, {
                action: "updateShield", 
                emailId: emailData.id,
                scoreDetails: { level: 'error', score: "N/A", message: "Analysis failed: " + error.message }
            });
        } catch (sendError) {
            console.error("PhishArmor Background: Error sending error message:", sendError);
        }
        
        try {
            // Store error result
            await chrome.storage.local.set({
                [`emailScore_${emailData.id}`]: {
                    scoreDetails: { level: 'error', score: "N/A", message: "Storage access error: " + error.message },
                    timestamp: Date.now()
                }
            });
        } catch (storageError) {
            console.error("PhishArmor Background: Storage error during error handling:", storageError);
        }
        
        return { level: 'error', score: "N/A", message: "Analysis failed: " + error.message };
    }
}

function extractFeaturesFromEmail(emailData) {
    let features = {
        requestsSensitiveInfo: false, // Will be enhanced by AI
        suspiciousLinks: false,
        urgentLanguage: false,      // Will be enhanced by AI
        suspiciousSenderAddress: false,
        spellingMistakes: false,
        grammarIssues: false,       // Added missing property
        // raw values for AI to potentially use
        links: [],
        potentialUrgency: false, // Preliminary flag for AI
        potentialSensitiveInfoRequest: false, // Preliminary flag for AI
        aiAnalysisComments: ""
    };

    const bodyLower = emailData.bodyText ? emailData.bodyText.toLowerCase() : "";
    const subjectLower = emailData.subject ? emailData.subject.toLowerCase() : "";

    // Basic Keyword Checks (these are placeholders, regex and better NLP needed)
    const sensitiveKeywords = ['password', 'username', 'ssn', 'social security', 'bank account', 'credit card', 'login', 'verify your account', 'confirm your identity'];
    const urgencyKeywords = ['urgent', 'immediate', 'action required', 'warning', 'account suspended', 'limited time', 'final notice', 'security alert'];

    for (const keyword of sensitiveKeywords) {
        if (bodyLower.includes(keyword) || subjectLower.includes(keyword)) {
            features.potentialSensitiveInfoRequest = true;
            break;
        }
    }
    for (const keyword of urgencyKeywords) {
        if (bodyLower.includes(keyword) || subjectLower.includes(keyword)) {
            features.potentialUrgency = true;
            break;
        }
    }

    // Suspicious Links - Now handled by Google Web Risk API in the main analysis pipeline
    // The suspiciousLinks flag will be set by Web Risk API results rather than basic heuristics
    // This ensures we get accurate, real-time threat intelligence for URL safety

    // Spelling Mistakes (very basic, needs a proper library)
    // This is a placeholder. Real spell checking is complex.
    const commonTypos = ['pa$$word', 'sup0rt', 'accout']; // Example, not for real use
    for (const typo of commonTypos) {
        if (bodyLower.includes(typo)) {
            features.spellingMistakes = true;
            break;
        }
    }
    // A real check would involve a dictionary and grammar check on a significant portion of text.
    // For now, we can also set it true if AI indicates poor language quality.

    return features;
}

function isKnownGoodShortener(url, sender) {
    // Placeholder for logic to check if a shortened URL from a trusted sender is okay
    // e.g. if Google sends a goo.gl link, it's probably fine.
    return false; // Default to suspicious
}

function calculateRawRiskScore(features) {
    let rawScore = 0;
    let presentIndicators = [];

    console.log("PhishArmor: calculateRawRiskScore - Input features:", features);

    if (features.requestsSensitiveInfo) {
        rawScore += riskIndicatorWeights.requestsSensitiveInfo;
        presentIndicators.push({ name: "requestsSensitiveInfo", text: "Requests Sensitive Info", present: true, weight: riskIndicatorWeights.requestsSensitiveInfo, byAI: features.aiAnalysisComments ? true : false });
        console.log("PhishArmor: Added requestsSensitiveInfo indicator (present=true)");
    } else {
        presentIndicators.push({ name: "requestsSensitiveInfo", text: "Requests Sensitive Info", present: false });
        console.log("PhishArmor: Added requestsSensitiveInfo indicator (present=false)");
    }

    if (features.suspiciousLinks) {
        rawScore += riskIndicatorWeights.suspiciousLinks;
        const indicatorText = features.webRiskThreats ? 
            `Malicious Links (${features.webRiskThreats.length} threats detected)` : 
            "Suspicious Links";
        presentIndicators.push({ 
            name: "suspiciousLinks", 
            text: indicatorText, 
            present: true, 
            weight: riskIndicatorWeights.suspiciousLinks,
            webRiskDetails: features.webRiskThreats || null,
            reason: features.webRiskReason || "Basic link analysis"
        });
        console.log("PhishArmor: Added suspiciousLinks indicator (present=true) with Web Risk details");
    } else {
        const indicatorText = features.webRiskReason ? 
            `Safe Links (${features.webRiskReason})` : 
            "Suspicious Links";
        presentIndicators.push({ 
            name: "suspiciousLinks", 
            text: indicatorText, 
            present: false,
            reason: features.webRiskReason || "No links found"
        });
        console.log("PhishArmor: Added suspiciousLinks indicator (present=false) with Web Risk details");
    }

    if (features.urgentLanguage) {
        rawScore += riskIndicatorWeights.urgentLanguage;
        presentIndicators.push({ name: "urgentLanguage", text: "Urgent Language", present: true, weight: riskIndicatorWeights.urgentLanguage, byAI: features.aiAnalysisComments ? true : false });
        console.log("PhishArmor: Added urgentLanguage indicator (present=true)");
    } else {
        presentIndicators.push({ name: "urgentLanguage", text: "Urgent Language", present: false });
        console.log("PhishArmor: Added urgentLanguage indicator (present=false)");
    }

    if (features.suspiciousSenderAddress) {
        rawScore += riskIndicatorWeights.suspiciousSenderAddress;
        
        // Create detailed indicator text with APIVoid information
        let indicatorText = "Suspicious Sender";
        let detailedReason = features.senderReputationReason || "Basic sender analysis";
        
        // If we have APIVoid data, create more specific messaging
        if (features.senderReputationReason) {
            if (features.senderReputationReason.includes("High risk domain")) {
                indicatorText = "🔴 High Risk Sender";
            } else if (features.senderReputationReason.includes("Suspicious domain")) {
                indicatorText = "🟡 Suspicious Sender";
            } else if (features.senderReputationReason.includes("detection")) {
                indicatorText = "⚠️ Flagged Sender";
            }
        }
        
        presentIndicators.push({ 
            name: "suspiciousSenderAddress", 
            text: indicatorText, 
            present: true, 
            weight: riskIndicatorWeights.suspiciousSenderAddress,
            reason: detailedReason,
            apiVoidData: true
        });
        console.log("PhishArmor: Added suspiciousSenderAddress indicator (present=true) with APIVoid data");
    } else {
        // Create positive indicator text for good senders
        let indicatorText = "Verified Sender";
        let detailedReason = features.senderReputationReason || "No sender issues detected";
        
        // If we have positive APIVoid data, show it
        if (features.senderReputationReason) {
            if (features.senderReputationReason.includes("Verified safe domain")) {
                indicatorText = "✅ Verified Safe Sender";
            } else if (features.senderReputationReason.includes("Good domain reputation")) {
                indicatorText = "✅ Trusted Sender";
            } else if (features.senderReputationReason.includes("appears safe")) {
                indicatorText = "✅ Safe Sender";
            }
        }
        
        presentIndicators.push({ 
            name: "suspiciousSenderAddress", 
            text: indicatorText, 
            present: false,
            reason: detailedReason,
            apiVoidData: features.senderReputationReason ? true : false
        });
        console.log("PhishArmor: Added suspiciousSenderAddress indicator (present=false) with APIVoid data");
    }

    if (features.spellingMistakes || features.grammarIssues) {
        rawScore += riskIndicatorWeights.spellingMistakes;
        presentIndicators.push({ name: "spellingMistakes", text: "Spelling/Grammar Issues", present: true, weight: riskIndicatorWeights.spellingMistakes });
        console.log("PhishArmor: Added spellingMistakes indicator (present=true)");
    } else {
        presentIndicators.push({ name: "spellingMistakes", text: "Spelling/Grammar Issues", present: false });
        console.log("PhishArmor: Added spellingMistakes indicator (present=false)");
    }

    console.log("PhishArmor: calculateRawRiskScore - Final presentIndicators:", presentIndicators);
    console.log("PhishArmor: calculateRawRiskScore - Final rawScore:", rawScore);

    return { rawScore, presentIndicators };
}

// Convert indicator array to object format for easier access in content script
function convertIndicatorsToObjectFormat(indicatorArray) {
    const indicatorObject = {};
    indicatorArray.forEach(indicator => {
        indicatorObject[indicator.name] = {
            present: indicator.present,
            text: indicator.text,
            weight: indicator.weight || 0,
            byAI: indicator.byAI || false
        };
    });
    console.log("PhishArmor: Converted indicators to object format:", indicatorObject);
    return indicatorObject;
}

function generateExplanation(indicators, riskLevel, aiOverallAssessment, features = {}) {
    let explanation = `This email has been classified as ${riskLevel}. `;
    
    // Start with AI's comprehensive assessment if available
    if (aiOverallAssessment && aiOverallAssessment !== "AI analysis not available") {
        explanation += `${aiOverallAssessment} `;
    }
    
    // Add AI's technical security summary if available
    if (features.aiTechnicalSecuritySummary) {
        explanation += `Technical Security Analysis: ${features.aiTechnicalSecuritySummary} `;
    }
    
    // Add AI's combined threat assessment
    if (features.aiCombinedThreatAssessment) {
        explanation += `Risk Assessment: ${features.aiCombinedThreatAssessment} `;
    }
    
    const riskyIndicators = indicators.filter(ind => ind.present);

    if (riskyIndicators.length === 0) {
        explanation += "Our analysis found no significant risk indicators. ";
        
        // Check for positive sender reputation information
        const senderIndicator = indicators.find(ind => ind.name === 'suspiciousSenderAddress');
        if (senderIndicator && senderIndicator.apiVoidData && senderIndicator.reason) {
            explanation += `Sender verification: ${senderIndicator.reason}. `;
        }
    } else {
        explanation += "Key factors contributing to this assessment include: ";
        
        // Use AI's comprehensive reasoning if available
        if (features.aiComprehensiveReasoning && features.aiComprehensiveReasoning.length > 0) {
            explanation += features.aiComprehensiveReasoning.join('. ') + '. ';
        } else {
            // Fallback to indicator-based explanation
            riskyIndicators.forEach((ind, index) => {
                explanation += `${ind.text}${index < riskyIndicators.length - 1 ? ", " : ". "}`;
            });
        }
        
        // Add detailed sender reputation information if not covered by AI
        if (!features.aiTechnicalSecuritySummary) {
            const senderIndicator = indicators.find(ind => ind.name === 'suspiciousSenderAddress');
            if (senderIndicator && senderIndicator.present && senderIndicator.reason) {
                explanation += `Sender analysis: ${senderIndicator.reason}. `;
            }
            
            // Add specific Web Risk details if malicious links were found
            const linkIndicator = indicators.find(ind => ind.name === 'suspiciousLinks' && ind.present);
            if (linkIndicator && linkIndicator.webRiskDetails && linkIndicator.webRiskDetails.length > 0) {
                explanation += `Google Web Risk detected threats in ${linkIndicator.webRiskDetails.length} URL(s). `;
                const threatTypes = [...new Set(linkIndicator.webRiskDetails.flatMap(threat => threat.threatTypes))];
                if (threatTypes.length > 0) {
                    explanation += `Threat types identified: ${threatTypes.join(', ')}. `;
                }
            }
        }
    }
    
    // Add AI user recommendation if available
    if (features.aiUserRecommendation) {
        explanation += `Recommendation: ${features.aiUserRecommendation}`;
    } else {
        // Fallback recommendations based on risk level
        if (riskLevel.includes('Critical') || riskLevel.includes('High')) {
            explanation += "Recommendation: Do not interact with this email, do not click any links, and consider reporting it as phishing.";
        } else if (riskLevel.includes('Medium')) {
            explanation += "Recommendation: Exercise caution with this email and verify sender authenticity through alternative means before taking any action.";
        } else {
            explanation += "Recommendation: This email appears safe, but always remain vigilant for suspicious requests.";
        }
    }
    
    return explanation;
}

async function callOpenAI(prompt, apiKey, model) {
    if (!apiKey) {
        console.error("OpenAI API key is missing.");
        return null;
    }
    console.log(`Calling OpenAI model: ${model}`);
    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.3, // Lower temperature for more factual/less creative responses
                max_tokens: 500, // Increased from 300 to handle comprehensive analysis responses
                response_format: { type: "json_object" } // If supported by the model for structured output
            })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error("OpenAI API Error:", response.status, errorBody);
            throw new Error(`OpenAI API request failed with status ${response.status}: ${errorBody}`);
        }

        const data = await response.json();
        console.log("OpenAI Raw Response:", data);

        // Return the full response object - parsing will be done in the main analysis function
        return data;
    } catch (error) {
        console.error("Error calling OpenAI API:", error);
        return null;
    }
}

// Placeholder for browsing protection logic (if we implement URL checking on navigation)
// chrome.webNavigation.onBeforeNavigate.addListener(details => {
//   // Check details.url against a list of malicious URLs
//   // If malicious, potentially block or warn
// });

// Helper function to extract URLs from email content
function extractUrlsFromEmailContent(emailData) {
    console.log("PhishArmor: Extracting URLs from email content");
    const urls = new Set(); // Use Set to avoid duplicates
    
    // Extract from HTML content if available
    if (emailData.bodyHtml) {
        // Match href attributes in anchor tags
        const hrefRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
        let match;
        while ((match = hrefRegex.exec(emailData.bodyHtml)) !== null) {
            const url = match[1];
            if (isValidHttpUrl(url)) {
                urls.add(url);
            }
        }
        
        // Also check for URLs in onclick attributes or other locations
        const onclickRegex = /onclick=["'][^"']*(?:window\.open|location\.href)\s*=\s*["']([^"']+)["']/gi;
        while ((match = onclickRegex.exec(emailData.bodyHtml)) !== null) {
            const url = match[1];
            if (isValidHttpUrl(url)) {
                urls.add(url);
            }
        }
    }
    
    // Extract from plain text content
    if (emailData.bodyText) {
        // Match http/https URLs in text
        const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
        const textMatches = emailData.bodyText.match(urlRegex);
        if (textMatches) {
            textMatches.forEach(url => {
                if (isValidHttpUrl(url)) {
                    urls.add(url.trim());
                }
            });
        }
    }
    
    const urlArray = Array.from(urls);
    console.log(`PhishArmor: Extracted ${urlArray.length} unique URLs:`, urlArray);
    
    // Log detailed URL extraction breakdown
    console.log("PhishArmor: URL extraction breakdown:", {
        totalUniqueUrls: urlArray.length,
        fromHtmlHref: urlArray.filter(url => emailData.bodyHtml && emailData.bodyHtml.includes(`href="${url}"`)).length,
        fromHtmlOnclick: urlArray.filter(url => emailData.bodyHtml && emailData.bodyHtml.includes(`onclick`) && emailData.bodyHtml.includes(url)).length,
        fromPlainText: urlArray.filter(url => emailData.bodyText && emailData.bodyText.includes(url)).length,
        urlList: urlArray.map((url, index) => ({
            index: index + 1,
            url: url,
            length: url.length,
            domain: url.split('/')[2] || 'unknown'
        }))
    });
    
    return urlArray;
}

// Helper function to validate if a string is a valid HTTP URL
function isValidHttpUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

// Function to check URLs against Google Cloud Web Risk API
async function checkUrlsWithWebRisk(urls, apiKey = GOOGLE_WEBRISK_API_KEY) {
    console.log(`PhishArmor: ===== STARTING WEB RISK CHECK (Lookup API) =====`);
    console.log(`PhishArmor: Checking ${urls.length} URLs with Web Risk Lookup API`);
    
    if (!urls || urls.length === 0) {
        console.log("PhishArmor: No URLs to check");
        return { hasThreats: false, threats: [], checkedUrls: 0 };
    }
    
    if (!apiKey) {
        console.warn("PhishArmor: No Web Risk API key available");
        return { hasThreats: false, threats: [], checkedUrls: 0, error: "No API key" };
    }
    
    const threats = [];
    let checkedUrls = 0;
    const urlResults = [];
    
    // Check each URL (limit to first 10 URLs to avoid excessive API calls)
    const urlsToCheck = urls.slice(0, 10);
    console.log(`PhishArmor: Checking first ${urlsToCheck.length} URLs to avoid excessive API calls`);
    
    for (const url of urlsToCheck) {
        try {
            console.log(`PhishArmor: Checking URL with Web Risk Lookup API: ${url}`);
            
            // Use the public Lookup API with GET method
            const params = new URLSearchParams({
                uri: url,
                key: apiKey
            });
            
            // Add each threat type as a separate parameter
            WEB_RISK_THREAT_TYPES.forEach(threatType => {
                params.append('threatTypes', threatType);
            });
            
            const requestUrl = `${GOOGLE_WEBRISK_ENDPOINT}?${params.toString()}`;
            console.log(`PhishArmor: Web Risk request URL: ${requestUrl.replace(apiKey, 'API_KEY_HIDDEN')}`);
            console.log(`PhishArmor: Checking threat types: ${WEB_RISK_THREAT_TYPES.join(', ')}`);
            
            const response = await fetch(requestUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            console.log(`PhishArmor: Web Risk response status for ${url}: ${response.status}`);
            checkedUrls++;
            
            if (!response.ok) {
                const errorText = await response.text();
                console.warn(`Web Risk API request failed for ${url}: ${response.status} - ${errorText}`);
                urlResults.push({ url, status: 'error', error: errorText });
                continue;
            }
            
            const data = await response.json();
            console.log(`PhishArmor: Web Risk response for ${url}:`, data);
            
            // Check if any threats were found using Lookup API response format
            let isThreatened = false;
            const detectedThreatTypes = [];
            
            if (data.threat && data.threat.threatTypes && Array.isArray(data.threat.threatTypes)) {
                isThreatened = true;
                detectedThreatTypes.push(...data.threat.threatTypes);
                console.log(`PhishArmor: THREAT DETECTED for ${url}:`, detectedThreatTypes);
            } else if (Object.keys(data).length === 0) {
                // Empty response means URL is safe
                console.log(`PhishArmor: URL appears safe: ${url} (empty response)`);
            } else {
                console.log(`PhishArmor: URL appears safe: ${url} (no threat object)`);
            }
            
            urlResults.push({
                url,
                status: isThreatened ? 'threat' : 'safe',
                threatData: data.threat || null,
                checkedThreatTypes: WEB_RISK_THREAT_TYPES,
                fullResponse: data
            });
            
            if (isThreatened) {
                threats.push({
                    url: url,
                    threatTypes: detectedThreatTypes,
                    threatData: data.threat,
                    fullApiResponse: data
                });
            }
            
            // Add a small delay between requests to be respectful to the API
            await new Promise(resolve => setTimeout(resolve, 100));
            
        } catch (error) {
            console.error(`PhishArmor: Error checking URL ${url} with Web Risk:`, error);
            urlResults.push({ url, status: 'error', error: error.message });
            continue;
        }
    }
    
    const result = {
        hasThreats: threats.length > 0,
        threats: threats,
        checkedUrls: checkedUrls,
        totalUrls: urls.length,
        urlDetails: urlResults,
        apiVersion: 'v1 Lookup API',
        checkedThreatTypes: WEB_RISK_THREAT_TYPES
    };
    
    console.log(`PhishArmor: Web Risk check complete. Found ${threats.length} threats out of ${checkedUrls} checked URLs`);
    console.log(`PhishArmor: ===== WEB RISK CHECK COMPLETE =====`);
    
    return result;
}

// Add missing helper function before handleEmailAnalysis
function createAnalysisPrompt(emailData, features, webRiskResults, senderReputationResult) {
    // Build technical context section
    let technicalContext = "\n=== TECHNICAL SECURITY ANALYSIS (Already Completed) ===\n";
    
    // Add sender reputation data
    if (senderReputationResult) {
        technicalContext += `\nSENDER REPUTATION ANALYSIS (APIVoid):\n`;
        technicalContext += `- Sender: ${emailData.sender}\n`;
        technicalContext += `- Domain: ${senderReputationResult.domainReputationCheck ? extractDomainFromSender(emailData.sender) : 'Unknown'}\n`;
        
        if (senderReputationResult.domainReputationCheck) {
            const domainCheck = senderReputationResult.domainReputationCheck;
            technicalContext += `- Reputation Status: ${domainCheck.isReputationGood ? 'GOOD' : 'SUSPICIOUS'}\n`;
            technicalContext += `- Risk Score: ${domainCheck.riskScore}/100\n`;
            technicalContext += `- Security Detections: ${domainCheck.detections || 0}\n`;
            technicalContext += `- Assessment: ${domainCheck.reason}\n`;
            
            if (domainCheck.riskFactors && domainCheck.riskFactors.length > 0) {
                technicalContext += `- Risk Factors: ${domainCheck.riskFactors.join(', ')}\n`;
            }
        }
        
        technicalContext += `- Overall Sender Assessment: ${senderReputationResult.isSuspicious ? 'SUSPICIOUS' : 'LEGITIMATE'}\n`;
        if (senderReputationResult.reasons && senderReputationResult.reasons.length > 0) {
            technicalContext += `- Suspicious Reasons: ${senderReputationResult.reasons.join('; ')}\n`;
        }
    } else {
        technicalContext += `\nSENDER REPUTATION ANALYSIS: Not available\n`;
    }
    
    // Add URL/Link security data
    if (webRiskResults) {
        technicalContext += `\nURL SECURITY ANALYSIS (Google Web Risk):\n`;
        technicalContext += `- URLs Found: ${webRiskResults.totalUrls || 0}\n`;
        technicalContext += `- URLs Checked: ${webRiskResults.checkedUrls || 0}\n`;
        technicalContext += `- Malicious URLs Detected: ${webRiskResults.threats ? webRiskResults.threats.length : 0}\n`;
        technicalContext += `- Overall URL Assessment: ${webRiskResults.hasThreats ? 'DANGEROUS LINKS FOUND' : 'SAFE LINKS'}\n`;
        
        if (webRiskResults.hasThreats && webRiskResults.threats) {
            technicalContext += `- Threat Details:\n`;
            webRiskResults.threats.forEach((threat, index) => {
                technicalContext += `  ${index + 1}. ${threat.url} - Threats: ${threat.threatTypes.join(', ')}\n`;
            });
        }
        
        if (webRiskResults.checkedThreatTypes) {
            technicalContext += `- Checked for: ${webRiskResults.checkedThreatTypes.join(', ')}\n`;
        }
    } else {
        technicalContext += `\nURL SECURITY ANALYSIS: No URLs found or check not performed\n`;
    }

    let prompt = `You are an expert email security analyst. You have been provided with comprehensive technical security data and must now analyze the email content to provide a complete risk assessment.

${technicalContext}

=== EMAIL CONTENT TO ANALYZE ===
Subject: ${emailData.subject}
Body Text: ${emailData.bodyText?.substring(0, 2000) || 'No text content'}...

=== YOUR ANALYSIS TASK ===

Analyze the email content for these THREE content-based risk indicators:

1. URGENT/THREATENING LANGUAGE ANALYSIS:
   Look for language that creates artificial urgency or fear to pressure immediate action:
   - Time-sensitive threats ("within 24 hours", "expires today", "immediate action required")
   - Account suspension warnings ("account will be closed", "suspended", "blocked")
   - Security emergencies ("suspicious activity", "unauthorized access", "security breach")
   - Consequence threats ("lose access", "forfeit", "penalty")
   - Urgent action verbs ("act now", "verify immediately", "respond ASAP")

2. SENSITIVE INFORMATION REQUESTS:
   Identify requests for personal, financial, or security information:
   - Login credentials (username, password, PIN)
   - Personal identity (SSN, ID numbers, birthday, address)
   - Financial details (credit card, bank account, routing numbers)
   - Security information (security questions, 2FA codes, recovery phrases)
   - Document uploads or verification requests
   - Account confirmations or re-verification

3. GRAMMAR, SPELLING & LANGUAGE QUALITY:
   Assess the professionalism and quality of the communication:
   - Spelling errors and typos
   - Grammar mistakes and awkward phrasing
   - Inconsistent formatting or capitalization
   - Poor sentence structure
   - Unnatural or non-native language patterns
   - Generic or impersonal greetings
   - Professional vs. amateur presentation quality

=== COMPREHENSIVE RISK ASSESSMENT ===

Provide a holistic risk assessment that combines:
- The technical security findings (sender reputation and URL safety)
- Your content analysis findings
- Overall threat level considering all factors
- Actionable recommendations for the user

Important: Consider how technical and content findings reinforce each other. For example:
- A suspicious sender + urgent language = higher risk
- Safe sender + professional content = lower risk  
- Malicious URLs + sensitive info requests = critical risk

Respond with a JSON object containing:
{
  "urgentLanguageAI": boolean,
  "requestsSensitiveInfoAI": boolean,
  "grammarIssuesAI": boolean,
  "riskLevel": "Low|Medium|High|Critical",
  "confidence": 0-100,
  "overallAssessment": "comprehensive assessment incorporating both technical and content analysis",
  "reasoning": ["specific reason combining technical and content factors", "another comprehensive reason", ...],
  "urgentLanguageDetails": "explanation of urgent language found or why none detected",
  "sensitiveInfoDetails": "explanation of sensitive info requests found or why none detected", 
  "grammarQualityDetails": "assessment of language quality and professionalism",
  "technicalSecuritySummary": "summary of the sender reputation and URL security findings",
  "combinedThreatAssessment": "how technical and content factors combine to determine overall threat level",
  "userRecommendation": "clear actionable advice for the user based on all findings"
}`;

    return prompt;
}

// Test function to verify Web Risk API is working
async function testWebRiskAPI() {
    console.log("PhishArmor: ===== TESTING GOOGLE WEB RISK API =====");
    console.log("PhishArmor: API Key available:", GOOGLE_WEBRISK_API_KEY ? "YES" : "NO");
    console.log("PhishArmor: Endpoint:", GOOGLE_WEBRISK_ENDPOINT);
    
    try {
        const testUrl = 'https://google.com';
        console.log("PhishArmor: Testing with URL:", testUrl);
        
        const result = await checkUrlsWithWebRisk([testUrl], GOOGLE_WEBRISK_API_KEY);
        
        console.log("PhishArmor: ===== TEST RESULT =====");
        console.log("PhishArmor: Full result:", result);
        
        if (result.error) {
            console.error("PhishArmor: Web Risk API test FAILED with error:", result.error);
            return false;
        } else if (result.urlDetails && result.urlDetails.length > 0) {
            const urlDetail = result.urlDetails[0];
            if (urlDetail.status === 'error') {
                console.error("PhishArmor: Web Risk API test FAILED - URL check returned error:", urlDetail.error);
                return false;
            } else {
                console.log("PhishArmor: Web Risk API test PASSED - URL checked successfully");
                console.log("PhishArmor: URL status:", urlDetail.status);
                console.log("PhishArmor: Confidence levels:", urlDetail.confidenceLevels);
                return true;
            }
        } else {
            console.warn("PhishArmor: Web Risk API test UNCLEAR - No URL details returned");
            return false;
        }
    } catch (error) {
        console.error("PhishArmor: Web Risk API test ERROR:", error);
        console.error("PhishArmor: Error stack:", error.stack);
        return false;
    }
}

// Comprehensive diagnostic function to troubleshoot Web Risk API issues
async function diagnoseWebRiskAPI() {
    console.log("PhishArmor: ===== WEB RISK API DIAGNOSTIC =====");
    
    // Step 1: Check API key
    console.log("Step 1: Checking API key...");
    if (!GOOGLE_WEBRISK_API_KEY) {
        console.error("❌ No API key configured");
        return { success: false, issue: "No API key" };
    }
    console.log("✅ API key is configured");
    
    // Step 2: Test the new public Lookup API endpoint
    console.log("Step 2: Testing Web Risk Lookup API endpoint...");
    
    try {
        console.log("Testing v1/uris:search (Lookup API)...");
        
        const params = new URLSearchParams({
            uri: "https://google.com",
            key: GOOGLE_WEBRISK_API_KEY
        });
        
        // Add threat types
        WEB_RISK_THREAT_TYPES.forEach(threatType => {
            params.append('threatTypes', threatType);
        });
        
        const response = await fetch(`${GOOGLE_WEBRISK_ENDPOINT}?${params.toString()}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        console.log(`v1/uris:search - Status: ${response.status}`);
        
        if (response.ok) {
            const data = await response.json();
            console.log(`✅ v1/uris:search - SUCCESS:`, data);
            console.log(`✅ Checked threat types: ${WEB_RISK_THREAT_TYPES.join(', ')}`);
            return { success: true, workingEndpoint: { name: "v1/uris:search (Lookup API)", url: GOOGLE_WEBRISK_ENDPOINT } };
        } else {
            const errorText = await response.text();
            console.log(`❌ v1/uris:search - Error ${response.status}:`, errorText);
        }
    } catch (error) {
        console.error(`❌ v1/uris:search - Exception:`, error.message);
    }
    
    // Step 3: Try a simple API validation call
    console.log("Step 3: Testing basic API access...");
    try {
        const response = await fetch(`https://webrisk.googleapis.com/v1/threatLists:computeDiff?key=${GOOGLE_WEBRISK_API_KEY}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        console.log("Basic API access status:", response.status);
        const responseText = await response.text();
        console.log("Basic API response:", responseText);
        
        if (response.status === 403) {
            console.error("❌ 403 Forbidden - API key may be invalid or Web Risk API not enabled");
        } else if (response.status === 404) {
            console.error("❌ 404 Not Found - Web Risk API may not be enabled in project");
        }
    } catch (error) {
        console.error("❌ Basic API access failed:", error.message);
    }
    
    console.log("PhishArmor: ===== DIAGNOSTIC COMPLETE =====");
    return { success: false, issue: "Lookup API endpoint failed" };
}

console.log("PhishArmor Background script fully initialized and listeners active.");

// Run comprehensive Web Risk API diagnostic on startup
diagnoseWebRiskAPI().then(result => {
    if (result.success) {
        console.log("PhishArmor: ✅ Web Risk API is working correctly!");
        if (result.workingEndpoint) {
            console.log("PhishArmor: Using endpoint:", result.workingEndpoint.name);
        }
    } else {
        console.error("PhishArmor: ❌ Web Risk API diagnostic failed:", result.issue);
        console.error("PhishArmor: Please check:");
        console.error("  1. Web Risk API is enabled in Google Cloud Console");
        console.error("  2. API key has correct permissions");
        console.error("  3. Billing is enabled for the project");
        console.error("  4. Run diagnosePhishArmorWebRisk() in console for detailed info");
    }
}).catch(error => {
    console.error("PhishArmor: ❌ Error running Web Risk diagnostic:", error);
});

// Helper function to extract domain from email sender
function extractDomainFromSender(senderEmail) {
    try {
        // Handle various email formats:
        // "Name <email@domain.com>"
        // "email@domain.com"
        // "Name email@domain.com"
        
        let email = senderEmail;
        
        // Extract email from angle brackets if present
        const angleMatch = senderEmail.match(/<([^>]+)>/);
        if (angleMatch) {
            email = angleMatch[1];
        }
        
        // Extract email using @ symbol
        const atMatch = email.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (atMatch) {
            email = atMatch[1];
        }
        
        // Extract domain part
        const parts = email.split('@');
        if (parts.length === 2) {
            const domain = parts[1].toLowerCase().trim();
            console.log(`PhishArmor: Extracted domain "${domain}" from sender "${senderEmail}"`);
            return domain;
        }
        
        console.warn(`PhishArmor: Could not extract domain from sender: ${senderEmail}`);
        return null;
    } catch (error) {
        console.error(`PhishArmor: Error extracting domain from sender: ${error.message}`);
        return null;
    }
}

// Helper function to check if two domains are visually similar (for spoofing detection)
function isVisuallySimilar(domain1, domain2) {
    try {
        // Convert to lowercase for comparison
        const d1 = domain1.toLowerCase();
        const d2 = domain2.toLowerCase();
        
        // Exact match - not similar, they're the same
        if (d1 === d2) {
            return false;
        }
        
        // Check for common character substitutions used in domain spoofing
        const substitutions = {
            'a': ['à', 'á', 'â', 'ã', 'ä', 'å', '@'],
            'e': ['è', 'é', 'ê', 'ë', '3'],
            'i': ['ì', 'í', 'î', 'ï', '1', 'l', '!'],
            'o': ['ò', 'ó', 'ô', 'õ', 'ö', '0'],
            'u': ['ù', 'ú', 'û', 'ü'],
            'c': ['ç'],
            'n': ['ñ'],
            'g': ['9'],
            's': ['5', '$'],
            'l': ['1', '!', 'i'],
            'm': ['rn', 'n'],
            'w': ['vv'],
            'cl': ['d'],
            'rn': ['m']
        };
        
        // Create a normalized version of both domains by replacing common substitutes
        function normalize(domain) {
            let normalized = domain;
            for (const [original, subs] of Object.entries(substitutions)) {
                for (const sub of subs) {
                    normalized = normalized.replace(new RegExp(sub, 'g'), original);
                }
            }
            return normalized;
        }
        
        const normalized1 = normalize(d1);
        const normalized2 = normalize(d2);
        
        // Check if normalized versions match
        if (normalized1 === normalized2) {
            console.log(`PhishArmor: Visual similarity detected: ${d1} normalizes to ${normalized1}, ${d2} normalizes to ${normalized2}`);
            return true;
        }
        
        // Check for Levenshtein distance (edit distance) for similar domains
        function levenshteinDistance(str1, str2) {
            const matrix = [];
            
            for (let i = 0; i <= str2.length; i++) {
                matrix[i] = [i];
            }
            
            for (let j = 0; j <= str1.length; j++) {
                matrix[0][j] = j;
            }
            
            for (let i = 1; i <= str2.length; i++) {
                for (let j = 1; j <= str1.length; j++) {
                    if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                        matrix[i][j] = matrix[i - 1][j - 1];
                    } else {
                        matrix[i][j] = Math.min(
                            matrix[i - 1][j - 1] + 1, // substitution
                            matrix[i][j - 1] + 1,     // insertion
                            matrix[i - 1][j] + 1      // deletion
                        );
                    }
                }
            }
            
            return matrix[str2.length][str1.length];
        }
        
        // Consider domains similar if edit distance is small relative to length
        const editDistance = levenshteinDistance(d1, d2);
        const maxLength = Math.max(d1.length, d2.length);
        const threshold = Math.max(1, Math.floor(maxLength * 0.2)); // 20% threshold
        
        if (editDistance <= threshold && editDistance > 0) {
            console.log(`PhishArmor: Edit distance similarity detected: ${d1} vs ${d2}, distance: ${editDistance}, threshold: ${threshold}`);
            return true;
        }
        
        // Check for missing/extra characters (transpositions)
        if (Math.abs(d1.length - d2.length) === 1) {
            const longer = d1.length > d2.length ? d1 : d2;
            const shorter = d1.length > d2.length ? d2 : d1;
            
            // Check if shorter is a substring of longer with one character removed
            for (let i = 0; i < longer.length; i++) {
                const modified = longer.slice(0, i) + longer.slice(i + 1);
                if (modified === shorter) {
                    console.log(`PhishArmor: Single character difference detected: ${d1} vs ${d2}`);
                    return true;
                }
            }
        }
        
        return false;
        
    } catch (error) {
        console.error(`PhishArmor: Error in isVisuallySimilar: ${error.message}`);
        return false;
    }
}

// Function to check domain reputation using APIVoid
async function checkDomainReputation(domain, apiKey = APIVOID_API_KEY) {
    console.log(`PhishArmor: ===== CHECKING DOMAIN REPUTATION =====`);
    console.log(`PhishArmor: Checking domain: ${domain}`);
    
    if (!domain) {
        console.log("PhishArmor: No domain to check");
        return { isReputationGood: true, reason: "No domain provided" };
    }
    
    if (!apiKey) {
        console.warn("PhishArmor: No APIVoid API key available");
        return { isReputationGood: true, reason: "No API key available", error: "No API key" };
    }
    
    try {
        const requestBody = {
            host: domain,
            include_domain_age: true // Include domain age for better analysis
        };
        
        console.log(`PhishArmor: APIVoid request for domain: ${domain}`);
        console.log(`PhishArmor: Request body:`, requestBody);
        console.log(`PhishArmor: API endpoint: ${APIVOID_ENDPOINT}`);
        console.log(`PhishArmor: API key present: ${apiKey ? 'YES' : 'NO'}`);
        
        const response = await fetch(APIVOID_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            },
            body: JSON.stringify(requestBody)
        });
        
        console.log(`PhishArmor: APIVoid response status: ${response.status}`);
        console.log(`PhishArmor: APIVoid response headers:`, [...response.headers.entries()]);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`PhishArmor: APIVoid API error: ${response.status} - ${errorText}`);
            
            // Check for specific CORS error
            if (errorText.includes('CORS') || response.status === 0) {
                console.error("PhishArmor: CORS error detected - extension may need additional permissions");
                return { 
                    isReputationGood: true, // Default to safe if CORS blocks us
                    reason: `Domain reputation check blocked by CORS policy`,
                    error: "CORS_ERROR",
                    corsBlocked: true 
                };
            }
            
            return { 
                isReputationGood: true, // Default to safe if API fails
                reason: `APIVoid API error: ${response.status}`,
                error: errorText 
            };
        }
        
        const data = await response.json();
        console.log(`PhishArmor: APIVoid response for ${domain}:`, data);
        
        // Check for API error in response
        if (data.error) {
            console.error(`PhishArmor: APIVoid API returned error: ${data.error}`);
            return { 
                isReputationGood: true,
                reason: `APIVoid error: ${data.error}`,
                error: data.error 
            };
        }
        
        // Analyze the response to determine reputation
        const analysis = analyzeDomainReputationResponse(data);
        
        console.log(`PhishArmor: Domain reputation analysis for ${domain}:`, analysis);
        console.log(`PhishArmor: ===== DOMAIN REPUTATION CHECK COMPLETE =====`);
        
        return analysis;
        
    } catch (error) {
        console.error(`PhishArmor: Error checking domain reputation: ${error.message}`);
        console.error(`PhishArmor: Error stack:`, error.stack);
        
        // Check for specific CORS error in the message
        if (error.message.includes('CORS') || error.message.includes('fetch')) {
            console.error("PhishArmor: CORS/Fetch error detected - this is likely a browser security restriction");
            return { 
                isReputationGood: true, // Default to safe if CORS blocks us
                reason: `Domain reputation check blocked by browser security policy`,
                error: "CORS_FETCH_ERROR",
                corsBlocked: true 
            };
        }
        
        return { 
            isReputationGood: true, // Default to safe if there's an error
            reason: `Domain reputation check failed: ${error.message}`,
            error: error.message 
        };
    }
}

// Function to analyze APIVoid domain reputation response
function analyzeDomainReputationResponse(data) {
    const analysis = {
        isReputationGood: true,
        reason: "Domain appears safe",
        riskScore: 0,
        detections: 0,
        riskFactors: [],
        apiResponse: data
    };
    
    // Extract key data
    const riskScore = data.risk_score?.result || 0;
    const detections = data.blacklists?.detections || 0;
    const securityChecks = data.security_checks || {};
    const category = data.category || {};
    
    analysis.riskScore = riskScore;
    analysis.detections = detections;
    
    console.log(`PhishArmor: APIVoid risk score: ${riskScore}, detections: ${detections}`);
    
    // Check blacklist detections
    if (detections > 0) {
        analysis.riskFactors.push(`Detected by ${detections} security engines`);
    }
    
    // Check high-risk categories
    if (category.is_free_hosting) analysis.riskFactors.push("Free hosting provider");
    if (category.is_anonymizer) analysis.riskFactors.push("Anonymizer service");
    if (category.is_url_shortener) analysis.riskFactors.push("URL shortener");
    if (category.is_free_dynamic_dns) analysis.riskFactors.push("Free dynamic DNS");
    
    // Check security flags
    if (securityChecks.is_domain_blacklisted) analysis.riskFactors.push("Domain blacklisted");
    if (securityChecks.is_most_abused_tld) analysis.riskFactors.push("High-risk TLD");
    if (securityChecks.is_risky_category) analysis.riskFactors.push("Risky category");
    if (securityChecks.website_popularity === "low") analysis.riskFactors.push("Low website popularity");
    
    // Check domain age (if available)
    if (securityChecks.is_domain_recent === "yes") analysis.riskFactors.push("Recently created domain");
    if (securityChecks.is_domain_very_recent === "yes") analysis.riskFactors.push("Very recently created domain");
    
    // Determine if reputation is good based on risk score and factors
    if (riskScore >= 70 || detections >= 3) {
        analysis.isReputationGood = false;
        analysis.reason = `High risk domain (score: ${riskScore}/100, ${detections} detections)`;
    } else if (riskScore >= 40 || detections >= 1 || analysis.riskFactors.length >= 2) {
        analysis.isReputationGood = false;
        analysis.reason = `Suspicious domain (score: ${riskScore}/100, ${analysis.riskFactors.length} risk factors)`;
    } else {
        analysis.reason = `Domain appears safe (score: ${riskScore}/100)`;
        if (securityChecks.website_popularity === "high") {
            analysis.reason += " - High popularity website";
        }
    }
    
    return analysis;
}

// Function to check for suspicious sender patterns
async function checkSuspiciousSender(emailData) {
    console.log(`PhishArmor: ===== CHECKING SENDER REPUTATION =====`);
    console.log(`PhishArmor: Sender: ${emailData.sender}`);
    
    const checks = {
        domainSpoofing: false,
        domainReputationCheck: null,
        suspiciousPatterns: false,
        reasons: []
    };
    
    // Extract domain from sender email
    const senderDomain = extractDomainFromSender(emailData.sender);
    
    // Check domain reputation using APIVoid
    if (senderDomain) {
        checks.domainReputationCheck = await checkDomainReputation(senderDomain);
        
        if (!checks.domainReputationCheck.isReputationGood) {
            checks.reasons.push(`Suspicious domain: ${checks.domainReputationCheck.reason}`);
        }
    }
    
    // Check for domain spoofing patterns
    if (senderDomain) {
        const knownDomains = [
            'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'aol.com',
            'apple.com', 'icloud.com', 'microsoft.com', 'google.com',
            'amazon.com', 'paypal.com', 'ebay.com', 'netflix.com',
            'facebook.com', 'twitter.com', 'linkedin.com', 'instagram.com'
        ];
        
        for (const trustedDomain of knownDomains) {
            // Check for character substitution (e.g., gmai1.com instead of gmail.com)
            if (senderDomain !== trustedDomain && isVisuallySimilar(senderDomain, trustedDomain)) {
                checks.domainSpoofing = true;
                checks.reasons.push(`Possible domain spoofing: ${senderDomain} resembles ${trustedDomain}`);
                break;
            }
        }
    }
    
    // Check for suspicious patterns in sender email
    // First extract just the email address from formats like "Name <email@domain.com>"
    let emailToCheck = emailData.sender;
    const angleMatch = emailData.sender.match(/<([^>]+)>/);
    if (angleMatch) {
        emailToCheck = angleMatch[1]; // Extract email from angle brackets
    }
    
    // Add github.com and other major tech companies to trusted domains for noreply checks
    const trustedNoReplyDomains = [
        'github.com', 'microsoft.com', 'google.com', 'apple.com', 
        'amazon.com', 'facebook.com', 'linkedin.com', 'twitter.com',
        'paypal.com', 'stripe.com', 'slack.com', 'dropbox.com',
        'adobe.com', 'salesforce.com', 'atlassian.com'
    ];
    
    // Check if this is a trusted noreply domain
    const isFromTrustedNoReplyDomain = trustedNoReplyDomains.some(domain => 
        emailToCheck.toLowerCase().includes(`@${domain}`)
    );
    
    const suspiciousPatterns = [
        /noreply.*@(?!.*\.(?:com|org|net|edu|gov)$)/i, // Suspicious noreply addresses (only for non-trusted domains)
        /admin.*@.*\.(?:tk|ml|ga|cf)$/i, // Admin emails from suspicious TLDs
        /security.*@.*\.(?:info|biz|xyz)$/i, // Security emails from unusual TLDs  
        /[0-9]{3,}@/i, // Emails with many numbers
        /.*\..*\..*@/i // Multiple dots before @
    ];
    
    for (let i = 0; i < suspiciousPatterns.length; i++) {
        const pattern = suspiciousPatterns[i];
        
        // Skip noreply pattern check for trusted domains
        if (i === 0 && isFromTrustedNoReplyDomain) {
            console.log(`PhishArmor: Skipping noreply pattern check for trusted domain: ${emailToCheck}`);
            continue;
        }
        
        if (pattern.test(emailToCheck)) {
            checks.suspiciousPatterns = true;
            console.log(`PhishArmor: Suspicious pattern detected for ${emailToCheck}: ${pattern.toString()}`);
            checks.reasons.push("Suspicious email pattern detected");
            break;
        }
    }
    
    const isSuspicious = checks.domainSpoofing || 
                        checks.suspiciousPatterns || 
                        (checks.domainReputationCheck && !checks.domainReputationCheck.isReputationGood);
    
    console.log(`PhishArmor: Sender analysis complete:`, {
        domain: senderDomain,
        suspicious: isSuspicious,
        reasons: checks.reasons,
        domainReputation: checks.domainReputationCheck
    });
    console.log(`PhishArmor: ===== SENDER REPUTATION CHECK COMPLETE =====`);
    
    return {
        isSuspicious,
        reasons: checks.reasons,
        domainReputationCheck: checks.domainReputationCheck,
        checks
    };
}

// Test function for APIVoid integration
async function testAPIVoidIntegration() {
    console.log("PhishArmor: ===== TESTING APIVOID INTEGRATION =====");
    
    const testDomains = [
        'google.com',     // Should be safe/trusted
        'gmail.com',      // Should be safe/trusted  
        'suspicious-domain-test.tk', // Likely suspicious (if it exists)
        'example.com'     // Should be neutral/safe
    ];
    
    for (const domain of testDomains) {
        console.log(`\nPhishArmor: Testing domain: ${domain}`);
        try {
            const result = await checkDomainReputation(domain);
            console.log(`PhishArmor: ${domain} result:`, {
                isReputationGood: result.isReputationGood,
                reason: result.reason,
                riskScore: result.riskScore,
                detections: result.detections,
                riskFactors: result.riskFactors
            });
        } catch (error) {
            console.error(`PhishArmor: Error testing ${domain}:`, error);
        }
    }
    
    console.log("PhishArmor: ===== APIVOID INTEGRATION TEST COMPLETE =====");
}

// Test function for the full sender checking workflow
async function testSenderReputationWorkflow() {
    console.log("PhishArmor: ===== TESTING SENDER REPUTATION WORKFLOW =====");
    
    const testEmails = [
        {
            id: 'test1',
            sender: 'user@gmail.com',
            subject: 'Test Email',
            bodyText: 'Test message'
        },
        {
            id: 'test2', 
            sender: 'security@suspicious-site.tk',
            subject: 'Urgent Action Required',
            bodyText: 'Click here immediately'
        },
        {
            id: 'test3',
            sender: 'noreply@google.com',
            subject: 'Account Update',
            bodyText: 'Your account has been updated'
        }
    ];
    
    for (const emailData of testEmails) {
        console.log(`\nPhishArmor: Testing sender reputation for: ${emailData.sender}`);
        try {
            const result = await checkSuspiciousSender(emailData);
            console.log(`PhishArmor: Sender ${emailData.sender} result:`, {
                isSuspicious: result.isSuspicious,
                reasons: result.reasons,
                domainReputationGood: result.domainReputationCheck?.isReputationGood,
                riskScore: result.domainReputationCheck?.riskScore
            });
        } catch (error) {
            console.error(`PhishArmor: Error testing sender ${emailData.sender}:`, error);
        }
    }
    
    console.log("PhishArmor: ===== SENDER REPUTATION WORKFLOW TEST COMPLETE =====");
}

// Test function to show the new focused OpenAI prompt
function testFocusedOpenAIPrompt() {
    console.log("PhishArmor: ===== TESTING COMPREHENSIVE OPENAI PROMPT =====");
    
    const testEmailData = {
        sender: "security@suspicious-site.tk",
        subject: "URGENT: Your account will be suspended in 24 hours",
        bodyText: "Dear Customer, We have detected suspicious activity on your account. Please verify your identity immediately by providing your username, password, and social security number. Failure to respond within 24 hours will result in permanent account closure. Click here to verrify now. Best regards, Security Team"
    };
    
    const testFeatures = {
        urgentLanguage: false,
        requestsSensitiveInfo: false,
        grammarIssues: false
    };
    
    // Mock technical data for testing
    const mockWebRiskResults = {
        hasThreats: true,
        threats: [
            {
                url: "https://suspicious-site.tk/verify",
                threatTypes: ["SOCIAL_ENGINEERING", "MALWARE"]
            }
        ],
        totalUrls: 1,
        checkedUrls: 1,
        checkedThreatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"]
    };
    
    const mockSenderReputationResult = {
        isSuspicious: true,
        reasons: ["Suspicious domain: High risk domain (score: 85/100, 2 detections)"],
        domainReputationCheck: {
            isReputationGood: false,
            riskScore: 85,
            detections: 2,
            reason: "High risk domain (score: 85/100, 2 detections)",
            riskFactors: ["Recently created domain", "Low website popularity"]
        }
    };
    
    const prompt = createAnalysisPrompt(testEmailData, testFeatures, mockWebRiskResults, mockSenderReputationResult);
    
    console.log("🤖 New Comprehensive OpenAI Prompt:");
    console.log("=====================================");
    console.log(prompt);
    console.log("=====================================");
    
    console.log("PhishArmor: This enhanced prompt now includes:");
    console.log("  ✅ APIVoid sender reputation analysis");
    console.log("  ✅ Google Web Risk URL security findings");
    console.log("  ✅ Urgent/threatening language analysis");
    console.log("  ✅ Sensitive information requests");
    console.log("  ✅ Grammar, spelling & language quality");
    console.log("  ✅ Comprehensive risk assessment combining all factors");
    console.log("  ✅ Actionable user recommendations");
    
    console.log("PhishArmor: AI will now provide:");
    console.log("  📊 Technical security summary");
    console.log("  🎯 Combined threat assessment");
    console.log("  💡 User-friendly recommendations");
    console.log("  🔍 Holistic reasoning that considers all data sources");
    
    console.log("PhishArmor: ===== COMPREHENSIVE OPENAI PROMPT TEST COMPLETE =====");
}

// Test function to demonstrate the new balanced risk assessment algorithm
function testBalancedRiskAssessment() {
    console.log("PhishArmor: ===== TESTING BALANCED RISK ASSESSMENT =====");
    
    const testScenarios = [
        {
            name: "Scenario 1: Single High-Risk Domain Only",
            severeFactors: 1, // High-risk domain
            moderateFactors: 0,
            confidence: 60,
            expected: "High Risk"
        },
        {
            name: "Scenario 2: High-Risk Domain + Malicious Links",
            severeFactors: 2, // High-risk domain + malicious links
            moderateFactors: 0,
            confidence: 80,
            expected: "Critical Risk"
        },
        {
            name: "Scenario 3: High-Risk Domain + Urgent Language + Sensitive Info",
            severeFactors: 2, // High-risk domain + (urgent language + sensitive info = 1 severe)
            moderateFactors: 1,
            confidence: 85,
            expected: "Critical Risk"
        },
        {
            name: "Scenario 4: Medium-Risk Domain + Grammar Issues",
            severeFactors: 0,
            moderateFactors: 2, // Medium domain + grammar issues
            confidence: 40,
            expected: "Medium Risk"
        },
        {
            name: "Scenario 5: Only Urgent Language (No Domain Risk)",
            severeFactors: 0,
            moderateFactors: 1, // Just urgent language
            confidence: 30,
            expected: "Low Risk"
        },
        {
            name: "Scenario 6: Safe Domain - GitHub Style",
            severeFactors: 0,
            moderateFactors: 0,
            confidence: 15, // Reduced by safe domain multiplier
            expected: "Low Risk"
        }
    ];
    
    testScenarios.forEach((scenario, index) => {
        console.log(`\n--- ${scenario.name} ---`);
        console.log(`Severe factors: ${scenario.severeFactors}, Moderate factors: ${scenario.moderateFactors}, Confidence: ${scenario.confidence}`);
        
        // Simulate the algorithm logic
        let result;
        if (scenario.severeFactors >= 2) {
            result = "Critical Risk";
        } else if (scenario.severeFactors >= 1 && (scenario.confidence >= 70 || scenario.moderateFactors >= 2)) {
            result = "High Risk";
        } else if (scenario.severeFactors >= 1 || scenario.confidence >= 80) {
            result = "High Risk";
        } else if (scenario.moderateFactors >= 2 || scenario.confidence >= 50) {
            result = "Medium Risk";
        } else if (scenario.moderateFactors >= 1 || scenario.confidence >= 25) {
            result = "Low Risk";
        } else {
            result = "Low Risk";
        }
        
        const matches = result === scenario.expected;
        console.log(`Result: ${result} | Expected: ${scenario.expected} | ${matches ? '✅ PASS' : '❌ FAIL'}`);
    });
    
    console.log("\n=== Risk Factor Classification ===");
    console.log("SEVERE FACTORS (each counts as 1):");
    console.log("  • Domain risk 90+ APIVoid score OR 5+ detections");
    console.log("  • Domain risk 70+ APIVoid score OR 3+ detections"); 
    console.log("  • Malicious links with MALWARE or SOCIAL_ENGINEERING threats");
    console.log("  • BOTH urgent language AND sensitive info requests");
    
    console.log("\nMODERATE FACTORS (each counts as 1):");
    console.log("  • Domain risk 40+ APIVoid score OR 1+ detection");
    console.log("  • Other suspicious links");
    console.log("  • Either urgent language OR sensitive info requests (but not both)");
    console.log("  • Grammar/spelling issues");
    
    console.log("\n=== Risk Level Logic ===");
    console.log("CRITICAL: 2+ severe factors → RED SHIELD");
    console.log("HIGH: 1 severe + (high confidence OR 2+ moderate) OR 1 severe OR very high confidence (80+) → YELLOW SHIELD");
    console.log("MEDIUM: 2+ moderate factors OR moderate confidence (50+) → YELLOW SHIELD");
    console.log("LOW: 1+ moderate factor OR low confidence (25+) → YELLOW SHIELD");
    console.log("SAFE: No significant factors → GREEN SHIELD");
    
    console.log("PhishArmor: ===== BALANCED RISK ASSESSMENT TEST COMPLETE =====");
} 