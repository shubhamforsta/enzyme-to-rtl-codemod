import { runCommand } from '../shell-helper/shell-helper';
import fs from 'fs';
import { createCustomLogger } from '../logger/logger';
import { Ora } from 'ora';
import { Config } from '../config/config';
import path from 'path';
export const testAnalysisLogger = createCustomLogger('Test Analysis');

export interface IndividualTestResult {
    testPass: boolean | null;
    failedTests: number;
    passedTests: number;
    totalTests: number;
    successRate: number;
    typeCheckPass: boolean | null;
}

export interface IndividualResultWithLogs extends IndividualTestResult {
    jestRunLogs: string;
    typeCheckLogs: string;
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
    typeCheckBinaryPath,
    jestRunLogsPath,
    rtlConvertedFilePath,
    outputResultsPath,
    logLevel
}: {
    filePath: string;
    jestBinaryPath: string;
    typeCheckBinaryPath: string;
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
        typeCheckLogs: '',
        typeCheckPass: null
    };

    // Create jest run command for the test file
    const rtlRunCommand = `${jestBinaryPath} ${filePath}`;
    testAnalysisLogger.verbose('Run converted tests');
    
    try {
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
    } catch (error) {
        // Handle errors, especially timeouts
        testAnalysisLogger.error(`Error running test: ${error instanceof Error ? error.message : String(error)}`);
        
        // Set failure info
        resultForAttempt.testPass = false;
        resultForAttempt.jestRunLogs = `Error during test execution: ${error instanceof Error ? error.message : String(error)}`;
        
        // Log to file for debugging
        logLevel === 'verbose' && fs.writeFileSync(jestRunLogsPath, resultForAttempt.jestRunLogs, 'utf-8');
        
        resultForAttempt.totalTests = 0;
        resultForAttempt.failedTests = 0;
        resultForAttempt.passedTests = 0;
        resultForAttempt.successRate = 0;
    }

    try {
        // Type check the file
        // Ensure filePath is relative to project root, not user's root directory
        const relativeFilePath = path.relative(process.cwd(), filePath);
        const typeCheckCommand = `${typeCheckBinaryPath} ${relativeFilePath}`;
        const generatedFileRunShellProcess = await runCommand(typeCheckCommand);
        resultForAttempt.typeCheckLogs = removeANSIEscapeCodes(
            generatedFileRunShellProcess.output +
                generatedFileRunShellProcess.stderr,
        );
        resultForAttempt.typeCheckPass = analyseTypeCheckLogs(resultForAttempt.typeCheckLogs);
    } catch (error) {
        testAnalysisLogger.error(`Type check failed for file: ${filePath}`);
        resultForAttempt.typeCheckLogs = `Error during type check: ${error instanceof Error ? error.message : String(error)}`;
        resultForAttempt.typeCheckPass = false;
    }

    return resultForAttempt;
};

/**
 * Transfer content from RTL converted file to original file and run tests
 * 
 * @param {Object} params - The parameters for the function.
 * @param {Config} params.config - The config object containing file paths
 * @param {Ora} params.spinner - The spinner instance for progress tracking
 * @param {string} params.filePath - The path to the original file
 */
export const updateOriginalFileAndRunTests = async ({
    config,
    spinner,
    filePath
}: {
    config: Config;
    spinner: Ora;
    filePath: string;
}): Promise<void> => {
    try {
        spinner.start(`Transferring RTL content to original file: ${filePath}`);
        if (fs.existsSync(config.rtlConvertedFilePath)) {
            // Read the content of the RTL converted file
            const rtlContent = fs.readFileSync(config.rtlConvertedFilePath, 'utf-8');
            
            // Write the content to the original Enzyme test file
            fs.writeFileSync(filePath, rtlContent, 'utf-8');
            
            // Delete the RTL converted file
            fs.unlinkSync(config.rtlConvertedFilePath);
            
            spinner.succeed(`Successfully transferred RTL content to ${filePath} and deleted temporary file`);
            
            // Run the file using Jest
            spinner.start(`Running tests on updated file: ${filePath}`);
            const rtlRunCommand = `${config.jestBinaryPath} ${filePath}`;
            testAnalysisLogger.verbose('Run converted tests on original file');
            const runResult = await runCommand(rtlRunCommand);
            spinner.info('Test run complete');
        } else {
            spinner.fail(`RTL converted file not found: ${config.rtlConvertedFilePath}`);
        }
    } catch (error) {
        spinner.fail(`Error transferring RTL content to original file: ${error}`);
    }
};

/**
 * Cleanup snapshot files for temporary test files
 * 
 * @param {Config} config - The config object containing file paths
 */
export const cleanupSnapshots = (config: Config): void => {
    try {
        // Check for enzyme adapter file snapshots
        const enzymeAdapterSnapshot = `${config.filePathWithEnzymeAdapter}.snap`;
        if (fs.existsSync(enzymeAdapterSnapshot)) {
            fs.unlinkSync(enzymeAdapterSnapshot);
            testAnalysisLogger.info(`Deleted enzyme adapter snapshot: ${enzymeAdapterSnapshot}`);
        }
        
        // Check for RTL converted file snapshots
        const rtlConvertedSnapshot = `${config.rtlConvertedFilePath}.snap`;
        if (fs.existsSync(rtlConvertedSnapshot)) {
            fs.unlinkSync(rtlConvertedSnapshot);
            testAnalysisLogger.info(`Deleted RTL converted snapshot: ${rtlConvertedSnapshot}`);
        }

        // Check for snapshots in __snapshots__ directory (Jest default)
        // Extract directory paths and filenames
        const enzymeDir = path.dirname(config.filePathWithEnzymeAdapter);
        const enzymeFile = path.basename(config.filePathWithEnzymeAdapter);
        const rtlDir = path.dirname(config.rtlConvertedFilePath);
        const rtlFile = path.basename(config.rtlConvertedFilePath);
        
        // Check for enzyme snapshot in __snapshots__ directory
        const enzymeSnapshotDir = path.join(enzymeDir, '__snapshots__');
        const enzymeSnapshotPath = path.join(enzymeSnapshotDir, `${enzymeFile}.snap`);
        if (fs.existsSync(enzymeSnapshotPath)) {
            fs.unlinkSync(enzymeSnapshotPath);
            testAnalysisLogger.info(`Deleted enzyme adapter snapshot: ${enzymeSnapshotPath}`);
        }
        
        // Check for RTL snapshot in __snapshots__ directory
        const rtlSnapshotDir = path.join(rtlDir, '__snapshots__');
        const rtlSnapshotPath = path.join(rtlSnapshotDir, `${rtlFile}.snap`);
        if (fs.existsSync(rtlSnapshotPath)) {
            fs.unlinkSync(rtlSnapshotPath);
            testAnalysisLogger.info(`Deleted RTL converted snapshot: ${rtlSnapshotPath}`);
        }
    } catch (error) {
        testAnalysisLogger.error(`Error cleaning up snapshots: ${error}`);
    }
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
 * Analyze type check logs for errors
 * @param typeCheckLogs
 * @returns
 */
export const analyseTypeCheckLogs = (typeCheckLogs: string): boolean => {
    testAnalysisLogger.verbose('Start: Analyze type check logs');
    // Find errors in logs
    if (
        typeCheckLogs.includes('error')
    ) {
        testAnalysisLogger.verbose('Done: Analyze type check logs');
        return false;
    } else {
        testAnalysisLogger.verbose('Done: Analyze type check logs');
        return true;
    }
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
