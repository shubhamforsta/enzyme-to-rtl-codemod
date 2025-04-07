import fs from 'fs';
import { initializeConfig, Config } from '../config/config';
import { getReactCompDom } from '../enzyme-helper/get-dom-enzyme';
import {
    generateInitialPrompt,
} from '../prompt-generation/generate-prompt';
import {
    IndividualTestResult,
} from '../enzyme-helper/run-test-analysis';
import {
    generateSummaryJson,
    SummaryJson,
} from './utils/generate-result-summary';
import { discoverTestFiles } from '../file-discovery/test-file-discovery';
import { attemptAndValidateTransformation } from '../llm-transformations/attempt-and-validate-transformation';
import ora from 'ora';

// Define the function type for LLM call
export type LLMCallFunction = (arg: { messages: any[], tools: any[] }) => Promise<{ 
    finish_reason: string, 
    message: { content: string, tool_calls: { id: string, type: string, function: { name: string, arguments: string } }[] },  
}>;

export interface TestResults {
    [filePath: string]: IndividualTestResult;
}

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
 * @returns {Promise<SummaryJson>} A promise that resolves to the generated summary JSON object containing the results of the test conversions.
 */
export const convertTestFiles = async ({
    filePaths,
    logLevel,
    jestBinaryPath,
    testId = 'data-testid',
    llmCallFunction,
    extendInitialPrompt,
}: {
    filePaths?: string[];
    logLevel?: string;
    jestBinaryPath: string;
    testId?: string;
    llmCallFunction: LLMCallFunction;
    extendInitialPrompt?: string[];
}): Promise<SummaryJson> => {
    // Initialize total results object to collect results
    const totalResults: TestResults = {};
    const spinner = ora({
        text: 'Starting conversion from Enzyme to RTL',
        color: 'blue',
    }).start();

    // Initialize config
    let config = {} as Config;

    if (!filePaths || filePaths.length === 0) {
        const projectRoot = process.cwd();
        filePaths = await discoverTestFiles(projectRoot, spinner);
    }

    for (const filePath of filePaths.slice(20, 40)) {
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
        });

        const transformationResult = await attemptAndValidateTransformation({
            config,
            llmCallFunction,
            initialPrompt,
            spinner,
            logLevel
        });

        if (!transformationResult) {
            throw new Error('Failed to transform test file');
        }

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
