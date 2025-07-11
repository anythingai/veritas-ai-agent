import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VeritasContentScript } from '../contentScript';

// Mock DOM APIs with attribute support
const createMockElement = () => {
  const attributes: Record<string, string> = {};
  return {
    textContent: 'Test claim text',
    querySelector: vi.fn(),
    querySelectorAll: vi.fn(),
    appendChild: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
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
    remove: vi.fn(),
    style: {},
    getBoundingClientRect: vi.fn().mockReturnValue({ top: 0, left: 0, width: 100, height: 20, right: 100 }),
    dispatchEvent: vi.fn(),
    contains: vi.fn(),
    focus: vi.fn(),
    classList: {
      add: vi.fn(),
      remove: vi.fn()
    }
  } as any;
};

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

// Mock DOM globals
Object.defineProperty(global, 'document', {
  value: mockDocument,
  writable: true
});

Object.defineProperty(global, 'window', {
  value: mockWindow,
  writable: true
});

// Mock MutationObserver
const mockObserverInstance = {
  observe: vi.fn(),
  disconnect: vi.fn(),
  takeRecords: vi.fn(),
  callback: null as ((mutations: MutationRecord[], observer: MutationObserver) => void) | null
};

global.MutationObserver = vi.fn().mockImplementation((callback) => {
  mockObserverInstance.callback = callback;
  return mockObserverInstance;
});

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

describe('VeritasContentScript - Integration Tests', () => {
  let contentScript: VeritasContentScript | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    contentScript = undefined;

    // Recreate mock element and reset document references
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
            title: 'Test Source',
            snippet: 'This supports the claim.'
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

  describe('End-to-End Verification Flow', () => {
    it('should process claims and display verification badges', async () => {
      const node = {
        ...mockElement,
        textContent: 'The Earth orbits around the Sun',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      contentScript = new VeritasContentScript();

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(node.appendChild).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should handle verification API errors gracefully', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const node = {
        ...mockElement,
        textContent: 'Test claim that will fail',
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

    it('should handle different verification statuses correctly', () => {
      const badge = {
        ...mockElement,
        className: 'veritas-badge veritas-pending',
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

      const testCases = [
        { status: 'VERIFIED', expectedClass: 'veritas-verified', expectedIcon: '✔' },
        { status: 'UNVERIFIED', expectedClass: 'veritas-unverified', expectedIcon: '✖' },
        { status: 'UNKNOWN', expectedClass: 'veritas-unknown', expectedIcon: '?' },
        { status: 'ERROR', expectedClass: 'veritas-error', expectedIcon: '✖' }
      ];

      testCases.forEach(testCase => {
        // Get the generated claim ID
        const verificationQueue = contentScript!['verificationQueue'];
        const claimId = Array.from(verificationQueue.keys())[0];

        if (claimId) {
          // Update mock to return badge for the claim ID
          node.querySelector.mockImplementation((selector: string) => {
            if (selector.includes(claimId)) {
              return badge;
            }
            return null;
          });

          const messageEvent = {
            source: window,
            data: {
              type: 'VERITAS_VERIFICATION_RESULT',
              result: {
                claimId: claimId,
                status: testCase.status,
                confidence: testCase.status === 'VERIFIED' ? 0.9 : null,
                citations: []
              }
            }
          };

          const messageHandler = mockWindow.addEventListener.mock.calls[0][1];
          if (messageHandler) {
            messageHandler(messageEvent);
            expect(badge.className).toBe(`veritas-badge ${testCase.expectedClass}`);
          }
        }
      });
    });
  });

  describe('DOM Manipulation and Mutation Observer', () => {
    it('should detect new content added to the page', () => {
      const newNode = {
        nodeType: 1,
        ...mockElement,
        textContent: 'Newly added claim',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([]);

      contentScript = new VeritasContentScript();

      const mockNodeList = {
        length: 1,
        item: (index: number) => index === 0 ? newNode as unknown as Node : null,
        forEach: (callback: (value: Node, key: number, parent: NodeList) => void) => 
          callback(newNode as unknown as Node, 0, mockNodeList),
        [0]: newNode as unknown as Node
      } as unknown as NodeList;

      const mutation = {
        type: 'childList' as const,
        addedNodes: mockNodeList,
        removedNodes: [] as unknown as NodeList,
        target: mockElement as unknown as Node,
        attributeName: null,
        attributeNamespace: null,
        nextSibling: null,
        previousSibling: null,
        oldValue: null
      } as unknown as MutationRecord;

      // Call the mutation callback directly
      const mutationCallback = mockObserverInstance.callback;
      if (mutationCallback) {
        mutationCallback([mutation], mockObserverInstance as any);
      }

      expect(newNode.appendChild).toHaveBeenCalled();
    });

    it('should set up mutation observer correctly', () => {
      contentScript = new VeritasContentScript();
      
      expect(global.MutationObserver).toHaveBeenCalled();
      expect(mockObserverInstance.observe).toHaveBeenCalledWith(
        mockDocument.body,
        {
          childList: true,
          subtree: true
        }
      );
    });
  });

  describe('Message Handling', () => {
    it('should handle verification result messages', () => {
      const badge = {
        ...mockElement,
        className: 'veritas-badge veritas-pending',
        innerHTML: '⟳',
        setAttribute: vi.fn()
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

      // Get the generated claim ID
      const verificationQueue = contentScript['verificationQueue'];
      const claimId = Array.from(verificationQueue.keys())[0];

      if (claimId) {
        // Update mock to return badge for the claim ID
        node.querySelector.mockImplementation((selector: string) => {
          if (selector.includes(claimId)) {
            return badge;
          }
          return null;
        });

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

        const messageHandler = mockWindow.addEventListener.mock.calls[0][1];
        messageHandler(messageEvent);
        // Verify message was handled
        expect(badge.className).toBe('veritas-badge veritas-verified');
      }
    });

    it('should handle configuration update messages', () => {
      contentScript = new VeritasContentScript();

      const messageEvent = {
        source: window,
        data: {
          type: 'VERITAS_CONFIG_UPDATE',
          config: {
            apiEndpoint: 'https://updated-api.veritas.ai/verify',
            maxRetries: 5
          }
        }
      };

      const messageHandler = mockWindow.addEventListener.mock.calls[0][1];
      messageHandler(messageEvent);

      expect(contentScript['config'].apiEndpoint).toBe('https://updated-api.veritas.ai/verify');
      expect(contentScript['config'].maxRetries).toBe(5);
    });

    it('should ignore irrelevant messages', () => {
      contentScript = new VeritasContentScript();

      const messageEvent = {
        source: window,
        data: {
          type: 'UNRELATED_MESSAGE',
          someData: 'irrelevant'
        }
      };

      const messageHandler = mockWindow.addEventListener.mock.calls[0][1];
      
      expect(() => {
        messageHandler(messageEvent);
      }).not.toThrow();
    });
  });

  describe('Mutation Observer', () => {
    it('should detect new chat nodes and process them', () => {
      const newNode = {
        nodeType: 1,
        ...mockElement,
        textContent: 'New chat message with claim',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([]);

      contentScript = new VeritasContentScript();

       const mockNodeList2 = {
         length: 1,
         item: (index: number) => index === 0 ? newNode as unknown as Node : null,
         forEach: (callback: (value: Node, key: number, parent: NodeList) => void) => 
           callback(newNode as unknown as Node, 0, mockNodeList2),
         [0]: newNode as unknown as Node
       } as unknown as NodeList;

       const mutation = {
         type: 'childList' as const,
         addedNodes: mockNodeList2,
         removedNodes: [] as unknown as NodeList,
         target: mockElement as unknown as Node,
         attributeName: null,
         attributeNamespace: null,
         nextSibling: null,
         previousSibling: null,
         oldValue: null
       } as unknown as MutationRecord;

      // Call the mutation callback directly
      const mutationCallback = mockObserverInstance.callback;
      if (mutationCallback) {
        mutationCallback([mutation], mockObserverInstance as any);
      }

      expect(newNode.appendChild).toHaveBeenCalled();
    });

    it('should not process system or user messages', () => {
      const systemContainer = {
        getAttribute: vi.fn().mockReturnValue('system')
      };

      const userContainer = {
        getAttribute: vi.fn().mockReturnValue('user')
      };

      const systemNode = {
        ...mockElement,
        textContent: 'System message',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(systemContainer)
      };

      const userNode = {
        ...mockElement,
        textContent: 'User message',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(userContainer)
      };

      mockDocument.querySelectorAll.mockReturnValue([systemNode, userNode]);

      contentScript = new VeritasContentScript();

      expect(systemNode.appendChild).not.toHaveBeenCalled();
      expect(userNode.appendChild).not.toHaveBeenCalled();
    });
  });

  describe('API Communication', () => {
    it('should send properly formatted verification requests', async () => {
      const node = {
        ...mockElement,
        textContent: 'Climate change is real',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      contentScript = new VeritasContentScript();

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
          body: expect.stringContaining('Climate change is real')
        })
      );
    });

    it('should handle API rate limiting', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests'
      });

      const node = {
        ...mockElement,
        textContent: 'Test claim for rate limiting',
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

  describe('Performance and Optimization', () => {
    it('should batch verification requests', async () => {
      const nodes = Array(10).fill(null).map((_, index) => ({
        ...mockElement,
        textContent: 'Test claim ' + index,
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      }));

      mockDocument.querySelectorAll.mockReturnValue(nodes);

      contentScript = new VeritasContentScript();

      await new Promise(resolve => setTimeout(resolve, 100));

      // Should process in batches
      expect(global.fetch).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledTimes(Math.min(5, nodes.length)); // Batch size is 5
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

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);

      setIntervalSpy.mockRestore();
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle DOM manipulation errors', () => {
      const node = {
        ...mockElement,
        textContent: 'Test claim',
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null),
        appendChild: vi.fn().mockImplementation(() => {
          throw new Error('DOM manipulation failed');
        })
      };

      mockDocument.querySelectorAll.mockReturnValue([node]);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        contentScript = new VeritasContentScript();
      }).not.toThrow();

      consoleSpy.mockRestore();
    });

    it('should handle network timeouts', async () => {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), 50);
      });

      (global.fetch as any).mockImplementation(() => timeoutPromise);

      const nodes = Array(2).fill(null).map((_, index) => ({
        ...mockElement,
        textContent: 'Test claim ' + (index + 5),
        querySelector: vi.fn().mockReturnValue(null),
        matches: vi.fn().mockReturnValue(true),
        closest: vi.fn().mockReturnValue(null)
      }));

      mockDocument.querySelectorAll.mockReturnValue(nodes);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      contentScript = new VeritasContentScript();

      await new Promise(resolve => setTimeout(resolve, 150));

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle malformed API responses', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          // Missing required fields
          invalidField: 'invalid'
        })
      });

      const node = {
        ...mockElement,
        textContent: 'Test claim with bad response',
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

  describe('Configuration and Settings', () => {
    it('should use default configuration when none provided', () => {
      contentScript = new VeritasContentScript();

      expect(contentScript['config'].apiEndpoint).toBe('https://api.veritas.ai/verify');
      expect(contentScript['config'].maxRetries).toBe(3);
    });

    it('should update configuration when received', () => {
      contentScript = new VeritasContentScript();

      const messageEvent = {
        source: window,
        data: {
          type: 'VERITAS_CONFIG_UPDATE',
          config: {
            apiEndpoint: 'https://custom-api.veritas.ai/verify',
            maxRetries: 7
          }
        }
      };

      const messageHandler = mockWindow.addEventListener.mock.calls[0][1];
      messageHandler(messageEvent);

      expect(contentScript['config'].apiEndpoint).toBe('https://custom-api.veritas.ai/verify');
      expect(contentScript['config'].maxRetries).toBe(7);
    });
  });
}); 