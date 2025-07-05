// Content script for Veritas AI Agent
// Waits for ChatGPT answer completion and traverses <div[data-scroll-target]> p, li nodes

interface VerificationResult {
  status: 'VERIFIED' | 'UNVERIFIED' | 'UNKNOWN' | 'PENDING';
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
}

export class VeritasContentScript {
  private verificationQueue: Map<string, ClaimData> = new Map();
  private processingQueue = false;
  private config = {
    apiEndpoint: 'https://api.veritas.ai/verify',
    maxRetries: 3,
    retryDelay: 1000,
    batchSize: 5,
    confidenceThresholds: {
      verified: 0.8,
      unverified: 0.5
    }
  };

  constructor() {
    this.init();
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
    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              if (this.isChatNode(element) || element.querySelector('[data-scroll-target]')) {
                shouldProcess = true;
              }
            }
          });
        }
      });

      if (shouldProcess) {
        this.processChatNodes();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false
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
    if (node.querySelector('.veritas-badge') || 
        node.querySelector('.veritas-processing') ||
        !node.textContent?.trim()) {
      return false;
    }

    // Skip system messages and user inputs
    const isSystemMessage = node.closest('[data-message-author-role="system"]');
    const isUserMessage = node.closest('[data-message-author-role="user"]');
    
    return !isSystemMessage && !isUserMessage;
  }

  private processNode(node: Element): void {
    const text = node.textContent?.trim();
    if (!text || text.length < 10) return; // Skip very short text

    const claimId = this.generateClaimId(text);
    const claimData: ClaimData = {
      text,
      element: node,
      id: claimId
    };

    this.verificationQueue.set(claimId, claimData);
    this.addPendingBadge(node, claimId);
  }

  private addPendingBadge(node: Element, claimId: string): void {
    const existingBadge = node.querySelector('.veritas-badge');
    if (existingBadge) return;

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
  }

  private async processQueue(): Promise<void> {
    if (this.processingQueue || this.verificationQueue.size === 0) {
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
      
      // Continue processing if there are more claims
      if (this.verificationQueue.size > 0) {
        setTimeout(() => this.processQueue(), 100);
      }
    }
  }

  private async verifyClaim(claim: ClaimData): Promise<void> {
    try {
      const response = await this.sendVerificationRequest(claim.text);
      this.handleVerificationResult({
        claimId: claim.id,
        ...response
      });
    } catch (error) {
      console.error('Veritas: Verification failed for claim:', claim.id, error);
      this.handleVerificationError(claim.id, error as Error);
    }
  }

  private async sendVerificationRequest(claimText: string): Promise<VerificationResult> {
    const response = await fetch(this.config.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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

    return await response.json();
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
    return `claim_${btoa(text.substring(0, 50)).replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}`;
  }

  private updateConfig(newConfig: Partial<typeof this.config>): void {
    this.config = { ...this.config, ...newConfig };
  }

  private setupPeriodicCleanup(): void {
    setInterval(() => {
      // Clean up orphaned badges
      const orphanedBadges = document.querySelectorAll('.veritas-badge:not([data-claim-id])');
      orphanedBadges.forEach(badge => badge.remove());
    }, 30000); // Every 30 seconds
  }
}

// Initialize the content script
new VeritasContentScript(); 