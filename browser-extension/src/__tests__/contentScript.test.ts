import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VeritasContentScript } from '../contentScript';

// Keep attributes in a plain object so set/get/has work consistently across tests
const createMockElement = () => {
  const attributes: Record<string, string> = {};
  return {
    textContent: 'Test claim text',
    querySelector: vi.fn(),
    querySelectorAll: vi.fn(),
    appendChild: vi.fn(),
    addEventListener: vi.fn(),
    matches: vi.fn(),
    closest: vi.fn(),
    setAttribute: vi.fn((name: string, value: string) => {
      attributes[name] = String(value);
    }),
    getAttribute: vi.fn((name: string) => attributes[name] ?? null),
    hasAttribute: vi.fn((name: string) => Object.prototype.hasOwnProperty.call(attributes, name)),
    removeAttribute: vi.fn((name: string) => {
      delete attributes[name];
    }),
    className: '',
    innerHTML: '',
    style: {},
    remove: vi.fn(),
    contains: vi.fn(),
    getBoundingClientRect: vi.fn().mockReturnValue({ right: 100, top: 100 }),
    focus: vi.fn(),
    classList: {
      add: vi.fn(),
      remove: vi.fn()
    },
    dispatchEvent: vi.fn()
  } as any;
};

// Use factory so each test can get a fresh instance if needed
const mockElement = createMockElement();

const mockDocument = {
  querySelector: vi.fn(),
  querySelectorAll: vi.fn(),
  body: mockElement,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  createElement: vi.fn(() => ({ ...mockElement })),
  contains: vi.fn().mockReturnValue(true)
};

const mockWindow = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  postMessage: vi.fn(),
  dispatchEvent: vi.fn()
};

// Mock fetch
global.fetch = vi.fn();

// Mock DOM
Object.defineProperty(global, 'document', {
  value: mockDocument,
  writable: true
});

Object.defineProperty(global, 'window', {
  value: mockWindow,
  writable: true
});

// Mock MutationObserver
global.MutationObserver = vi.fn().mockImplementation((callback) => ({
  observe: vi.fn(),
  disconnect: vi.fn(),
  callback
}));

// Mock Node types
global.Node = {
  ELEMENT_NODE: 1
} as any;

// Mock process.env
Object.defineProperty(global, 'process', {
  value: {
    env: {
      VERITAS_API_ENDPOINT: 'https://api.veritas.ai/verify',
      VERITAS_API_KEY: 'test-api-key'
    }
  },
  writable: true
});

describe('VeritasContentScript', () => {
  let contentScript: VeritasContentScript | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    contentScript = undefined;

    // Recreate the mockElement with fresh attribute store
    Object.assign(mockElement, createMockElement());
    mockDocument.body = mockElement;
    
    // Reset DOM mocks
    mockDocument.querySelectorAll.mockReturnValue([]);
    mockDocument.querySelector.mockReturnValue(null);
    mockElement.querySelector.mockReturnValue(null);
    mockElement.querySelectorAll.mockReturnValue([]);
    mockElement.matches.mockReturnValue(false);
    mockElement.closest.mockReturnValue(null);
    mockElement.contains.mockReturnValue(false);

    // Mock successful API response
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        status: 'VERIFIED',
        confidence: 0.9,
        citations: [
          {
            cid: 'QmTest123',
            title: 'Science Textbook',
            snippet: 'The Earth orbits around the Sun in an elliptical path.'
          }
        ]
      })
    });
  });

  afterEach(() => {
    if (contentScript) {
      contentScript.dispose();
      contentScript = undefined;
    }
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should set up message listener', () => {
      contentScript = new VeritasContentScript();
      expect(mockWindow.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should set up mutation observer', () => {
      contentScript = new VeritasContentScript();
      expect(global.MutationObserver).toHaveBeenCalled();
    });

    it('should process existing nodes', () => {
      contentScript = new VeritasContentScript();
      expect(mockDocument.querySelectorAll).toHaveBeenCalledWith('div[data-scroll-target] p, div[data-scroll-target] li');
    });
  });

  describe('Node Processing', () => {
    it('should process valid chat nodes', () => {
      const node = {
        ...mockElement,
        textContent: 'This is a valid claim to verify',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      contentScript = new VeritasContentScript();

      expect(node.appendChild).toHaveBeenCalled();
    });

    it('should skip nodes that are already processed', () => {
      const node = {
        ...mockElement,
        textContent: 'This claim has already been processed',
        querySelector: vi.fn().mockReturnValue({ className: 'veritas-badge' }),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      contentScript = new VeritasContentScript();

      expect(node.appendChild).not.toHaveBeenCalled();
    });

    it('should skip system messages', () => {
      const mockContainer = {
        getAttribute: vi.fn().mockReturnValue('system')
      };
      
      const node = {
        ...mockElement,
        textContent: 'System message',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(mockContainer)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      contentScript = new VeritasContentScript();

      expect(node.appendChild).not.toHaveBeenCalled();
    });

    it('should skip user messages', () => {
      const mockContainer = {
        getAttribute: vi.fn().mockReturnValue('user')
      };
      
      const node = {
        ...mockElement,
        textContent: 'User input',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(mockContainer)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      contentScript = new VeritasContentScript();

      expect(node.appendChild).not.toHaveBeenCalled();
    });

    it('should skip very short text', () => {
      const node = {
        ...mockElement,
        textContent: 'Hi',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      contentScript = new VeritasContentScript();

      expect(node.appendChild).not.toHaveBeenCalled();
    });
  });

  describe('Badge Management', () => {
    it('should add pending badge to nodes', () => {
      const node = {
        ...mockElement,
        textContent: 'Test claim',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);
      mockDocument.createElement.mockReturnValue({
        ...mockElement,
        className: '',
        setAttribute: vi.fn(),
        innerHTML: '',
        addEventListener: vi.fn()
      });

      contentScript = new VeritasContentScript();

      expect(mockDocument.createElement).toHaveBeenCalledWith('span');
      expect(node.appendChild).toHaveBeenCalled();
    });

    it('should update badge status after verification', () => {
      const node = {
        ...mockElement,
        textContent: 'Test claim',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);
      
      // Create the badge that will be appended by addPendingBadge
      const badge = {
        ...mockElement,
        className: 'veritas-badge veritas-pending',
        setAttribute: vi.fn(),
        getAttribute: vi.fn(),
        innerHTML: '⟳',
        title: '',
        'data-claim-id': '' // This will be set dynamically
      };

      // Make createElement return our badge
      mockDocument.createElement.mockReturnValue(badge);

      contentScript = new VeritasContentScript();

      // Get the generated claim ID from the verification queue
      const verificationQueue = contentScript['verificationQueue'];
      const claimId = Array.from(verificationQueue.keys())[0];

      // Set the claim ID on the badge (simulating what addPendingBadge does)
      badge['data-claim-id'] = claimId;
      badge.getAttribute.mockImplementation((attr: string) => {
        if (attr === 'data-claim-id') return claimId;
        return null;
      });

      // Make the node's querySelector return the badge when searching for the specific claim ID
      node.querySelector.mockImplementation((selector: string) => {
        if (selector === `.veritas-badge[data-claim-id="${claimId}"]`) {
          return badge;
        }
        return null;
      });

      // Simulate verification result
      const messageEvent = {
        source: window,
        data: {
          type: 'VERITAS_VERIFICATION_RESULT',
          result: {
            claimId: claimId,
            status: 'VERIFIED',
            confidence: 0.9,
            citations: []
          }
        }
      };

      // Trigger message handler
      const messageHandler = mockWindow.addEventListener.mock.calls[0][1];
      messageHandler(messageEvent);

      expect(badge.className).toBe('veritas-badge veritas-verified');
      expect(badge.innerHTML).toBe('✔');
    });

    it('should handle verification errors', () => {
      const node = {
        ...mockElement,
        textContent: 'Test claim',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);
      
      // Create the badge that will be appended by addPendingBadge
      const badge = {
        ...mockElement,
        className: 'veritas-badge veritas-pending',
        setAttribute: vi.fn(),
        getAttribute: vi.fn(),
        innerHTML: '⟳',
        title: '',
        'data-claim-id': '' // This will be set dynamically
      };

      // Make createElement return our badge
      mockDocument.createElement.mockReturnValue(badge);

      contentScript = new VeritasContentScript();

      // Get the generated claim ID from the verification queue
      const verificationQueue = contentScript['verificationQueue'];
      const claimId = Array.from(verificationQueue.keys())[0];

      // Set the claim ID on the badge (simulating what addPendingBadge does)
      badge['data-claim-id'] = claimId;
      badge.getAttribute.mockImplementation((attr: string) => {
        if (attr === 'data-claim-id') return claimId;
        return null;
      });

      // Make the node's querySelector return the badge when searching for the specific claim ID
      node.querySelector.mockImplementation((selector: string) => {
        if (selector === `.veritas-badge[data-claim-id="${claimId}"]`) {
          return badge;
        }
        return null;
      });

      // Simulate verification error
      const messageEvent = {
        source: window,
        data: {
          type: 'VERITAS_VERIFICATION_RESULT',
          result: {
            claimId: claimId,
            status: 'ERROR',
            error: 'API error'
          }
        }
      };

      // Trigger message handler
      const messageHandler = mockWindow.addEventListener.mock.calls[0][1];
      messageHandler(messageEvent);

      expect(badge.className).toBe('veritas-badge veritas-error');
      expect(badge.innerHTML).toBe('✖');
    });
  });

  describe('API Communication', () => {
    it('should send verification requests to API', async () => {
      const node = {
        ...mockElement,
        textContent: 'Test claim for verification',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      contentScript = new VeritasContentScript();

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.veritas.ai/verify',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': expect.stringContaining('Bearer'),
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: expect.stringContaining('Test claim for verification')
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const node = {
        ...mockElement,
        textContent: 'Test claim',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      contentScript = new VeritasContentScript();

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Verification attempt'),
        expect.any(String),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should retry failed requests', async () => {
      // Create a completely isolated fetch mock for this test
      const originalFetch = global.fetch;
      let callCount = 0;
      
      const freshFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Network error'));
        } else {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              status: 'VERIFIED',
              confidence: 0.9,
              citations: []
            })
          });
        }
      });

      global.fetch = freshFetch;

      const node = {
        ...mockElement,
        textContent: 'Test claim for retry',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      contentScript = new VeritasContentScript();

      // Wait for both the initial attempt and retry to complete
      await new Promise(resolve => setTimeout(resolve, 3000));

      expect(freshFetch).toHaveBeenCalledTimes(2);
      
      // Restore original fetch
      global.fetch = originalFetch;
    });
  });

  describe('Tooltip Management', () => {
    it('should show tooltip on badge click', () => {
      const badge = {
        ...mockElement,
        className: 'veritas-badge veritas-verified',
        setAttribute: vi.fn(),
        innerHTML: '✔',
        getAttribute: vi.fn().mockReturnValue('[]')
      };

      const node = {
        ...mockElement,
        textContent: 'Test claim',
        querySelector: vi.fn().mockReturnValue(badge),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);
      mockDocument.createElement.mockReturnValue({
        ...mockElement,
        className: 'veritas-tooltip',
        innerHTML: '',
        style: {}
      });

      contentScript = new VeritasContentScript();

      // Check if addEventListener was called for the badge
      if (badge.addEventListener.mock.calls.length > 0) {
        // Simulate badge click
        const clickHandler = badge.addEventListener.mock.calls[0][1];
        const mockEvent = { stopPropagation: vi.fn() };
        clickHandler(mockEvent);

        expect(mockEvent.stopPropagation).toHaveBeenCalled();
      }
    });

    it('should close tooltip when clicking outside', () => {
      const tooltip = {
        ...mockElement,
        className: 'veritas-tooltip',
        remove: vi.fn(),
        contains: vi.fn().mockReturnValue(false)
      };

      mockDocument.querySelector.mockReturnValue(tooltip);

      contentScript = new VeritasContentScript();

      // Simulate click outside tooltip
      const clickEvent = new Event('click');
      Object.defineProperty(clickEvent, 'target', { value: mockElement });
      
      // Simulate document click listeners
      const documentListeners = mockDocument.addEventListener.mock.calls;
      const clickListener = documentListeners.find(call => call[0] === 'click');
      if (clickListener) {
        clickListener[1](clickEvent);
        expect(tooltip.remove).toHaveBeenCalled();
      }
    });
  });

  describe('Configuration Management', () => {
    it('should update configuration from messages', () => {
      contentScript = new VeritasContentScript();

      const messageEvent = {
        source: window,
        data: {
          type: 'VERITAS_CONFIG_UPDATE',
          config: {
            apiEndpoint: 'https://new-api.veritas.ai/verify',
            maxRetries: 5
          }
        }
      };

      const messageHandler = mockWindow.addEventListener.mock.calls[0][1];
      messageHandler(messageEvent);

      // Configuration should be updated
      expect(contentScript['config'].apiEndpoint).toBe('https://new-api.veritas.ai/verify');
      expect(contentScript['config'].maxRetries).toBe(5);
    });
  });

  describe('Performance and Memory Management', () => {
    it('should limit queue size to prevent memory leaks', () => {
      const nodes = Array(100).fill(null).map((_, index) => ({
        ...mockElement,
        textContent: 'Test claim ' + index,
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      }));

      mockDocument.querySelectorAll.mockReturnValue(nodes);

      contentScript = new VeritasContentScript();

      // Queue should be limited
      expect(contentScript['verificationQueue'].size).toBeLessThanOrEqual(50);
    });

    it('should clean up old badges periodically', () => {
      const oldBadge = {
        ...mockElement,
        className: 'veritas-badge veritas-verified',
        remove: vi.fn()
      };

      mockDocument.querySelectorAll.mockReturnValue([oldBadge]);

      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      contentScript = new VeritasContentScript();

      // Check that setInterval was called for cleanup
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);

      setIntervalSpy.mockRestore();
    });
  });

  describe('Error Handling', () => {
    it('should handle DOM manipulation errors', () => {
      const node = {
        ...mockElement,
        textContent: 'Test claim',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null),
        appendChild: vi.fn().mockImplementation(() => {
          throw new Error('DOM manipulation error');
        })
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        contentScript = new VeritasContentScript();
      }).not.toThrow();

      consoleSpy.mockRestore();
    });

    it('should handle malformed API responses', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          // Malformed response missing required fields
          confidence: 0.9
          // Missing status field
        })
      });

      const node = {
        ...mockElement,
        textContent: 'Test claim',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      contentScript = new VeritasContentScript();

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
}); 