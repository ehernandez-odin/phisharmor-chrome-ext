document.addEventListener('DOMContentLoaded', function() {
    const useProVersionRadio = document.getElementById('useProVersion');
    const useUserApiKeyRadio = document.getElementById('useUserApiKey');
    const userApiKeySection = document.getElementById('userApiKeySection');
    const userApiKeyInput = document.getElementById('userApiKeyInput');
    const abuseipdbApiKeyInput = document.getElementById('abuseipdbApiKeyInput');
    const saveSettingsButton = document.getElementById('saveSettingsButton');
    const statusMessage = document.getElementById('statusMessage');
    const exitButton = document.getElementById('exitSettingsButton');

    // Function to update UI based on saved state
    function updateApiKeyDisplay(apiKey) {
        if (apiKey) {
            userApiKeyInput.value = apiKey;
            userApiKeyInput.disabled = true; // Grey out
            // saveSettingsButton.textContent = 'Edit API Key'; // Optional: change button text
        } else {
            userApiKeyInput.disabled = false;
            // saveSettingsButton.textContent = 'Save Settings';
        }
    }

    // Load saved settings
    chrome.storage.local.get(['useProVersion', 'userApiKey', 'abuseipdbApiKey'], function(items) {
        // Load OpenAI settings
        if (items.useProVersion) {
            useProVersionRadio.checked = true;
            userApiKeySection.style.display = 'none';
            userApiKeyInput.disabled = true;
            exitButton.style.display = 'block'; // Show exit if already configured for pro
            saveSettingsButton.style.display = 'none'; // Hide save if pro is set
        } else {
            useUserApiKeyRadio.checked = true;
            userApiKeySection.style.display = 'block';
            if (items.userApiKey) {
                updateApiKeyDisplay(items.userApiKey);
                exitButton.style.display = 'block';
                saveSettingsButton.textContent = 'Edit API Key';
            } else {
                userApiKeyInput.disabled = false;
                exitButton.style.display = 'none';
                saveSettingsButton.textContent = 'Save Settings';
            }
        }

        // Load AbuseIPDB settings
        if (items.abuseipdbApiKey) {
            abuseipdbApiKeyInput.value = items.abuseipdbApiKey;
        }
    });

    useProVersionRadio.addEventListener('change', function() {
        if (this.checked) {
            userApiKeySection.style.display = 'none';
            userApiKeyInput.disabled = true; // Disable input when pro is selected
            userApiKeyInput.value = ''; // Clear any visible key
            // When switching to Pro, we might want to save immediately or require a click
            // For now, let's allow save to confirm the switch to Pro.
            saveSettingsButton.textContent = 'Save Settings';
            saveSettingsButton.style.display = 'block';
            exitButton.style.display = 'none';
        }
    });

    useUserApiKeyRadio.addEventListener('change', function() {
        if (this.checked) {
            userApiKeySection.style.display = 'block';
            userApiKeyInput.disabled = false;
            // If they switch to user API and had one, re-enable editing
            // saveSettingsButton.textContent = 'Save Settings'; 
            // The load logic handles if a key exists and sets button to 'Edit'
            // For now, always set to 'Save Settings' to make it clear an action is needed.
            saveSettingsButton.textContent = 'Save Settings';
            saveSettingsButton.style.display = 'block';
            exitButton.style.display = 'none';
        }
    });

    saveSettingsButton.addEventListener('click', function() {
        if (saveSettingsButton.textContent === 'Edit API Key') {
            userApiKeyInput.disabled = false;
            userApiKeyInput.focus();
            saveSettingsButton.textContent = 'Save Settings';
            exitButton.style.display = 'none';
            statusMessage.textContent = 'You can now edit your API key.';
            statusMessage.style.color = '#3498db'; // Info color
            return;
        }

        const usePro = useProVersionRadio.checked;
        const apiKey = userApiKeyInput.value.trim();
        const abuseipdbKey = abuseipdbApiKeyInput.value.trim();

        if (!usePro && !apiKey) {
            statusMessage.textContent = 'Error: Please provide an OpenAI API key if not using the Pro version.';
            statusMessage.style.color = 'red';
            return;
        }
        if (!usePro && apiKey && (!apiKey.startsWith('sk-') || apiKey.length < 50)) { // Typical OpenAI key length
             statusMessage.textContent = 'Error: Invalid OpenAI API key format. It should start with \'sk-\' and be longer.';
            statusMessage.style.color = 'red';
            return;
        }

        // Validate AbuseIPDB key if provided
        if (abuseipdbKey && abuseipdbKey.length < 20) {
            statusMessage.textContent = 'Error: AbuseIPDB API key appears too short. Please check your key.';
            statusMessage.style.color = 'red';
            return;
        }

        chrome.storage.local.set({
            useProVersion: usePro,
            userApiKey: usePro ? null : apiKey,
            abuseipdbApiKey: abuseipdbKey || null,
            isLoggedIn: true 
        }, function() {
            if (chrome.runtime.lastError) {
                statusMessage.textContent = `Error saving settings: ${chrome.runtime.lastError.message}`;
                statusMessage.style.color = 'red';
                return;
            }
            
            let message = 'Settings saved successfully!';
            if (abuseipdbKey) {
                message += ' AbuseIPDB integration enabled for enhanced domain verification.';
            } else {
                message += ' Using basic domain heuristics (consider adding AbuseIPDB key for better verification).';
            }
            
            statusMessage.textContent = message;
            statusMessage.style.color = 'green';
            if (!usePro && apiKey) {
                updateApiKeyDisplay(apiKey);
                saveSettingsButton.textContent = 'Edit API Key';
            } else if (usePro) {
                saveSettingsButton.style.display = 'none'; // Hide save if Pro confirmed
            }
            exitButton.style.display = 'block';
            setTimeout(() => {
                statusMessage.textContent = '';
            }, 5000);
        });
    });

    if (exitButton) {
        exitButton.addEventListener('click', function() {
            window.close(); // Standard way to close a popup/options page opened by extension
        });
    }
}); 