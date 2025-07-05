import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VeritasContentScript } from '../contentScript';

// Mock DOM APIs
const mockElement = {
  textContent: 'Test claim text',
  querySelector: vi.fn(),
  querySelectorAll: vi.fn(),
  appendChild: vi.fn(),
  addEventListener: vi.fn(),
  matches: vi.fn(),
  closest: vi.fn(),
  setAttribute: vi.fn(),
  className: '',
  innerHTML: '',
  style: {}
};

const mockDocument = {
  querySelector: vi.fn(),
  querySelectorAll: vi.fn(),
  body: mockElement,
  addEventListener: vi.fn(),
  createElement: vi.fn(() => mockElement)
};

const mockWindow = {
  addEventListener: vi.fn(),
  postMessage: vi.fn()
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
global.MutationObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  disconnect: vi.fn()
}));

describe('VeritasContentScript', () => {
  let contentScript: VeritasContentScript;
  let mockNodes: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset DOM mocks
    mockDocument.querySelectorAll.mockReturnValue([]);
    mockDocument.querySelector.mockReturnValue(null);
    mockElement.querySelector.mockReturnValue(null);
    mockElement.querySelectorAll.mockReturnValue([]);
    mockElement.matches.mockReturnValue(false);
    mockElement.closest.mockReturnValue(null);
    
    // Setup mock nodes
    mockNodes = [
      {
        ...mockElement,
        textContent: 'The Earth orbits around the Sun',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      },
      {
        ...mockElement,
        textContent: 'Water boils at 100 degrees Celsius',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      }
    ];

    mockDocument.querySelectorAll.mockReturnValue(mockNodes);
    
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

    contentScript = new VeritasContentScript();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should set up message listener', () => {
      expect(mockWindow.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should set up mutation observer', () => {
      expect(global.MutationObserver).toHaveBeenCalled();
    });

    it('should process existing nodes', () => {
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
      const node = {
        ...mockElement,
        textContent: 'System message',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue({ getAttribute: vi.fn().mockReturnValue('system') })
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      contentScript = new VeritasContentScript();

      expect(node.appendChild).not.toHaveBeenCalled();
    });

    it('should skip user messages', () => {
      const node = {
        ...mockElement,
        textContent: 'User input',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue({ getAttribute: vi.fn().mockReturnValue('user') })
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
      const badge = {
        ...mockElement,
        className: 'veritas-badge veritas-pending',
        setAttribute: vi.fn(),
        innerHTML: '⟳'
      };

      const node = {
        ...mockElement,
        textContent: 'Test claim',
        querySelector: vi.fn().mockReturnValue(badge),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      contentScript = new VeritasContentScript();

      // Simulate verification result
      const messageEvent = {
        source: window,
        data: {
          type: 'VERITAS_VERIFICATION_RESULT',
          result: {
            claimId: 'test-claim-id',
            status: 'VERIFIED',
            confidence: 0.9,
            citations: []
          }
        }
      };

      // Trigger message handler
      const messageHandler = mockWindow.addEventListener.mock.calls[0][1];
      messageHandler(messageEvent);

      expect(badge.className).toContain('veritas-verified');
      expect(badge.innerHTML).toBe('✔');
    });

    it('should handle verification errors', () => {
      const badge = {
        ...mockElement,
        className: 'veritas-badge veritas-pending',
        setAttribute: vi.fn(),
        innerHTML: '⟳'
      };

      const node = {
        ...mockElement,
        textContent: 'Test claim',
        querySelector: vi.fn().mockReturnValue(badge),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      contentScript = new VeritasContentScript();

      // Simulate verification error
      const messageEvent = {
        source: window,
        data: {
          type: 'VERITAS_VERIFICATION_RESULT',
          result: {
            claimId: 'test-claim-id',
            status: 'ERROR',
            error: 'API error'
          }
        }
      };

      // Trigger message handler
      const messageHandler = mockWindow.addEventListener.mock.calls[0][1];
      messageHandler(messageEvent);

      expect(badge.className).toContain('veritas-error');
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
            'Authorization': expect.any(String)
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
        'Veritas: Verification failed for claim:',
        expect.any(String),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should retry failed requests', async () => {
      (global.fetch as any)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            status: 'VERIFIED',
            confidence: 0.9,
            citations: []
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

      contentScript = new VeritasContentScript();

      // Wait for retry
      await new Promise(resolve => setTimeout(resolve, 2000));

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Tooltip Management', () => {
    it('should show tooltip on badge click', () => {
      const badge = {
        ...mockElement,
        className: 'veritas-badge veritas-verified',
        setAttribute: vi.fn(),
        innerHTML: '✔'
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

      // Simulate badge click
      const clickHandler = badge.addEventListener.mock.calls[0][1];
      const mockEvent = { stopPropagation: vi.fn() };
      clickHandler(mockEvent);

      expect(mockEvent.stopPropagation).toHaveBeenCalled();
      expect(mockDocument.createElement).toHaveBeenCalledWith('div');
    });

    it('should close tooltip when clicking outside', () => {
      const tooltip = {
        ...mockElement,
        className: 'veritas-tooltip',
        remove: vi.fn()
      };

      mockDocument.querySelector.mockReturnValue(tooltip);

      // Simulate click outside tooltip
      const clickEvent = new Event('click');
      document.dispatchEvent(clickEvent);

      expect(tooltip.remove).toHaveBeenCalled();
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
      const nodes = Array(100).fill(null).map(() => ({
        ...mockElement,
        textContent: 'Test claim ' + Math.random(),
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

      contentScript = new VeritasContentScript();

      // Simulate periodic cleanup
      const cleanupInterval = setInterval(() => {}, 30000);
      clearInterval(cleanupInterval);

      // Old badges should be cleaned up
      expect(oldBadge.remove).toHaveBeenCalled();
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
          status: 'VERIFIED'
          // Missing confidence and citations
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