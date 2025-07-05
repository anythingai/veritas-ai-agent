import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';

// Chrome API type declarations
// declare global {
//   interface Window {
//     chrome: {
//       storage: {
//         local: {
//           get: (keys: string | string[]) => Promise<any>;
//           set: (items: any) => Promise<void>;
//         };
//       };
//       tabs: {
//         query: (queryInfo: any) => Promise<any[]>;
//         sendMessage: (tabId: number, message: any) => Promise<any>;
//       };
//       runtime: {
//         openOptionsPage: () => void;
//       };
//     };
//   }
// }

interface VeritasStats {
  totalVerifications: number;
  verifiedClaims: number;
  unverifiedClaims: number;
  averageConfidence: number;
}

interface ExtensionConfig {
  enabled: boolean;
  apiEndpoint: string;
  confidenceThreshold: number;
  showTooltips: boolean;
  autoVerify: boolean;
}

const Popup: React.FC = () => {
  const [stats, setStats] = useState<VeritasStats>({
    totalVerifications: 0,
    verifiedClaims: 0,
    unverifiedClaims: 0,
    averageConfidence: 0
  });
  
  const [config, setConfig] = useState<ExtensionConfig>({
    enabled: true,
    apiEndpoint: process.env.VERITAS_API_ENDPOINT || 'https://api.veritas.ai/verify',
    confidenceThreshold: 0.8,
    showTooltips: true,
    autoVerify: true
  });
  
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Load configuration
      const storedConfig = await chrome.storage.sync.get(null);
      const defaultConfig: ExtensionConfig = {
        enabled: true,
        apiEndpoint: '',
        confidenceThreshold: 0.8,
        showTooltips: true,
        autoVerify: false
      };
      setConfig({ ...defaultConfig, ...storedConfig });
      
      // Load statistics
      const storedStats = await chrome.storage.local.get('veritas_stats');
      if (storedStats.veritas_stats) {
        setStats(storedStats.veritas_stats);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleEnabled = async () => {
    const newConfig = { ...config, enabled: !config.enabled };
    await chrome.storage.sync.set(newConfig);
    setConfig(newConfig);
    
    // Notify content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'VERITAS_CONFIG_UPDATE',
          config: newConfig
        });
      }
    });
  };

  const updateConfig = async (updates: Partial<ExtensionConfig>) => {
    const newConfig = { ...config, ...updates };
    await chrome.storage.sync.set(newConfig);
    setConfig(newConfig);
  };

  if (loading) {
    return (
      <div className="veritas-popup">
        <div className="veritas-popup-header">
          <h1 className="veritas-popup-title">Veritas AI Agent</h1>
        </div>
        <div className="veritas-popup-content">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="veritas-popup">
      <div className="veritas-popup-header">
        <h1 className="veritas-popup-title">Veritas AI Agent</h1>
        <div className="veritas-toggle-container">
          <label className="veritas-toggle" htmlFor="extension-enabled">
            <input
              id="extension-enabled"
              type="checkbox"
              checked={config.enabled}
              onChange={toggleEnabled}
              aria-label="Enable or disable Veritas AI Agent extension"
              title="Toggle extension on/off"
            />
            <span className="veritas-toggle-slider"></span>
          </label>
        </div>
      </div>
      
      <div className="veritas-popup-content">
        <div className="veritas-popup-section">
          <h3>Statistics</h3>
          <div className="veritas-stats">
            <div className="veritas-stat">
              <div className="veritas-stat-value">{stats.totalVerifications}</div>
              <div className="veritas-stat-label">Total Verifications</div>
            </div>
            <div className="veritas-stat">
              <div className="veritas-stat-value">{stats.verifiedClaims}</div>
              <div className="veritas-stat-label">Verified</div>
            </div>
            <div className="veritas-stat">
              <div className="veritas-stat-value">{stats.unverifiedClaims}</div>
              <div className="veritas-stat-label">Unverified</div>
            </div>
            <div className="veritas-stat">
              <div className="veritas-stat-value">{Math.round(stats.averageConfidence * 100)}%</div>
              <div className="veritas-stat-label">Avg Confidence</div>
            </div>
          </div>
        </div>
        
        <div className="veritas-popup-section">
          <h3>Settings</h3>
          <div className="veritas-setting">
            <label htmlFor="show-tooltips">
              <input
                id="show-tooltips"
                type="checkbox"
                checked={config.showTooltips}
                onChange={(e) => updateConfig({ showTooltips: e.target.checked })}
                aria-label="Show tooltips for verification badges"
                title="Enable tooltips to show verification details on hover"
              />
              Show tooltips
            </label>
          </div>
          <div className="veritas-setting">
            <label htmlFor="auto-verify">
              <input
                id="auto-verify"
                type="checkbox"
                checked={config.autoVerify}
                onChange={(e) => updateConfig({ autoVerify: e.target.checked })}
                aria-label="Automatically verify claims"
                title="Automatically verify claims without manual intervention"
              />
              Auto-verify claims
            </label>
          </div>
          <div className="veritas-setting">
            <label htmlFor="confidence-threshold">
              Confidence Threshold: {Math.round(config.confidenceThreshold * 100)}%
              <input
                id="confidence-threshold"
                type="range"
                min="0.5"
                max="1.0"
                step="0.1"
                value={config.confidenceThreshold}
                onChange={(e) => updateConfig({ confidenceThreshold: parseFloat(e.target.value) })}
                aria-label="Confidence threshold slider"
                title="Adjust the confidence threshold for verification"
              />
            </label>
          </div>
        </div>
        
        <div className="veritas-popup-section">
          <button
            onClick={() => chrome.runtime.openOptionsPage()}
            className="veritas-button"
          >
            Advanced Settings
          </button>
        </div>
      </div>
    </div>
  );
};

// Initialize the popup
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('popup-root');
  if (container) {
    ReactDOM.render(<Popup />, container);
  }
});

export default Popup; 