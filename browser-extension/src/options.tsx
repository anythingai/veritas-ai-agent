import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';

interface ExtensionConfig {
  enabled: boolean;
  apiEndpoint: string;
  confidenceThreshold: number;
  showTooltips: boolean;
  autoVerify: boolean;
  apiKey?: string;
}

const Options: React.FC = () => {
  const [config, setConfig] = useState<ExtensionConfig>({
    enabled: true,
    apiEndpoint: 'https://api.veritas.ai/verify',
    confidenceThreshold: 0.8,
    showTooltips: true,
    autoVerify: true
  });
  
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const storedConfig = await chrome.storage.sync.get(null);
      const defaultConfig: ExtensionConfig = {
        enabled: true,
        apiEndpoint: '',
        confidenceThreshold: 0.8,
        showTooltips: true,
        autoVerify: false
      };
      setConfig({ ...defaultConfig, ...storedConfig });
    } catch (error) {
      console.error('Failed to load config:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    try {
      await chrome.storage.sync.set(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  };

  const resetConfig = async () => {
    const defaultConfig = {
      enabled: true,
      apiEndpoint: 'https://api.veritas.ai/verify',
      confidenceThreshold: 0.8,
      showTooltips: true,
      autoVerify: true
    };
    setConfig(defaultConfig);
    await chrome.storage.sync.set(defaultConfig);
  };

  if (loading) {
    return (
      <div className="veritas-options">
        <div className="veritas-options-header">
          <h1 className="veritas-options-title">Veritas AI Agent - Settings</h1>
        </div>
        <div className="veritas-options-content">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="veritas-options">
      <div className="veritas-options-header">
        <h1 className="veritas-options-title">Veritas AI Agent - Settings</h1>
        <p className="veritas-options-subtitle">Configure your fact-checking experience</p>
      </div>
      
      <div className="veritas-options-content">
        <div className="veritas-options-section">
          <h2>General Settings</h2>
          
          <div className="veritas-option-row">
            <div className="veritas-option-label">Enable Veritas</div>
            <div className="veritas-option-description">Turn on automatic fact-checking</div>
            <label className="veritas-toggle" htmlFor="enabledToggle">
              <input
                id="enabledToggle"
                name="enabledToggle"
                type="checkbox"
                title="Enable Veritas"
                checked={config.enabled}
                onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
              />
              <span className="veritas-toggle-slider"></span>
            </label>
          </div>
          
          <div className="veritas-option-row">
            <div className="veritas-option-label">Auto-Verify Claims</div>
            <div className="veritas-option-description">Automatically check claims as they appear</div>
            <label className="veritas-toggle" htmlFor="autoVerifyToggle">
              <input
                id="autoVerifyToggle"
                name="autoVerifyToggle"
                type="checkbox"
                title="Auto-Verify Claims"
                checked={config.autoVerify}
                onChange={(e) => setConfig({ ...config, autoVerify: e.target.checked })}
              />
              <span className="veritas-toggle-slider"></span>
            </label>
          </div>
          
          <div className="veritas-option-row">
            <div className="veritas-option-label">Show Tooltips</div>
            <div className="veritas-option-description">Display citation details on hover</div>
            <label className="veritas-toggle" htmlFor="showTooltipsToggle">
              <input
                id="showTooltipsToggle"
                name="showTooltipsToggle"
                type="checkbox"
                title="Show Tooltips"
                checked={config.showTooltips}
                onChange={(e) => setConfig({ ...config, showTooltips: e.target.checked })}
              />
              <span className="veritas-toggle-slider"></span>
            </label>
          </div>
        </div>
        
        <div className="veritas-options-section">
          <h2>Verification Settings</h2>
          
          <div className="veritas-option-row">
            <div className="veritas-option-label">Confidence Threshold</div>
            <div className="veritas-option-description">
              Minimum confidence level for verification ({Math.round(config.confidenceThreshold * 100)}%)
            </div>
            <label htmlFor="confidenceThreshold">Confidence Threshold</label>
            <input
              id="confidenceThreshold"
              name="confidenceThreshold"
              title="Confidence Threshold"
              type="range"
              min="0.5"
              max="1.0"
              step="0.1"
              value={config.confidenceThreshold}
              onChange={(e) => setConfig({ ...config, confidenceThreshold: parseFloat(e.target.value) })}
              className="veritas-range"
            />
          </div>
        </div>
        
        <div className="veritas-options-section">
          <h2>API Configuration</h2>
          
          <div className="veritas-option-row">
            <div className="veritas-option-label">API Endpoint</div>
            <div className="veritas-option-description">Verification service URL</div>
            <label htmlFor="apiEndpoint">API Endpoint</label>
            <input
              id="apiEndpoint"
              name="apiEndpoint"
              title="API Endpoint"
              placeholder="Enter API endpoint"
              type="url"
              value={config.apiEndpoint}
              onChange={(e) => setConfig({ ...config, apiEndpoint: e.target.value })}
              className="veritas-input"
            />
          </div>
          
          <div className="veritas-option-row">
            <div className="veritas-option-label">API Key (Optional)</div>
            <div className="veritas-option-description">Your Veritas API key for enhanced access</div>
            <label htmlFor="apiKey">API Key</label>
            <input
              id="apiKey"
              name="apiKey"
              title="API Key"
              type="password"
              value={config.apiKey || ''}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              className="veritas-input"
              placeholder="Enter your API key"
            />
          </div>
        </div>
        
        <div className="veritas-options-section">
          <h2>Actions</h2>
          
          <div className="veritas-actions">
            <button onClick={saveConfig} className="veritas-button veritas-button-primary">
              {saved ? 'Saved!' : 'Save Settings'}
            </button>
            <button onClick={resetConfig} className="veritas-button veritas-button-secondary">
              Reset to Defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

ReactDOM.render(<Options />, document.getElementById('options-root')); 