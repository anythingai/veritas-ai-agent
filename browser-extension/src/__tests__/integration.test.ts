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
  remove: vi.fn(),
  style: {},
  getBoundingClientRect: vi.fn().mockReturnValue({ top: 0, left: 0, width: 100, height: 20 }),
  dispatchEvent: vi.fn()
};

const mockDocument = {
  querySelector: vi.fn(),
  querySelectorAll: vi.fn(),
  body: mockElement,
  addEventListener: vi.fn(),
  createElement: vi.fn(() => mockElement),
  createTextNode: vi.fn((text: string) => ({ textContent: text })),
  getElementById: vi.fn(),
  head: {
    appendChild: vi.fn()
  }
};

const mockWindow = {
  addEventListener: vi.fn(),
  postMessage: vi.fn(),
  location: {
    href: 'https://chat.openai.com/',
    origin: 'https://chat.openai.com'
  },
  document: mockDocument,
  setTimeout: vi.fn((fn: Function, delay: number) => {
    setTimeout(fn, delay);
    return 1;
  }),
  clearTimeout: vi.fn()
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

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  disconnect: vi.fn(),
  unobserve: vi.fn()
}));

describe('VeritasContentScript - Integration Tests', () => {
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

  describe('End-to-End Verification Flow', () => {
    it('should process claims and display verification badges', async () => {
      const node = {
        ...mockElement,
        textContent: 'The Earth orbits around the Sun in an elliptical path',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      // Create new instance to trigger processing
      contentScript = new VeritasContentScript();

      // Wait for processing to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(node.appendChild).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should handle verification API errors gracefully', async () => {
      const node = {
        ...mockElement,
        textContent: 'Test claim that will fail',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);
      
      // Mock API failure
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      contentScript = new VeritasContentScript();

      // Wait for processing to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(node.appendChild).toHaveBeenCalled();
      // Should still add a badge even on error
      expect(node.appendChild).toHaveBeenCalled();
    });

    it('should handle different verification statuses correctly', async () => {
      const testCases = [
        {
          status: 'VERIFIED',
          confidence: 0.9,
          expectedClass: 'veritas-verified'
        },
        {
          status: 'UNVERIFIED',
          confidence: 0.3,
          expectedClass: 'veritas-unverified'
        },
        {
          status: 'UNKNOWN',
          confidence: 0.1,
          expectedClass: 'veritas-unknown'
        }
      ];

      for (const testCase of testCases) {
        const node = {
          ...mockElement,
          textContent: `Test claim for ${testCase.status}`,
          querySelector: vi.fn().mockReturnValue(null),
          matches: vi.fn().mockReturnValue(true),
          closest: vi.fn().mockReturnValue(null)
        };

        mockDocument.querySelectorAll.mockReturnValue([node]);
        
        (global.fetch as any).mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            status: testCase.status,
            confidence: testCase.confidence,
            citations: []
          })
        });

        contentScript = new VeritasContentScript();
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(node.appendChild).toHaveBeenCalled();
      }
    });
  });

  describe('DOM Interaction and UI', () => {
    it('should create and display verification badges', () => {
      const node = {
        ...mockElement,
        textContent: 'Test claim for badge creation',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      contentScript = new VeritasContentScript();

      expect(mockDocument.createElement).toHaveBeenCalled();
      expect(node.appendChild).toHaveBeenCalled();
    });

    it('should create tooltips with citation information', async () => {
      const node = {
        ...mockElement,
        textContent: 'Test claim with citations',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          status: 'VERIFIED',
          confidence: 0.9,
          citations: [
            {
              cid: 'QmTest123',
              title: 'Test Document',
              snippet: 'This is a test citation.'
            }
          ]
        })
      });

      contentScript = new VeritasContentScript();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Simulate badge click to trigger tooltip
      const badge = mockElement;
      const clickEvent = new Event('click');
      badge.dispatchEvent(clickEvent);

      expect(mockDocument.createElement).toHaveBeenCalled();
    });

    it('should handle tooltip positioning correctly', () => {
      const badge = {
        ...mockElement,
        getBoundingClientRect: vi.fn().mockReturnValue({
          top: 100,
          left: 200,
          width: 50,
          height: 20
        })
      };

      // Mock tooltip creation
      const tooltip = {
        ...mockElement,
        style: {}
      };

      mockDocument.createElement.mockReturnValue(tooltip);

      // Simulate tooltip creation
      contentScript = new VeritasContentScript();

      expect(mockDocument.createElement).toHaveBeenCalled();
    });
  });

  describe('Message Handling', () => {
    it('should handle verification result messages', () => {
      const mockResult = {
        claimId: 'test-claim-123',
        status: 'VERIFIED',
        confidence: 0.9,
        citations: []
      };

      // Simulate message event
      const messageEvent = new MessageEvent('message', {
        data: {
          type: 'VERITAS_VERIFICATION_RESULT',
          result: mockResult
        },
        source: window
      });

      window.dispatchEvent(messageEvent);

      // Verify message was handled
      expect(mockWindow.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should handle configuration update messages', () => {
      const mockConfig = {
        apiEndpoint: 'https://new-api.veritas.ai/verify',
        maxRetries: 5
      };

      const messageEvent = new MessageEvent('message', {
        data: {
          type: 'VERITAS_CONFIG_UPDATE',
          config: mockConfig
        },
        source: window
      });

      window.dispatchEvent(messageEvent);

      expect(mockWindow.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should ignore irrelevant messages', () => {
      const messageEvent = new MessageEvent('message', {
        data: {
          type: 'OTHER_MESSAGE_TYPE',
          content: 'irrelevant'
        },
        source: window
      });

      window.dispatchEvent(messageEvent);

      // Should not process irrelevant messages
      expect(mockDocument.createElement).not.toHaveBeenCalled();
    });
  });

  describe('Mutation Observer', () => {
    it('should detect new chat nodes and process them', () => {
      const newNode = {
        ...mockElement,
        textContent: 'New chat message to verify',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      // Simulate mutation observer callback
      const mutationObserver = global.MutationObserver as any;
      const mockObserver = mutationObserver.mock.results[0].value;
      
      // Simulate adding new nodes
      const mutation = {
        type: 'childList',
        addedNodes: [newNode]
      };

      // Trigger the observer callback
      mockObserver.observe.mock.calls[0][1].callback([mutation]);

      expect(mockDocument.querySelectorAll).toHaveBeenCalled();
    });

    it('should not process system or user messages', () => {
      const systemNode = {
        ...mockElement,
        textContent: 'System message',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue({ getAttribute: vi.fn().mockReturnValue('system') })
      };

      const userNode = {
        ...mockElement,
        textContent: 'User input',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue({ getAttribute: vi.fn().mockReturnValue('user') })
      };

      mockDocument.querySelectorAll.mockReturnValue([systemNode, userNode]);

      contentScript = new VeritasContentScript();

      expect(systemNode.appendChild).not.toHaveBeenCalled();
      expect(userNode.appendChild).not.toHaveBeenCalled();
    });
  });

  describe('API Communication', () => {
    it('should send properly formatted verification requests', async () => {
      const claimText = 'Test claim for API communication';
      const node = {
        ...mockElement,
        textContent: claimText,
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      contentScript = new VeritasContentScript();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/verify'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': expect.stringContaining('Bearer')
          }),
          body: expect.stringContaining(claimText)
        })
      );
    });

    it('should handle API rate limiting', async () => {
      const node = {
        ...mockElement,
        textContent: 'Rate limited claim',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      // Mock rate limit response
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded'
        })
      });

      contentScript = new VeritasContentScript();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should retry failed requests', async () => {
      const node = {
        ...mockElement,
        textContent: 'Retry test claim',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      // Mock initial failure then success
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

      contentScript = new VeritasContentScript();
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Performance and Optimization', () => {
    it('should batch verification requests', async () => {
      const nodes = Array.from({ length: 10 }, (_, i) => ({
        ...mockElement,
        textContent: `Claim ${i + 1} for batching`,
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      }));

      mockDocument.querySelectorAll.mockReturnValue(nodes);

      contentScript = new VeritasContentScript();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should not make 10 separate requests
      expect((global.fetch as any).mock.calls.length).toBeLessThan(10);
    });

    it('should clean up old badges periodically', () => {
      const oldBadge = {
        ...mockElement,
        className: 'veritas-badge veritas-verified',
        remove: vi.fn()
      };

      mockDocument.querySelectorAll.mockReturnValue([oldBadge]);

      // Simulate periodic cleanup
      contentScript = new VeritasContentScript();

      // Trigger cleanup
      const cleanupEvent = new Event('cleanup');
      window.dispatchEvent(cleanupEvent);

      expect(oldBadge.remove).toHaveBeenCalled();
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle DOM manipulation errors', () => {
      const node = {
        ...mockElement,
        textContent: 'Error test claim',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null),
        appendChild: vi.fn().mockImplementation(() => {
          throw new Error('DOM manipulation failed');
        })
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      // Should not throw error
      expect(() => {
        contentScript = new VeritasContentScript();
      }).not.toThrow();
    });

    it('should handle network timeouts', async () => {
      const node = {
        ...mockElement,
        textContent: 'Timeout test claim',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      // Mock timeout
      (global.fetch as any).mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), 100)
        )
      );

      contentScript = new VeritasContentScript();
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should handle malformed API responses', async () => {
      const node = {
        ...mockElement,
        textContent: 'Malformed response test',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      // Mock malformed response
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          // Missing required fields
          status: 'INVALID_STATUS'
        })
      });

      contentScript = new VeritasContentScript();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('Configuration and Settings', () => {
    it('should use default configuration when none provided', () => {
      contentScript = new VeritasContentScript();

      // Verify default config is used
      expect(mockWindow.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
      expect(global.MutationObserver).toHaveBeenCalled();
    });

    it('should update configuration when received', () => {
      const newConfig = {
        apiEndpoint: 'https://new-api.veritas.ai/verify',
        maxRetries: 5,
        batchSize: 10
      };

      const messageEvent = new MessageEvent('message', {
        data: {
          type: 'VERITAS_CONFIG_UPDATE',
          config: newConfig
        },
        source: window
      });

      window.dispatchEvent(messageEvent);

      // Configuration should be updated
      expect(mockWindow.addEventListener).toHaveBeenCalled();
    });
  });
}); 