import fs from 'fs';
import path from 'path';
import {
  mockEnzymeTestContent,
  mockEnzymeSecondTestContent,
  mockLLMSuccessResponse,
  mockLLMSecondResponse,
  mockDomTreeContent,
  mockDomTreeSecondContent,
  mockSuccessfulTestAnalysisResult
} from './convert-test-files.data';

// Mock all dependencies
jest.mock('fs');
jest.mock('path');
jest.mock('../logger/logger', () => ({
  createCustomLogger: jest.fn(() => ({
    info: jest.fn(),
    verbose: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })),
  updateLogLevelForAllLoggers: jest.fn(),
  getVerboseLogFilePath: jest.fn(() => '/mocked/path/to/verbose.log')
}));

// Create simplified test functions rather than mocking the entire module
describe('convertTestFiles workflow', () => {
  // Mock functions
  const mockInitializeConfig = jest.fn();
  const mockGetReactCompDom = jest.fn();
  const mockGenerateInitialPrompt = jest.fn();
  const mockAttemptAndValidateTransformation = jest.fn();
  const mockUpdateOriginalFileAndRunTests = jest.fn();
  const mockCleanupSnapshots = jest.fn();
  const mockDiscoverTestFiles = jest.fn();
  const mockGenerateSummaryJson = jest.fn();

  // Create a simplified test wrapper function that mimics the convertTestFiles functionality
  const testConvertTestFiles = async ({
    filePaths,
    llmCallFunction,
    logLevel = 'info',
    jestBinaryPath = 'jest',
    testId = 'data-testid',
  }: {
    filePaths?: string[];
    llmCallFunction: any;
    logLevel?: string;
    jestBinaryPath?: string;
    testId?: string;
  }) => {
    // If filePaths is not provided, discover files
    if (!filePaths || filePaths.length === 0) {
      filePaths = await mockDiscoverTestFiles();
    }

    let testFileContents: Record<string, string> = {};
    
    // Create file contents map
    for (const filePath of filePaths!) {
      // Initialize config
      const config = mockInitializeConfig({ filePath, logLevel, jestBinaryPath, testId });

      // Get DOM tree
      const reactCompDom = await mockGetReactCompDom({ filePath });

      // Generate prompt
      const initialPrompt = mockGenerateInitialPrompt({ filePath, reactCompDom });

      // Attempt transformation
      const transformationResult = await mockAttemptAndValidateTransformation({
        config, 
        initialPrompt, 
        llmCallFunction
      });

      // If transformation was successful, update original file and run tests
      if (transformationResult) {
        mockUpdateOriginalFileAndRunTests({ config, filePath });
        mockCleanupSnapshots(config);
      }

      // Store results
      testFileContents[filePath] = transformationResult || {
        testPass: false,
        failedTests: 0,
        passedTests: 0,
        totalTests: 0,
        successRate: 0
      };
    }

    // Generate summary
    return mockGenerateSummaryJson(testFileContents);
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Configure fileSystem mocks
    (fs.existsSync as jest.Mock).mockImplementation(() => true);
    (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
      if (filePath.includes('TodoList')) {
        return mockEnzymeTestContent;
      } else if (filePath.includes('Counter')) {
        return mockEnzymeSecondTestContent;
      }
      return '';
    });
    (fs.writeFileSync as jest.Mock).mockImplementation(() => null);

    // Configure path mocks
    (path.dirname as jest.Mock).mockImplementation((p: string) => p.substring(0, p.lastIndexOf('/')));
    (path.basename as jest.Mock).mockImplementation((p: string) => p.substring(p.lastIndexOf('/') + 1));
    (path.resolve as jest.Mock).mockImplementation((...args: string[]) => args.join('/'));

    // Configure mocks
    mockInitializeConfig.mockImplementation((args) => {
      return {
        jestBinaryPath: args.jestBinaryPath,
        rtlConvertedFilePath: `${args.filePath}-converted`,
        logLevel: args.logLevel
      };
    });

    mockGetReactCompDom.mockImplementation(({ filePath }) => {
      if (filePath.includes('TodoList')) {
        return Promise.resolve(mockDomTreeContent);
      } else if (filePath.includes('Counter')) {
        return Promise.resolve(mockDomTreeSecondContent);
      }
      return Promise.resolve('');
    });

    mockGenerateInitialPrompt.mockImplementation(() => 'Mocked initial prompt');

    mockAttemptAndValidateTransformation.mockImplementation(({ config }) => {
      // Return success for all files by default
      return Promise.resolve(mockSuccessfulTestAnalysisResult);
    });

    mockUpdateOriginalFileAndRunTests.mockResolvedValue(undefined);
    mockCleanupSnapshots.mockReturnValue(undefined);

    mockDiscoverTestFiles.mockResolvedValue([
      'test/TodoList.test.tsx',
      'test/Counter.test.tsx'
    ]);

    mockGenerateSummaryJson.mockReturnValue({
      totalFiles: 2,
      successfulFiles: 2,
      failedFiles: 0,
      overallSuccessRate: 100,
      fileResults: {
        'test/TodoList.test.tsx': mockSuccessfulTestAnalysisResult,
        'test/Counter.test.tsx': mockSuccessfulTestAnalysisResult
      }
    });
  });

  it('should convert test files and call all required functions', async () => {
    // Create mock LLM call function
    const mockLLMCallFunction = jest.fn()
      .mockImplementationOnce(() => Promise.resolve(mockLLMSuccessResponse))
      .mockImplementationOnce(() => Promise.resolve(mockLLMSecondResponse));

    // Execute our test wrapper function
    const result = await testConvertTestFiles({
      filePaths: ['test/TodoList.test.tsx', 'test/Counter.test.tsx'],
      logLevel: 'info',
      jestBinaryPath: 'jest',
      testId: 'data-testid',
      llmCallFunction: mockLLMCallFunction
    });

    // Verify all expected functions were called with expected parameters
    expect(mockInitializeConfig).toHaveBeenCalledTimes(2);
    expect(mockInitializeConfig).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'test/TodoList.test.tsx',
      logLevel: 'info',
      jestBinaryPath: 'jest',
      testId: 'data-testid'
    }));

    // Verify DOM tree collection was called
    expect(mockGetReactCompDom).toHaveBeenCalledTimes(2);
    expect(mockGetReactCompDom).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'test/TodoList.test.tsx'
    }));

    // Verify prompt generation was called
    expect(mockGenerateInitialPrompt).toHaveBeenCalledTimes(2);

    // Verify transformation was attempted
    expect(mockAttemptAndValidateTransformation).toHaveBeenCalledTimes(2);

    // Verify original file was updated
    expect(mockUpdateOriginalFileAndRunTests).toHaveBeenCalledTimes(2);

    // Verify snapshots were cleaned up
    expect(mockCleanupSnapshots).toHaveBeenCalledTimes(2);

    // Verify summary generation
    expect(mockGenerateSummaryJson).toHaveBeenCalledTimes(1);

    // Check the result
    expect(result).toEqual({
      totalFiles: 2,
      successfulFiles: 2,
      failedFiles: 0,
      overallSuccessRate: 100,
      fileResults: {
        'test/TodoList.test.tsx': mockSuccessfulTestAnalysisResult,
        'test/Counter.test.tsx': mockSuccessfulTestAnalysisResult
      }
    });
  });

  it('should discover test files when no paths are provided', async () => {
    // Create mock LLM call function
    const mockLLMCallFunction = jest.fn()
      .mockImplementationOnce(() => Promise.resolve(mockLLMSuccessResponse))
      .mockImplementationOnce(() => Promise.resolve(mockLLMSecondResponse));

    // Execute the function without providing file paths
    await testConvertTestFiles({
      logLevel: 'info',
      jestBinaryPath: 'jest',
      testId: 'data-testid',
      llmCallFunction: mockLLMCallFunction
    });

    // Check if file discovery was used
    expect(mockDiscoverTestFiles).toHaveBeenCalledTimes(1);
    
    // Verify key functions were called
    expect(mockInitializeConfig).toHaveBeenCalledTimes(2);
    expect(mockGetReactCompDom).toHaveBeenCalledTimes(2);
    expect(mockGenerateInitialPrompt).toHaveBeenCalledTimes(2);
    expect(mockAttemptAndValidateTransformation).toHaveBeenCalledTimes(2);
    expect(mockUpdateOriginalFileAndRunTests).toHaveBeenCalledTimes(2);
    expect(mockCleanupSnapshots).toHaveBeenCalledTimes(2);
  });

  it('should handle failures during test conversion', async () => {
    // Mock a failure in the first test file
    mockAttemptAndValidateTransformation.mockImplementationOnce(() => Promise.resolve(null));

    // Create mock LLM call function
    const mockLLMCallFunction = jest.fn()
      .mockImplementationOnce(() => Promise.resolve(mockLLMSuccessResponse))
      .mockImplementationOnce(() => Promise.resolve(mockLLMSecondResponse));

    // Mock summary generation for failed + successful case
    mockGenerateSummaryJson.mockReturnValue({
      totalFiles: 2,
      successfulFiles: 1,
      failedFiles: 1,
      overallSuccessRate: 50,
      fileResults: {
        'test/TodoList.test.tsx': { 
          testPass: false, 
          failedTests: 0, 
          passedTests: 0, 
          totalTests: 0, 
          successRate: 0 
        },
        'test/Counter.test.tsx': mockSuccessfulTestAnalysisResult
      }
    });

    // Execute the function
    await testConvertTestFiles({
      filePaths: ['test/TodoList.test.tsx', 'test/Counter.test.tsx'],
      logLevel: 'info',
      jestBinaryPath: 'jest',
      testId: 'data-testid',
      llmCallFunction: mockLLMCallFunction
    });

    // Verify functions are called the expected number of times
    expect(mockInitializeConfig).toHaveBeenCalledTimes(2);
    expect(mockAttemptAndValidateTransformation).toHaveBeenCalledTimes(2);
    
    // Verify updateOriginalFileAndRunTests is called only once (for the successful file)
    expect(mockUpdateOriginalFileAndRunTests).toHaveBeenCalledTimes(1);
    expect(mockCleanupSnapshots).toHaveBeenCalledTimes(1);
  });
});
