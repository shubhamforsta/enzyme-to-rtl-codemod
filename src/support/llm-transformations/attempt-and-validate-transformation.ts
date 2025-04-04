import { Config } from '../config/config';
import { extractCodeContentToFile } from '../code-extractor/extract-code';
import { IndividualTestResult, runTestAndAnalyze } from '../enzyme-helper/run-test-analysis';
import { LLMCallFunction } from '../workflows/convert-test-files';
import { getFunctions } from './utils/getFunctions';
import get from 'lodash/get';

const failedTestsTryAgainUserMessage = {
    role: 'user',
    content: `The React Testing Library code converted from Enzyme tests is failing. 
    Please carefully analyze the failures by looking at the evaluateAndRun function results.
    Pay special attention to:
    1. Error messages that indicate missing elements or incorrect queries
    2. Assertion failures that suggest incorrect test logic
    3. Syntax errors or runtime exceptions
    4. Async testing issues that might require waitFor or findBy queries
    
    Fix all identified issues and call evaluateAndRun function with corrected version that passes all tests. Remember to maintain the same test structure and number of test cases while fixing the issues.`
};

const failedToCallFunctionUserMessage = {
    role: 'user',
    content: `You must respond by calling the evaluateAndRun function with your complete converted test code. 
    Do not provide explanations, analysis, or any other text outside of the function call.
    The evaluateAndRun function is the only way to submit your converted code for validation.
    Please try again and ensure you're calling the evaluateAndRun function with the complete test file.`
};

export const attemptAndValidateTransformation = async ({
    config,
    llmCallFunction,
    initialPrompt,
}: {
    config: Config,
    llmCallFunction: LLMCallFunction,
    initialPrompt: string,
}) => {
    let attemptCounter = 0;
    const messages: any[] = [{ role: 'system', content: initialPrompt }];
    const tools = getFunctions();
    let finalResult: IndividualTestResult | null = null;

    // Try up to 3 times to get a successful conversion
while (attemptCounter <= 3) {
        attemptCounter++;

        const { content, toolCalls } = await llmCallFunction({
            messages,
            tools,
        });

        const naturalLanguageResponse = content;
        const calledFunctionArgs = get(toolCalls, '[0].function.arguments');

        if(naturalLanguageResponse && !calledFunctionArgs) {
            // LLM failed to call the function - it provided a text response instead
            // Add a message instructing it to use the function call format
            messages.push(failedToCallFunctionUserMessage);
            continue;
        } else {
            const LLMResponse = JSON.parse(calledFunctionArgs).file;
            const calledFuntionId = get(toolCalls, '[0].id');

            // Extract generated code
            const convertedFilePath = extractCodeContentToFile({
                LLMresponse: LLMResponse,
                rtlConvertedFilePath: config.rtlConvertedFilePathAttmp1,
            });

            // Run the file and analyze the failures
            const { jestRunLogs, testPass, ...restSummary } = await runTestAndAnalyze({
                filePath: convertedFilePath,
                jestBinaryPath: config.jestBinaryPath,
                jestRunLogsPath: config.jestRunLogsFilePathAttmp1,
                rtlConvertedFilePath: config.rtlConvertedFilePathAttmp1,
                outputResultsPath: config.outputResultsPath,
                originalTestCaseNum: config.originalTestCaseNum,
                finalRun: false
            });

            // update the result to return
            finalResult = { testPass, ...restSummary };

            if(!testPass) {
                messages.push({
                    role: 'function',
                    id: calledFuntionId,
                    name: 'evaluateAndRun',
                    content: jestRunLogs,
                });
                messages.push(failedTestsTryAgainUserMessage);
            } else {
                break;
            }
        }
    }
    
    return finalResult;
};
