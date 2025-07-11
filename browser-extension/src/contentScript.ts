// Content script for Veritas AI Agent
// Waits for ChatGPT answer completion and traverses <div[data-scroll-target]> p, li nodes

interface VerificationResult {
  status: 'VERIFIED' | 'UNVERIFIED' | 'UNKNOWN' | 'PENDING' | 'ERROR';
  confidence: number | null;
  citations: Array<{
    cid: string;
    title: string;
    snippet: string;
  }>;
  error?: string;
}

interface ClaimData {
  text: string;
  element: Element;
  id: string;
  attempts?: number;
}

export class VeritasContentScript {
  private verificationQueue: Map<string, ClaimData> = new Map();
  // Track nodes we have already processed to avoid duplicates
  private processedNodes: WeakSet<Element> = new WeakSet();
  private processedTexts: Set<string> = new Set();
  private processingQueue = false;
  private processQueueTimeout: NodeJS.Timeout | null = null;
  private observer: MutationObserver | null = null;
  private disposed = false;
  private config = {
    apiEndpoint: process.env.VERITAS_API_ENDPOINT || 'https://api.veritas.ai/verify',
    maxRetries: 3,
    retryDelay: 1000,
    batchSize: 5,
    maxQueueSize: 50,
    confidenceThresholds: {
      verified: 0.8,
      unverified: 0.5
    }
  };
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    try {
      this.init();
    } catch (error) {
      console.error('Veritas: Failed to initialize content script:', error);
    }
  }

  private init(): void {
    this.setupMessageListener();
    this.setupMutationObserver();
    this.processExistingNodes();
    this.setupPeriodicCleanup();
  }

  private setupMessageListener(): void {
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data?.type?.startsWith('VERITAS_')) {
        return;
      }

      switch (event.data.type) {
        case 'VERITAS_VERIFICATION_RESULT':
          this.handleVerificationResult(event.data.result);
          break;
        case 'VERITAS_CONFIG_UPDATE':
          this.updateConfig(event.data.config);
          break;
      }
    });
  }

  private setupMutationObserver(): void {
    this.observer = new MutationObserver((mutations) => {
      const nodesToProcess: Element[] = [];
      
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              if (this.isChatNode(element)) {
                nodesToProcess.push(element);
              } else {
                // Check for child nodes that match chat criteria
                const childNodes = element.querySelectorAll('div[data-scroll-target] p, div[data-scroll-target] li');
                childNodes.forEach((childNode) => {
                  if (this.shouldProcessNode(childNode)) {
                    nodesToProcess.push(childNode);
                  }
                });
              }
            }
          });
        }
      });

      // Process the specific nodes that were added
      if (nodesToProcess.length > 0) {
        nodesToProcess.forEach((node) => {
          if (this.shouldProcessNode(node)) {
            this.processNode(node);
          }
        });
        this.processQueue();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  private isChatNode(element: Element): boolean {
    return element.matches('div[data-scroll-target] p, div[data-scroll-target] li') ||
           element.closest('div[data-scroll-target]') !== null;
  }

  private processExistingNodes(): void {
    this.processChatNodes();
  }

  private processChatNodes(): void {
    const nodes = document.querySelectorAll('div[data-scroll-target] p, div[data-scroll-target] li');
    
    nodes.forEach((node) => {
      if (this.shouldProcessNode(node)) {
        this.processNode(node);
      }
    });

    this.processQueue();
  }

  private shouldProcessNode(node: Element): boolean {
    // Skip if already processed or contains no meaningful text
    if (this.processedNodes.has(node) ||
        (node.textContent && this.processedTexts.has(node.textContent.trim())) ||
        node.querySelector('.veritas-badge') || 
        !node.textContent?.trim()) {
      return false;
    }

    // Skip very short text
    const text = node.textContent?.trim();
    if (!text || text.length < 10) return false;

    // Skip system messages and user inputs - check for data-message-author-role attribute
    const messageContainer = node.closest('[data-message-author-role]');
    if (messageContainer) {
      const role = messageContainer.getAttribute('data-message-author-role');
      if (role === 'system' || role === 'user') {
        return false;
      }
    }
    
    return true;
  }

  private processNode(node: Element): void {
    const text = node.textContent?.trim();
    if (!text || text.length < 10) return; // Skip very short text
    if (this.processedTexts.has(text)) return;

    // Skip if we've already processed this node (extra safety)
    if (this.processedNodes.has(node)) return;

    // Check if already processed by badge presence
    if (node.querySelector('.veritas-badge')) {
      return;
    }

    // Check queue size limit
    if (this.verificationQueue.size >= this.config.maxQueueSize) {
      console.warn('Veritas: Queue size limit reached, skipping new claims');
      return;
    }

    // Record node early to avoid race conditions
    this.processedNodes.add(node);

    // Check if we already have a claim for this exact text and element
    const existingClaim = Array.from(this.verificationQueue.values()).find(
      claim => claim.text === text && claim.element === node
    );
    
    if (existingClaim) {
      return;
    }

    const claimId = this.generateClaimId(text);
    const claimData: ClaimData = {
      text,
      element: node,
      id: claimId,
      attempts: 0
    };

    this.verificationQueue.set(claimId, claimData);
    this.addPendingBadge(node, claimId);

    // Remember text so we don't re-verify identical claim
    this.processedTexts.add(text);
    
    // No attribute marking required
  }

  private addPendingBadge(node: Element, claimId: string): void {
    const existingBadge = node.querySelector('.veritas-badge');
    if (existingBadge) return;

    try {
      const badge = document.createElement('span');
      badge.className = 'veritas-badge veritas-pending';
      badge.setAttribute('data-claim-id', claimId);
      badge.setAttribute('role', 'button');
      badge.setAttribute('tabindex', '0');
      badge.setAttribute('aria-label', 'Verifying claim... Click to view details');
      badge.setAttribute('aria-live', 'polite');
      badge.innerHTML = '⟳';
      badge.title = 'Verifying claim...';
      
      // Add click handler for tooltip
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showTooltip(badge, claimId);
      });

      // Add keyboard navigation
      badge.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.showTooltip(badge, claimId);
        }
      });

      node.appendChild(badge);
    } catch (error) {
      console.error('Veritas: Failed to add badge:', error);
    }
  }

  private async processQueue(): Promise<void> {
    if (this.disposed || this.processingQueue || this.verificationQueue.size === 0) {
      return;
    }

    this.processingQueue = true;

    try {
      const claims = Array.from(this.verificationQueue.values()).slice(0, this.config.batchSize);
      
      for (const claim of claims) {
        await this.verifyClaim(claim);
        this.verificationQueue.delete(claim.id);
      }
    } catch (error) {
      console.error('Veritas: Error processing verification queue:', error);
    } finally {
      this.processingQueue = false;
      
      // Continue processing if there are more claims and instance is not disposed
      if (!this.disposed && this.verificationQueue.size > 0) {
        this.processQueueTimeout = setTimeout(() => this.processQueue(), 100);
      }
    }
  }

  private async verifyClaim(claim: ClaimData): Promise<void> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      // If the script has been disposed while waiting, abort retries
      if (this.disposed) {
        return;
      }
      try {
        const response = await this.sendVerificationRequest(claim.text);
        this.handleVerificationResult({
          claimId: claim.id,
          ...response
        });
        return; // Success, exit retry loop
      } catch (error) {
        lastError = error as Error;
        console.error(`Veritas: Verification attempt ${attempt + 1} failed for claim:`, claim.id, error);
        
        // Wait before retrying
        if (attempt < this.config.maxRetries - 1 && !this.disposed) {
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * (attempt + 1)));
        }
      }
    }

    // All attempts failed
    this.handleVerificationError(claim.id, lastError || new Error('Unknown verification error'));
  }

  private async sendVerificationRequest(claimText: string): Promise<VerificationResult> {
    const response = await fetch(this.config.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.VERITAS_API_KEY || 'demo-key'}`,
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({
        claim_text: claimText,
        source: 'browser-extension',
        timestamp: new Date().toISOString()
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    // Validate response structure
    if (!result.status) {
      console.error('Veritas: Malformed API response:', result);
      throw new Error('Malformed API response');
    }
    
    return result;
  }

  private handleVerificationResult(result: VerificationResult & { claimId: string }): void {
    const { claimId, status, confidence, citations } = result;
    const claimData = this.verificationQueue.get(claimId);
    
    if (!claimData) return;

    const badge = claimData.element.querySelector(`.veritas-badge[data-claim-id="${claimId}"]`);
    if (!badge) return;

    // Update badge appearance
    badge.className = `veritas-badge veritas-${status.toLowerCase()}`;
    
    let ariaLabel = '';
    switch (status) {
      case 'VERIFIED':
        badge.innerHTML = '✔';
        (badge as HTMLElement).title = `Verified (${Math.round((confidence || 0) * 100)}% confidence)`;
        ariaLabel = `Claim verified with ${Math.round((confidence || 0) * 100)}% confidence. Click to view sources.`;
        break;
      case 'UNVERIFIED':
        badge.innerHTML = '✖';
        (badge as HTMLElement).title = `Unverified (${Math.round((confidence || 0) * 100)}% confidence)`;
        ariaLabel = `Claim unverified with ${Math.round((confidence || 0) * 100)}% confidence. Click to view details.`;
        break;
      case 'UNKNOWN':
        badge.innerHTML = '?';
        (badge as HTMLElement).title = 'Unable to verify';
        ariaLabel = 'Unable to verify this claim. Click to view details.';
        break;
      case 'ERROR':
        badge.innerHTML = '✖';
        (badge as HTMLElement).title = 'Verification error';
        ariaLabel = 'Verification error. Click to view details.';
        break;
      default:
        badge.innerHTML = '⟳';
        (badge as HTMLElement).title = 'Verifying...';
        ariaLabel = 'Verifying claim...';
    }

    // Update accessibility attributes
    badge.setAttribute('aria-label', ariaLabel);
    badge.setAttribute('aria-live', 'polite');

    // Store citations for tooltip
    if (citations && citations.length > 0) {
      badge.setAttribute('data-citations', JSON.stringify(citations));
    }

    // Add animation
    badge.classList.add('veritas-animate');
    setTimeout(() => badge.classList.remove('veritas-animate'), 500);
  }

  private handleVerificationError(claimId: string, error: Error): void {
    const claimData = this.verificationQueue.get(claimId);
    if (!claimData) return;

    const badge = claimData.element.querySelector(`.veritas-badge[data-claim-id="${claimId}"]`);
    if (!badge) return;

    badge.className = 'veritas-badge veritas-error';
    badge.innerHTML = '⚠';
    (badge as HTMLElement).title = `Verification error: ${error.message}`;
    badge.setAttribute('aria-label', `Verification error: ${error.message}. Click to view details.`);
    badge.setAttribute('aria-live', 'assertive');
  }

  private showTooltip(badge: Element, claimId: string): void {
    const citations = badge.getAttribute('data-citations');
    if (!citations) return;

    try {
      const citationData = JSON.parse(citations);
      this.createTooltip(badge, citationData);
    } catch (error) {
      console.error('Veritas: Error parsing citations:', error);
    }
  }

  private createTooltip(badge: Element, citations: any[]): void {
    // Remove existing tooltip
    const existingTooltip = document.querySelector('.veritas-tooltip');
    if (existingTooltip) {
      existingTooltip.remove();
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'veritas-tooltip';
    tooltip.setAttribute('role', 'dialog');
    tooltip.setAttribute('aria-label', 'Verification sources and citations');
    tooltip.setAttribute('aria-modal', 'true');
    
    const content = document.createElement('div');
    content.className = 'veritas-tooltip-content';
    
    citations.forEach((citation, index) => {
      const citationElement = document.createElement('div');
      citationElement.className = 'veritas-citation';
      citationElement.setAttribute('role', 'article');
      citationElement.setAttribute('aria-label', `Citation ${index + 1}: ${citation.title}`);
      
      citationElement.innerHTML = `
        <div class="veritas-citation-title">${citation.title}</div>
        <div class="veritas-citation-snippet">${citation.snippet}</div>
        <a href="https://ipfs.io/ipfs/${citation.cid}" target="_blank" class="veritas-citation-link" aria-label="View source document on IPFS">
          View on IPFS
        </a>
      `;
      
      content.appendChild(citationElement);
    });

    tooltip.appendChild(content);
    document.body.appendChild(tooltip);

    // Position tooltip near badge
    const badgeRect = badge.getBoundingClientRect();
    tooltip.style.left = `${badgeRect.right + 10}px`;
    tooltip.style.top = `${badgeRect.top}px`;

    // Close tooltip when clicking outside or pressing Escape
    const closeTooltip = (e: Event) => {
      if (!tooltip.contains(e.target as Node)) {
        tooltip.remove();
        document.removeEventListener('click', closeTooltip);
        document.removeEventListener('keydown', handleKeydown);
      }
    };

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        tooltip.remove();
        document.removeEventListener('click', closeTooltip);
        document.removeEventListener('keydown', handleKeydown);
      }
    };

    setTimeout(() => {
      document.addEventListener('click', closeTooltip);
      document.addEventListener('keydown', handleKeydown);
      tooltip.focus();
    }, 100);
  }

  private generateClaimId(text: string): string {
    // Create a more stable hash for the same text to prevent duplicate processing
    const textHash = btoa(text.substring(0, 50)).replace(/[^a-zA-Z0-9]/g, '');
    return `claim_${textHash}_${Date.now()}`;
  }

  private updateConfig(newConfig: Partial<typeof this.config>): void {
    this.config = { ...this.config, ...newConfig };
  }

  private setupPeriodicCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      // Clean up orphaned badges (badges without valid claim IDs)
      const orphanedBadges = document.querySelectorAll('.veritas-badge:not([data-claim-id])');
      orphanedBadges.forEach(badge => badge.remove());
      
      // Clean up old badges that no longer have parent elements in the DOM
      const allBadges = document.querySelectorAll('.veritas-badge[data-claim-id]');
      allBadges.forEach(badge => {
        if (!document.body.contains(badge)) {
          badge.remove();
        }
      });
    }, 30000); // Every 30 seconds
  }

  public dispose(): void {
    this.disposed = true;
    
    // Clear any pending timeouts
    if (this.processQueueTimeout) {
      clearTimeout(this.processQueueTimeout);
      this.processQueueTimeout = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Disconnect mutation observer
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    // Clear verification queue
    this.verificationQueue.clear();
    this.processingQueue = false;

    // Remove any existing badges and tooltips
    const badges = document.querySelectorAll('.veritas-badge');
    badges.forEach(badge => badge.remove());
    
    const tooltips = document.querySelectorAll('.veritas-tooltip');
    tooltips.forEach(tooltip => tooltip.remove());
    
    // No attribute cleanup needed

    // Clear processed data sets
    this.processedNodes = new WeakSet();
    this.processedTexts.clear();
  }
}

// Initialize the content script only in non-test environments
if (typeof globalThis.process === 'undefined' || globalThis.process.env?.NODE_ENV !== 'test') {
  new VeritasContentScript();
} 