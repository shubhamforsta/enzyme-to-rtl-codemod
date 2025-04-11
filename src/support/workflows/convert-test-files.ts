import fs from 'fs';
import path from 'path';
import { initializeConfig, Config } from '../config/config';
import { getReactCompDom } from '../enzyme-helper/get-dom-enzyme';
import {
    generateInitialPrompt,
} from '../prompt-generation/generate-prompt';
import {
    IndividualTestResult,
    updateOriginalFileAndRunTests,
    cleanupSnapshots
} from '../enzyme-helper/run-test-analysis';
import {
    generateSummaryJson,
    SummaryJson,
} from './utils/generate-result-summary';
import { discoverTestFiles } from '../file-discovery/test-file-discovery';
import { attemptAndValidateTransformation, MAX_ATTEMPTS } from '../llm-transformations/attempt-and-validate-transformation';
import ora from 'ora';
import { getRelativePathFromAbsolutePath } from '../ast-transformations/individual-transformations/convert-relative-imports';

// Define the function type for LLM call
export type LLMCallFunction = (arg: { messages: any[], tools: any[] }) => Promise<{ 
    finish_reason: string, 
    message: { content: string, tool_calls: { id: string, type: string, function: { name: string, arguments: string } }[] },  
}>;

export interface TestResults {
    [filePath: string]: IndividualTestResult;
}

/**
 * Reads file content from a given absolute path
 * @param filePath - Absolute path to the file
 * @returns File content as string or null if file doesn't exist
 */
const readFileContent = (filePath: string): string | null => {
    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
        console.error(`Failed to read file: ${filePath}`, error);
        return null;
    }
};

/**
 * Converts test files and processes them using the specified parameters.
 *
 * This function accepts an array of test file paths and performs a series of operations
 * including setting up Jest environment, initializing configuration, and generating output results.
 * It utilizes a Large Language Model (LLM) for assisting in code transformations and analysis.
 * Results from the conversions, including test outcomes, are saved in the specified output directory.
 * The function supports feedback loops to refine transformations in case of initial failure.
 *
 * @param {Object} params - The parameters for the function.
 * @param {string[]} params.filePaths - The array of test file paths to be processed.
 * @param {string} [params.logLevel] - Optional log level to control verbosity of logs. 'info' or 'verbose'
 * @param {string} params.jestBinaryPath - Path to the Jest binary for running tests.
 * @param {string} params.testId - Optional identifier getByTestId(testId) queries.
 * @param {LLMCallFunction} params.llmCallFunction - Function for making LLM API calls to process the tests.
 * @param {string[]} [params.extendInitialPrompt] - Optional additional prompt instructions to include.
 * @param {string[]} [params.additionalReferenceFiles] - Optional array of absolute paths to reference files that might be needed for transformations.
 * @param {string[]} [params.skipFiles] - Optional array of file paths to skip.
 * @param {boolean} [params.onlyConvertFullyPassingTests] - Optional flag to only convert tests that are passing.
 * @param {boolean} [params.disableUpdateComponent] - Optional flag to disable the updateComponent functionality, preventing any modifications to source components.
 * @returns {Promise<SummaryJson>} A promise that resolves to the generated summary JSON object containing the results of the test conversions.
 */
export const convertTestFiles = async ({
    filePaths,
    logLevel,
    jestBinaryPath,
    testId = 'data-testid',
    llmCallFunction,
    extendInitialPrompt,
    additionalReferenceFiles = [],
    skipFiles = [],
    onlyConvertFullyPassingTests = false,
    disableUpdateComponent = false
}: {
    filePaths?: string[];
    logLevel?: string;
    jestBinaryPath: string;
    testId?: string;
    llmCallFunction: LLMCallFunction;
    extendInitialPrompt?: string[];
    additionalReferenceFiles?: string[];
    skipFiles?: string[];
    onlyConvertFullyPassingTests?: boolean;
    disableUpdateComponent?: boolean;
}): Promise<SummaryJson> => {
    // Initialize total results object to collect results
    const totalResults: TestResults = {};
    const spinner = ora({
        text: 'Starting conversion from Enzyme to RTL',
        color: 'blue',
    }).start();
    skipFiles = skipFiles.map(filePath => path.resolve(process.cwd(), filePath));

    // Initialize config
    let config = {} as Config;

    if (!filePaths || filePaths.length === 0) {
        const projectRoot = process.cwd();
        filePaths = await discoverTestFiles(projectRoot, spinner);
    } else {
        filePaths = filePaths.map(filePath => path.resolve(process.cwd(), filePath));
    }

    for (const filePath of filePaths) {
        if (skipFiles.includes(filePath)) {
            spinner.info(`Skipping file: ${filePath}`);
            continue;
        }

        try {
            // Initialize config
            config = initializeConfig({
                filePath,
                logLevel,
                jestBinaryPath,
                testId,
                spinner
            });
        } catch (error) {
            console.error(
                `Failed to initialize config for file: ${filePath}`,
                error,
            );
            continue;
        }

        // Need to look how enzyme tests return the dom. Assuming they will not be full DOM compared to RTL.
        // Get React Component DOM tree for each test case
        spinner.start(`Getting React Component DOM tree`);
        const reactCompDom = await getReactCompDom({
            filePath,
            enzymeImportsPresent: config.enzymeImportsPresent,
            filePathWithEnzymeAdapter: config.filePathWithEnzymeAdapter,
            collectedDomTreeFilePath: config.collectedDomTreeFilePath,
            enzymeMountAdapterFilePath: config.enzymeMountAdapterFilePath,
            jestBinaryPath: config.jestBinaryPath,
            reactVersion: config.reactVersion,
        });
        spinner.succeed();

        // Generate the prompt
        const initialPrompt = generateInitialPrompt({
            filePath,
            renderedCompCode: reactCompDom,
            originalTestCaseNum: config.originalTestCaseNum,
            extendPrompt: extendInitialPrompt,
            disableUpdateComponent
        });

        // Add test file absolute path to initialPrompt
        const testFilePath = path.resolve(process.cwd(), filePath);
        let promptWithFilePath = `${initialPrompt}\n\nThe absolute path of this test file is: ${testFilePath}`;
        
        // Process additional reference files
        if (additionalReferenceFiles.length > 0) {
            spinner.start('Processing additional reference files');
            let referenceFilesPrompt = '\n\nAdditional reference files that may be needed for import:';
            
            for (const referenceFilePath of additionalReferenceFiles) {
                const referenceFilePathResolved = path.resolve(process.cwd(), referenceFilePath);
                // Read file content
                const fileContent = readFileContent(referenceFilePathResolved);
                if (!fileContent) continue;
                
                // Calculate relative path from test file to reference file
                const relativePath = getRelativePathFromAbsolutePath(testFilePath, referenceFilePathResolved);
                
                // Format without extension for import statements
                const formattedRelativePath = relativePath.replace(/\.(ts|tsx|js|jsx)$/, '');
                
                // Add to prompt
                referenceFilesPrompt += `\n\nFile: ${path.basename(referenceFilePath)}`;
                referenceFilesPrompt += `\nRelative import path: ${formattedRelativePath}`;
                referenceFilesPrompt += `\nContent:\n\`\`\`typescript\n${fileContent}\n\`\`\``;
            }
            
            promptWithFilePath += referenceFilesPrompt;
            spinner.succeed('Added reference files to prompt');
        }

        const transformationResult = await attemptAndValidateTransformation({
            config,
            llmCallFunction,
            initialPrompt: promptWithFilePath,
            spinner,
            logLevel,
            disableUpdateComponent
        });

        if (!transformationResult) {
            spinner.fail(`Failed to transform test file after ${MAX_ATTEMPTS} attempts: ${filePath}`);
            // Add a failed result to totalResults
            const filePathClean = `${filePath.replace(/[<>:"/|?*.]+/g, '-')}`;
            totalResults[filePathClean] = {
                testPass: false,
                failedTests: 0,
                passedTests: 0,
                totalTests: 0,
                successRate: 0
            };
            continue;
        };

        if ((onlyConvertFullyPassingTests && transformationResult.testPass) || !onlyConvertFullyPassingTests) {
            spinner.start(`Updating original file and running tests`);
            updateOriginalFileAndRunTests({
                config,
                spinner,
                filePath
            });
            spinner.succeed();
        } else {
            spinner.fail(`Skipping file: ${filePath} because it is not passing`);
        }

        // Clean up any snapshots after processing each file
        cleanupSnapshots(config);

        // Store the result in the totalResults object
        const filePathClean = `${filePath.replace(/[<>:"/|?*.]+/g, '-')}`;
        totalResults[filePathClean] = transformationResult;
    }
    spinner.succeed('Test conversion completed');

    // Write summary to outputResultsPath
    const generatedSummary = generateSummaryJson(totalResults);
    const finalSummaryJson = JSON.stringify(generatedSummary, null, 2);
    fs.writeFileSync(config.jsonSummaryPath, finalSummaryJson, 'utf-8');

    return generatedSummary;
};