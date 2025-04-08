import { attemptAndValidateTransformation, MAX_ATTEMPTS } from './attempt-and-validate-transformation';
import { Config } from '../config/config';
import { LLMCallFunction } from '../workflows/convert-test-files';
import { IndividualTestResult } from '../enzyme-helper/run-test-analysis';
import * as getFunctionsModule from './utils/getFunctions';
import * as componentHelperModule from './utils/component-helper';
import * as codeExtractorModule from '../code-extractor/extract-code';
import * as runTestAnalyzeModule from '../enzyme-helper/run-test-analysis';

// Mock dependencies
jest.mock('../logger/logger', () => ({
  createCustomLogger: jest.fn().mockReturnValue({
    verbose: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })
}));

jest.mock('./utils/getFunctions');
jest.mock('./utils/component-helper');
jest.mock('../code-extractor/extract-code');
jest.mock('../enzyme-helper/run-test-analysis');

// Helper functions for tests
const createLLMResponse = (callId: string, functionName = 'evaluateAndRun', args = { file: `test content for ${callId}` }) => ({
  finish_reason: 'complete',
  message: {
    content: '',
    tool_calls: [
      {
        id: callId,
        type: 'function',
        function: {
          name: functionName,
          arguments: JSON.stringify(args)
        }
      }
    ]
  }
});

// Define a type for the test response to fix type errors
interface TestResponse {
  testPass: boolean;
  failedTests: number;
  passedTests: number;
  totalTests: number;
  successRate: number;
  jestRunLogs?: string;
}

const createAnalyzeResponses = (totalCalls: number, pattern: 'identical' | 'improving' | 'failing' | 'success' = 'failing'): TestResponse[] => {
  const responses: TestResponse[] = [];
  
  for (let i = 0; i < totalCalls; i++) {
    let response: TestResponse;
    
    if (pattern === 'identical') {
      // For identical pattern, first is different, rest are identical
      if (i === 0) {
        response = {
          testPass: false,
          failedTests: 3,
          passedTests: 2,
          totalTests: 5,
          successRate: 40
        };
      } else {
        response = {
          testPass: false,
          failedTests: 2,
          passedTests: 3,
          totalTests: 5,
          successRate: 60
        };
      }
    } else if (pattern === 'improving') {
      // For improving pattern, each gets better
      const passedTests = Math.min(i, 4);
      const failedTests = 5 - passedTests;
      response = {
        testPass: passedTests === 5,
        failedTests,
        passedTests,
        totalTests: 5,
        successRate: (passedTests / 5) * 100
      };
    } else if (pattern === 'success') {
      // For success pattern, first fails, second succeeds
      if (i === 0) {
        response = {
          testPass: false,
          failedTests: 2,
          passedTests: 3,
          totalTests: 5,
          successRate: 60
        };
      } else {
        response = {
          testPass: true,
          failedTests: 0,
          passedTests: 5,
          totalTests: 5,
          successRate: 100
        };
      }
    } else {
      // Default 'failing' pattern - all fail
      response = {
        testPass: false,
        failedTests: 2,
        passedTests: 3,
        totalTests: 5,
        successRate: 60
      };
    }
    
    // Add the logs property to each response
    response.jestRunLogs = `Attempt ${i + 1} logs`;
    responses.push(response);
  }
  
  return responses;
};

describe('attemptAndValidateTransformation', () => {
  // Mock spinner
  const mockSpinner = {
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    text: ''
  };

  // Mock config - only include required properties from Config interface
  const mockConfig: Partial<Config> = {
    rtlConvertedFilePath: '/path/to/converted-test.tsx',
    jestBinaryPath: '/path/to/jest',
    jestRunLogsFilePath: '/path/to/logs',
    outputResultsPath: '/path/to/output',
    jsonSummaryPath: '/path/to/summary.json'
  };

  // Mock for successful test result based on actual interface
  const mockSuccessResult: Partial<IndividualTestResult> = {
    testPass: true,
    failedTests: 0,
    passedTests: 5,
    totalTests: 5,
    successRate: 100
  };

  // Mock for failed test result based on actual interface
  const mockFailedResult: Partial<IndividualTestResult> = {
    testPass: false,
    failedTests: 2,
    passedTests: 3,
    totalTests: 5,
    successRate: 60
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock implementations
    (getFunctionsModule.getFunctions as jest.Mock).mockReturnValue([
      { type: 'function', function: { name: 'evaluateAndRun' } },
      { type: 'function', function: { name: 'requestForFile' } },
      { type: 'function', function: { name: 'updateComponent' } }
    ]);
    
    (codeExtractorModule.extractCodeContentToFile as jest.Mock).mockReturnValue('/path/to/extracted');
    
    (runTestAnalyzeModule.runTestAndAnalyze as jest.Mock).mockResolvedValue({
      ...mockSuccessResult,
      jestRunLogs: 'Success logs'
    });
  });

  it('should process a single evaluateAndRun tool call and return success result', async () => {
    // Mock LLM call function
    const mockLLMCallFunction: LLMCallFunction = jest.fn().mockResolvedValue({
      finish_reason: 'complete',
      message: {
        content: '',
        tool_calls: [
          {
            id: 'call1',
            type: 'function',
            function: {
              name: 'evaluateAndRun',
              arguments: JSON.stringify({ file: 'test file content' })
            }
          }
        ]
      }
    });

    // Execute
    const result = await attemptAndValidateTransformation({
      config: mockConfig as Config,
      llmCallFunction: mockLLMCallFunction,
      initialPrompt: 'Test prompt',
      spinner: mockSpinner as any,
    });

    // Assert
    expect(mockLLMCallFunction).toHaveBeenCalledTimes(1);
    expect(codeExtractorModule.extractCodeContentToFile).toHaveBeenCalledWith({
      LLMresponse: 'test file content',
      rtlConvertedFilePath: mockConfig.rtlConvertedFilePath
    });
    expect(runTestAnalyzeModule.runTestAndAnalyze).toHaveBeenCalled();
    expect(result).toEqual(mockSuccessResult);
  });

  it('should handle a single requestForComponent tool call before evaluateAndRun', async () => {
    // Mock component helper
    (componentHelperModule.getFileFromRelativeImports as jest.Mock)
      .mockReturnValue('/absolute/path/to/component');
    (componentHelperModule.getComponentContent as jest.Mock)
      .mockReturnValue('component content');

    // Mock LLM call function to first return component request, then evaluateAndRun
    const mockLLMCallFunction: LLMCallFunction = jest.fn()
      .mockResolvedValueOnce({
        finish_reason: 'complete',
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call1',
              type: 'function',
              function: {
                name: 'requestForFile',
                arguments: JSON.stringify({ path: '../Component', currentFilePath: '/path/to/converted-test.tsx' })
              }
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        finish_reason: 'complete',
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call2',
              type: 'function',
              function: {
                name: 'evaluateAndRun',
                arguments: JSON.stringify({ file: 'test file content' })
              }
            }
          ]
        }
      });

    // Execute
    const result = await attemptAndValidateTransformation({
      config: mockConfig as Config,
      llmCallFunction: mockLLMCallFunction,
      initialPrompt: 'Test prompt',
      spinner: mockSpinner as any,
    });

    // Assert
    expect(mockLLMCallFunction).toHaveBeenCalledTimes(2);
    expect(componentHelperModule.getFileFromRelativeImports)
      .toHaveBeenCalledWith('../Component', mockConfig.rtlConvertedFilePath);
    expect(componentHelperModule.getComponentContent)
      .toHaveBeenCalledWith('/absolute/path/to/component');
    expect(result).toEqual(mockSuccessResult);
  });

  it('should handle multiple tool calls in a single response', async () => {
    // Mock component helper
    (componentHelperModule.getFileFromRelativeImports as jest.Mock)
      .mockReturnValue('/absolute/path/to/component');
    (componentHelperModule.getComponentContent as jest.Mock)
      .mockReturnValue('component content');
    
    // Mock runTestAndAnalyze to return success
    (runTestAnalyzeModule.runTestAndAnalyze as jest.Mock).mockResolvedValue({
      ...mockSuccessResult,
      jestRunLogs: 'Success logs'
    });

    // Mock LLM call function with multiple tool calls in one response
    const mockLLMCallFunction: LLMCallFunction = jest.fn()
      .mockResolvedValue({
        finish_reason: 'complete',
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call1',
              type: 'function',
              function: {
                name: 'requestForFile',
                arguments: JSON.stringify({ path: '../Component1', currentFilePath: '/path/to/converted-test.tsx' })
              }
            },
            {
              id: 'call2',
              type: 'function',
              function: {
                name: 'requestForFile',
                arguments: JSON.stringify({ path: '../Component2', currentFilePath: '/path/to/converted-test.tsx' })
              }
            },
            {
              id: 'call3',
              type: 'function',
              function: {
                name: 'evaluateAndRun',
                arguments: JSON.stringify({ file: 'test file content' })
              }
            }
          ]
        }
      });

    // Execute
    const result = await attemptAndValidateTransformation({
      config: mockConfig as Config,
      llmCallFunction: mockLLMCallFunction,
      initialPrompt: 'Test prompt',
      spinner: mockSpinner as any,
    });

    // Assert
    expect(mockLLMCallFunction).toHaveBeenCalledTimes(1);
    
    // With our new implementation, we should process both component requests
    expect(componentHelperModule.getFileFromRelativeImports).toHaveBeenCalledTimes(2);
    
    // The function should process the component requests for both Component1 and Component2
    expect(componentHelperModule.getFileFromRelativeImports)
      .toHaveBeenCalledWith('../Component1', mockConfig.rtlConvertedFilePath);
    expect(componentHelperModule.getFileFromRelativeImports)
      .toHaveBeenCalledWith('../Component2', mockConfig.rtlConvertedFilePath);
    
    // It should also process the evaluateAndRun call and return a successful result
    expect(codeExtractorModule.extractCodeContentToFile).toHaveBeenCalledWith({
      LLMresponse: 'test file content',
      rtlConvertedFilePath: mockConfig.rtlConvertedFilePath
    });
    
    expect(runTestAnalyzeModule.runTestAndAnalyze).toHaveBeenCalled();
    expect(result).toEqual(mockSuccessResult);
  });

  it('should retry on test failure up to 3 times', async () => {
    // Mock LLM call function to return evaluateAndRun with failing tests, then success
    const mockLLMCallFunction: LLMCallFunction = jest.fn()
      .mockResolvedValueOnce({
        finish_reason: 'complete',
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call1',
              type: 'function',
              function: {
                name: 'evaluateAndRun',
                arguments: JSON.stringify({ file: 'failing test content' })
              }
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        finish_reason: 'complete',
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call2',
              type: 'function',
              function: {
                name: 'evaluateAndRun',
                arguments: JSON.stringify({ file: 'successful test content' })
              }
            }
          ]
        }
      });

    // Mock test analysis to first return failure, then success
    (runTestAnalyzeModule.runTestAndAnalyze as jest.Mock)
      .mockResolvedValueOnce({
        ...mockFailedResult,
        jestRunLogs: 'Failure logs'
      })
      .mockResolvedValueOnce({
        ...mockSuccessResult,
        jestRunLogs: 'Success logs'
      });

    // Execute
    const result = await attemptAndValidateTransformation({
      config: mockConfig as Config,
      llmCallFunction: mockLLMCallFunction,
      initialPrompt: 'Test prompt',
      spinner: mockSpinner as any,
    });

    // Assert
    expect(mockLLMCallFunction).toHaveBeenCalledTimes(2);
    expect(runTestAnalyzeModule.runTestAndAnalyze).toHaveBeenCalledTimes(2);
    expect(result).toEqual(mockSuccessResult);
  });

  it('should handle natural language response without tool calls', async () => {
    // Mock LLM call function to return natural language first, then tool call
    const mockLLMCallFunction: LLMCallFunction = jest.fn()
      .mockResolvedValueOnce({
        finish_reason: 'complete',
        message: {
          content: 'Here is my analysis',
          tool_calls: []
        }
      })
      .mockResolvedValueOnce({
        finish_reason: 'complete',
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call1',
              type: 'function',
              function: {
                name: 'evaluateAndRun',
                arguments: JSON.stringify({ file: 'test file content' })
              }
            }
          ]
        }
      });

    // Execute
    const result = await attemptAndValidateTransformation({
      config: mockConfig as Config,
      llmCallFunction: mockLLMCallFunction,
      initialPrompt: 'Test prompt',
      spinner: mockSpinner as any,
    });

    // Assert
    expect(mockLLMCallFunction).toHaveBeenCalledTimes(2);
    expect(result).toEqual(mockSuccessResult);
  });

  it('should handle updateComponent tool call successfully', async () => {
    // Mock component helper
    (componentHelperModule.getFileFromRelativeImports as jest.Mock)
      .mockReturnValue('/absolute/path/to/component');
    (componentHelperModule.updateComponentContent as jest.Mock)
      .mockReturnValue({ success: true, message: 'Component file updated successfully' });

    // Mock LLM call function to first return updateComponent request, then evaluateAndRun
    const mockLLMCallFunction: LLMCallFunction = jest.fn()
      .mockResolvedValueOnce({
        finish_reason: 'complete',
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call1',
              type: 'function',
              function: {
                name: 'updateComponent',
                arguments: JSON.stringify({
                  path: '../Component',
                  currentFilePath: '/path/to/converted-test.tsx',
                  newContent: 'updated component content with data-testid',
                  explanation: 'Added data-testid to make element queryable in RTL'
                })
              }
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        finish_reason: 'complete',
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call2',
              type: 'function',
              function: {
                name: 'evaluateAndRun',
                arguments: JSON.stringify({ file: 'test file content with updated component reference' })
              }
            }
          ]
        }
      });

    // Execute
    const result = await attemptAndValidateTransformation({
      config: mockConfig as Config,
      llmCallFunction: mockLLMCallFunction,
      initialPrompt: 'Test prompt',
      spinner: mockSpinner as any,
    });

    // Assert
    expect(mockLLMCallFunction).toHaveBeenCalledTimes(2);
    expect(componentHelperModule.getFileFromRelativeImports)
      .toHaveBeenCalledWith('../Component', mockConfig.rtlConvertedFilePath);
    expect(componentHelperModule.updateComponentContent)
      .toHaveBeenCalledWith(
        '/absolute/path/to/component', 
        'updated component content with data-testid'
      );
    expect(result).toEqual(mockSuccessResult);
  });

  it('should handle updateComponent tool call with absolutePath parameter', async () => {
    // Mock component helper
    (componentHelperModule.updateComponentContent as jest.Mock)
      .mockReturnValue({ success: true, message: 'Component file updated successfully' });

    // Mock LLM call function with absolutePath parameter
    const mockLLMCallFunction: LLMCallFunction = jest.fn()
      .mockResolvedValueOnce({
        finish_reason: 'complete',
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call1',
              type: 'function',
              function: {
                name: 'updateComponent',
                arguments: JSON.stringify({
                  absolutePath: '/absolute/path/to/component.tsx',
                  newContent: 'updated component content with data-testid',
                  explanation: 'Added data-testid to make element queryable in RTL'
                })
              }
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        finish_reason: 'complete',
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call2',
              type: 'function',
              function: {
                name: 'evaluateAndRun',
                arguments: JSON.stringify({ file: 'test file content with updated component reference' })
              }
            }
          ]
        }
      });

    // Execute
    const result = await attemptAndValidateTransformation({
      config: mockConfig as Config,
      llmCallFunction: mockLLMCallFunction,
      initialPrompt: 'Test prompt',
      spinner: mockSpinner as any,
    });

    // Assert
    expect(mockLLMCallFunction).toHaveBeenCalledTimes(2);
    expect(componentHelperModule.getFileFromRelativeImports).not.toHaveBeenCalled();
    expect(componentHelperModule.updateComponentContent)
      .toHaveBeenCalledWith(
        '/absolute/path/to/component.tsx', 
        'updated component content with data-testid'
      );
    expect(result).toEqual(mockSuccessResult);
  });

  it('should handle updateComponent tool call failure', async () => {
    // Mock component helper
    (componentHelperModule.getFileFromRelativeImports as jest.Mock)
      .mockReturnValue('/absolute/path/to/component');
    (componentHelperModule.updateComponentContent as jest.Mock)
      .mockReturnValue({ success: false, message: 'not found' });

    // Mock LLM call function
    const mockLLMCallFunction: LLMCallFunction = jest.fn()
      .mockResolvedValueOnce({
        finish_reason: 'complete',
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call1',
              type: 'function',
              function: {
                name: 'updateComponent',
                arguments: JSON.stringify({
                  path: '../Component',
                  currentFilePath: '/path/to/converted-test.tsx',
                  newContent: 'updated component content with data-testid',
                  explanation: 'Added data-testid to make element queryable in RTL'
                })
              }
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        finish_reason: 'complete',
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call2',
              type: 'function',
              function: {
                name: 'evaluateAndRun',
                arguments: JSON.stringify({ file: 'test file content with fallback approach' })
              }
            }
          ]
        }
      });

    // Execute
    const result = await attemptAndValidateTransformation({
      config: mockConfig as Config,
      llmCallFunction: mockLLMCallFunction,
      initialPrompt: 'Test prompt',
      spinner: mockSpinner as any,
    });

    // Assert
    expect(mockLLMCallFunction).toHaveBeenCalledTimes(2);
    expect(componentHelperModule.getFileFromRelativeImports)
      .toHaveBeenCalledWith('../Component', mockConfig.rtlConvertedFilePath);
    expect(componentHelperModule.updateComponentContent)
      .toHaveBeenCalledWith(
        '/absolute/path/to/component', 
        'updated component content with data-testid'
      );
    expect(mockSpinner.fail).toHaveBeenCalledWith('Failed to update component file: not found');
    expect(result).toEqual(mockSuccessResult);
  });

  it('should handle updateComponent tool call with invalid arguments', async () => {
    // Mock LLM call function with missing required arguments
    const mockLLMCallFunction: LLMCallFunction = jest.fn()
      .mockResolvedValueOnce({
        finish_reason: 'complete',
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call1',
              type: 'function',
              function: {
                name: 'updateComponent',
                arguments: JSON.stringify({
                  // Missing path and currentFilePath
                  newContent: 'updated component content with data-testid',
                  explanation: 'Added data-testid to make element queryable in RTL'
                })
              }
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        finish_reason: 'complete',
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call2',
              type: 'function',
              function: {
                name: 'evaluateAndRun',
                arguments: JSON.stringify({ file: 'test file content with fallback approach' })
              }
            }
          ]
        }
      });

    // Execute
    const result = await attemptAndValidateTransformation({
      config: mockConfig as Config,
      llmCallFunction: mockLLMCallFunction,
      initialPrompt: 'Test prompt',
      spinner: mockSpinner as any,
    });

    // Assert
    expect(mockLLMCallFunction).toHaveBeenCalledTimes(2);
    expect(componentHelperModule.getFileFromRelativeImports).not.toHaveBeenCalled();
    expect(componentHelperModule.updateComponentContent).not.toHaveBeenCalled();
    expect(mockSpinner.fail).toHaveBeenCalledWith('Failed to update component file');
    expect(result).toEqual(mockSuccessResult);
  });

  it('should break early when three consecutive attempts have identical success rates', async () => {
    // Mock LLM call function to return evaluateAndRun with consistent failure rates
    const mockLLMCallFunction = jest.fn().mockImplementation(() => Promise.resolve(createLLMResponse(`call-default`))) as jest.MockedFunction<LLMCallFunction>;
    
    // Create 4 mock responses for LLM calls
    mockLLMCallFunction
      .mockResolvedValueOnce(createLLMResponse(`call1`))
      .mockResolvedValueOnce(createLLMResponse(`call2`))
      .mockResolvedValueOnce(createLLMResponse(`call3`))
      .mockResolvedValueOnce(createLLMResponse(`call4`));

    // Create analyze responses with identical success rates for the last 3 attempts
    const analyzeResponses = createAnalyzeResponses(4, 'identical');
    
    // Clear previous mock implementation and set up the sequence
    jest.clearAllMocks();
    
    // We need to chain the mock responses
    const mockAnalyze = runTestAnalyzeModule.runTestAndAnalyze as jest.Mock;
    mockAnalyze
      .mockResolvedValueOnce(analyzeResponses[0])
      .mockResolvedValueOnce(analyzeResponses[1])
      .mockResolvedValueOnce(analyzeResponses[2])
      .mockResolvedValueOnce(analyzeResponses[3]);

    // Execute
    const result = await attemptAndValidateTransformation({
      config: mockConfig as Config,
      llmCallFunction: mockLLMCallFunction,
      initialPrompt: 'Test prompt',
      spinner: mockSpinner as any,
    });

    // Assert
    // Should only call LLM 4 times, breaking after the 4th attempt
    // because attempts 2, 3, and 4 had identical success rates
    expect(mockLLMCallFunction).toHaveBeenCalledTimes(4);
    expect(runTestAnalyzeModule.runTestAndAnalyze).toHaveBeenCalledTimes(4);
    expect(mockSpinner.fail).toHaveBeenCalledWith('No improvement in success rate after 3 attempts with identical results, breaking');
    
    // The result should be from the last attempt (without jestRunLogs)
    const { jestRunLogs, ...expectedResult } = analyzeResponses[3];
    expect(result).toEqual(expectedResult);
  });

  it('should not break early when success rates are improving', async () => {
    const mockLLMCallFunction = jest.fn().mockImplementation(() => Promise.resolve(createLLMResponse(`call-default`))) as jest.MockedFunction<LLMCallFunction>;
    
    mockLLMCallFunction
      .mockResolvedValueOnce(createLLMResponse(`call1`))
      .mockResolvedValueOnce(createLLMResponse(`call2`))
      .mockResolvedValueOnce(createLLMResponse(`call3`))
      .mockResolvedValueOnce(createLLMResponse(`call4`))
      .mockResolvedValueOnce(createLLMResponse(`call5`));

    // Mock runTestAndAnalyze to return improving success rates (with jestRunLogs)
    const analyzeResponses = createAnalyzeResponses(5, 'improving');
    
    // Clear previous mock implementation and set up the sequence
    jest.clearAllMocks();
    
    // We need to chain the mock responses
    const mockAnalyze = runTestAnalyzeModule.runTestAndAnalyze as jest.Mock;
    mockAnalyze
      .mockResolvedValueOnce(analyzeResponses[0])
      .mockResolvedValueOnce(analyzeResponses[1])
      .mockResolvedValueOnce(analyzeResponses[2])
      .mockResolvedValueOnce(analyzeResponses[3])
      .mockResolvedValueOnce(analyzeResponses[4]);

    // Execute
    const result = await attemptAndValidateTransformation({
      config: mockConfig as Config,
      llmCallFunction: mockLLMCallFunction,
      initialPrompt: 'Test prompt',
      spinner: mockSpinner as any,
    });

    // Assert
    // The test should make 5 calls because of how attemptCounter works in the real code
    expect(mockLLMCallFunction).toHaveBeenCalledTimes(5);
    expect(runTestAnalyzeModule.runTestAndAnalyze).toHaveBeenCalledTimes(5);
    expect(mockSpinner.fail).not.toHaveBeenCalledWith('No improvement in success rate after 3 attempts with identical results, breaking');
    
    // The result should be from the last attempt (without jestRunLogs)
    const { jestRunLogs, ...expectedResult } = analyzeResponses[4];
    expect(result).toEqual(expectedResult);
  });

  it('should break immediately on test success regardless of attempts left', async () => {
    // Mock LLM call function with a successful result on the second attempt
    const mockLLMCallFunction = jest.fn().mockImplementation(() => Promise.resolve(createLLMResponse(`call-default`))) as jest.MockedFunction<LLMCallFunction>;
    
    // Create LLM responses
    mockLLMCallFunction
      .mockResolvedValueOnce(createLLMResponse(`call1`))
      .mockResolvedValueOnce(createLLMResponse(`call2`));

    // Create analyze responses with success on second attempt
    const analyzeResponses = createAnalyzeResponses(2, 'success');
    
    // Clear previous mock implementation and set up the sequence
    jest.clearAllMocks();
    
    // We need to chain the mock responses
    const mockAnalyze = runTestAnalyzeModule.runTestAndAnalyze as jest.Mock;
    mockAnalyze
      .mockResolvedValueOnce(analyzeResponses[0])
      .mockResolvedValueOnce(analyzeResponses[1]);

    // Execute
    const result = await attemptAndValidateTransformation({
      config: mockConfig as Config,
      llmCallFunction: mockLLMCallFunction,
      initialPrompt: 'Test prompt',
      spinner: mockSpinner as any,
    });

    // Assert
    // Should only call LLM twice, breaking after success on the second attempt
    expect(mockLLMCallFunction).toHaveBeenCalledTimes(2);
    expect(runTestAnalyzeModule.runTestAndAnalyze).toHaveBeenCalledTimes(2);
    
    // The result should be the success result (without jestRunLogs)
    expect(result).toEqual({
      testPass: true,
      failedTests: 0,
      passedTests: 5,
      totalTests: 5,
      successRate: 100
    });
  });

  it('should stop after reaching MAX_ATTEMPTS', async () => {
    // Mock LLM call function to always return failed tests
    const mockLLMCallFunction = jest.fn().mockImplementation(() => Promise.resolve(createLLMResponse(`call-default`))) as jest.MockedFunction<LLMCallFunction>;
    
    // Create mock responses for all attempts
    mockLLMCallFunction
      .mockResolvedValueOnce(createLLMResponse(`call1`))
      .mockResolvedValueOnce(createLLMResponse(`call2`))
      .mockResolvedValueOnce(createLLMResponse(`call3`));

    // Create analyze responses for all attempts
    const analyzeResponses = createAnalyzeResponses(3, 'failing');
    
    // Clear previous mock implementation and set up the sequence
    jest.clearAllMocks();
    
    // We need to chain the mock responses
    const mockAnalyze = runTestAnalyzeModule.runTestAndAnalyze as jest.Mock;
    mockAnalyze
      .mockResolvedValueOnce(analyzeResponses[0])
      .mockResolvedValueOnce(analyzeResponses[1])
      .mockResolvedValueOnce(analyzeResponses[2]);

    // Execute
    const result = await attemptAndValidateTransformation({
      config: mockConfig as Config,
      llmCallFunction: mockLLMCallFunction,
      initialPrompt: 'Test prompt',
      spinner: mockSpinner as any,
    });

    expect(mockLLMCallFunction).toHaveBeenCalledTimes(3);
    expect(runTestAnalyzeModule.runTestAndAnalyze).toHaveBeenCalledTimes(3);
    const { jestRunLogs, ...expectedResult } = analyzeResponses[2];
    expect(result).toEqual(expectedResult);
  });
});
