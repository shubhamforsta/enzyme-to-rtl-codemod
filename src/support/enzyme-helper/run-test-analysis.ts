import { runCommand } from '../shell-helper/shell-helper';
import fs from 'fs';
import { createCustomLogger } from '../logger/logger';

export const testAnalysisLogger = createCustomLogger('Test Analysis');

export interface IndividualTestResult {
    testPass: boolean | null;
    failedTests: number;
    passedTests: number;
    totalTests: number;
    successRate: number;
}

export interface IndividualResultWithLogs extends IndividualTestResult {
    jestRunLogs: string;
}

export interface TestResults {
    failedTests: number;
    passedTests: number;
    totalTests: number;
    successRate: number;
}

/**
 * Run an RTL test file with Jest and analyze the results.
 *
 * This function executes a Jest test for a given file, logs the output, and performs
 * an analysis of the test results. It also checks whether the number of test cases
 * in the converted file matches the original and writes a summary of the results.
 *
 * @param {Object} params - The parameters for the function.
 * @param {string} params.filePath - The path to the test file to be executed.
 * @param {string} params.jestBinaryPath - The path to the Jest binary.
 * @param {string} params.jestRunLogsPath - The file path where Jest run logs will be saved.
 * @param {string} params.rtlConvertedFilePath - The path to the converted React Testing Library test file.
 * @param {string} params.outputResultsPath - The path where results will be saved.
 * @param {number} params.originalTestCaseNum - The number of test cases in the original test file.
 * @param {boolean} params.finalRun - Flag indicating whether this is the final run
 * @param {Ora} params.spinner - The spinner instance for progress tracking
 * @returns {Promise<IndividualResultWithLogs>} The test result, including pass/fail status, number of passed/failed tests, total tests, and success rate.
 */
export const runTestAndAnalyze = async ({
    filePath,
    jestBinaryPath,
    jestRunLogsPath,
    rtlConvertedFilePath,
    outputResultsPath,
    logLevel
}: {
    filePath: string;
    jestBinaryPath: string;
    jestRunLogsPath: string;
    rtlConvertedFilePath: string;
    outputResultsPath: string;
    logLevel?: string
}): Promise<IndividualResultWithLogs> => {

    const resultForAttempt: IndividualResultWithLogs = {
        testPass: null,
        failedTests: 0,
        passedTests: 0,
        totalTests: 0,
        successRate: 0,
        jestRunLogs: '',
    };

    // Create jest run command for the test file
    const rtlRunCommand = `${jestBinaryPath} ${filePath}`;
    testAnalysisLogger.verbose('Run converted tests');
    const generatedFileRunShellProcess = await runCommand(rtlRunCommand);

    // Collect test run logs
    testAnalysisLogger.verbose('Clean output');
    const testrunLogs = removeANSIEscapeCodes(
        generatedFileRunShellProcess.output +
            generatedFileRunShellProcess.stderr,
    );

    // Analyze logs for errors
    testAnalysisLogger.verbose('Analyze logs for errors');
    resultForAttempt.testPass = analyzeLogsForErrors(testrunLogs);

    // Log the results
    if (!resultForAttempt.testPass) {
        testAnalysisLogger.verbose('Test failed');
        testAnalysisLogger.verbose(
            `Converted RTL file path: ${rtlConvertedFilePath}`,
        );
        logLevel === 'verbose' && fs.writeFileSync(jestRunLogsPath, testrunLogs, 'utf-8');
        testAnalysisLogger.verbose(`Jest run logs file path: ${jestRunLogsPath}`);
        testAnalysisLogger.verbose(`See ${outputResultsPath} for more info`);
    }
    const detailedResult = extractTestResults(testrunLogs);
    // Merge detailedResult into the result object
    resultForAttempt.failedTests = detailedResult.failedTests;
    resultForAttempt.passedTests = detailedResult.passedTests;
    resultForAttempt.totalTests = detailedResult.totalTests;
    resultForAttempt.successRate = detailedResult.successRate;
    resultForAttempt.jestRunLogs = testrunLogs;

    return resultForAttempt;
};

/**
 * Remove ANSI escape codes from output
 * @param input
 * @returns
 */
export const removeANSIEscapeCodes = (input: string): string => {
    // Regular expression to match ANSI escape codes
    testAnalysisLogger.verbose('Cleaning up from ansi escape codes');
    // eslint-disable-next-line no-control-regex
    const ansiEscapeCodeRegex = /\u001b\[[0-9;]*m/g;
    // Remove ANSI escape codes from the input string
    return input.replace(ansiEscapeCodeRegex, '');
};

/**
 * Check if the jest run log has failed test cases
 * @param jestRunLogs
 * @returns
 */
export const analyzeLogsForErrors = (jestRunLogs: string): boolean => {
    testAnalysisLogger.verbose('Start: Analyze logs for errors');
    // Find errors in logs
    if (
        !jestRunLogs ||
        jestRunLogs.includes('FAIL') ||
        jestRunLogs.includes('No tests found') ||
        jestRunLogs.includes('Not run') ||
        jestRunLogs.includes('FATAL ERROR')
    ) {
        testAnalysisLogger.verbose('Done: Analyze logs for errors');
        return false;
    } else {
        testAnalysisLogger.verbose('Done: Analyze logs for errors');
        return true;
    }
};

/**
 * Extract details from jest run logs
 * @param jestRunLogs
 * @returns
 */
export const extractTestResults = (jestRunLogs: string): TestResults => {
    const detailedResult: TestResults = {
        failedTests: 0,
        passedTests: 0,
        totalTests: 0,
        successRate: 0,
    };

    const pattern =
        /Tests:\s*(?:(\d+) failed, )?(?:(\d+) skipped, )?(?:(\d+) passed, )?(\d+) total/;
    const match = jestRunLogs.match(pattern);

    if (match) {
        const [, failed = 0, , passed = 0, total = 0] = match.map(Number);

        // Update the detailedResult object if matched
        detailedResult.failedTests = failed || 0; // if failed is NaN
        detailedResult.passedTests = passed || 0; // if passed is NaN
        detailedResult.totalTests = total;
        detailedResult.successRate = (passed / total) * 100 || 0;
    } else {
        testAnalysisLogger.verbose(
            'Results were not parsed. Defaulting to 0...',
        );
    }
    return detailedResult;
};
