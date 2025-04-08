import { attemptAndValidateTransformation } from './attempt-and-validate-transformation';
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
      { type: 'function', function: { name: 'requestForComponent' } }
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
});
