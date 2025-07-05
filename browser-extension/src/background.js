// Background service worker for Veritas AI Agent
// Handles API communication and extension lifecycle

const API_ENDPOINT = 'https://api.veritas.ai/verify';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// In-memory cache for verification results
const verificationCache = new Map();

// Extension installation handler
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Veritas AI Agent installed');
    
    // Set default settings
    chrome.storage.sync.set({
      enabled: true,
      apiEndpoint: API_ENDPOINT,
      confidenceThreshold: 0.8,
      showTooltips: true,
      autoVerify: true
    });
  } else if (details.reason === 'update') {
    console.log('Veritas AI Agent updated');
  }
});

// Message handling from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'VERIFY_CLAIM') {
    handleVerificationRequest(request.claim, sender.tab.id)
      .then(sendResponse)
      .catch(error => {
        console.error('Verification error:', error);
        sendResponse({
          status: 'ERROR',
          error: error.message
        });
      });
    return true; // Keep message channel open for async response
  }
  
  if (request.type === 'GET_CONFIG') {
    chrome.storage.sync.get(null, (config) => {
      sendResponse(config);
    });
    return true;
  }
  
  if (request.type === 'UPDATE_CONFIG') {
    chrome.storage.sync.set(request.config, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// Handle verification requests
async function handleVerificationRequest(claimText, tabId) {
  try {
    // Check cache first
    const cacheKey = generateCacheKey(claimText);
    const cachedResult = verificationCache.get(cacheKey);
    
    if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_DURATION) {
      return {
        ...cachedResult.result,
        cached: true
      };
    }
    
    // Get configuration
    const config = await getConfig();
    
    if (!config.enabled) {
      return {
        status: 'DISABLED',
        message: 'Veritas is disabled'
      };
    }
    
    // Make API request
    const response = await fetch(config.apiEndpoint || API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey || 'default-key'}`,
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({
        claim_text: claimText,
        source: 'browser-extension',
        timestamp: new Date().toISOString(),
        extension_version: chrome.runtime.getManifest().version
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    // Cache the result
    verificationCache.set(cacheKey, {
      result,
      timestamp: Date.now()
    });
    
    // Clean up old cache entries
    cleanupCache();
    
    return {
      ...result,
      cached: false
    };
    
  } catch (error) {
    console.error('Verification request failed:', error);
    throw error;
  }
}

// Generate cache key for claim text
function generateCacheKey(text) {
  const normalizedText = text.toLowerCase().trim().replace(/\s+/g, ' ');
  return btoa(normalizedText).replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
}

// Get extension configuration
function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(null, resolve);
  });
}

// Clean up old cache entries
function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of verificationCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      verificationCache.delete(key);
    }
  }
}

// Periodic cache cleanup
setInterval(cleanupCache, CACHE_DURATION);

// Handle extension updates
chrome.runtime.onUpdateAvailable.addListener(() => {
  chrome.runtime.reload();
});

// Handle uninstall
chrome.runtime.setUninstallURL('https://veritas.ai/uninstall-feedback'); 