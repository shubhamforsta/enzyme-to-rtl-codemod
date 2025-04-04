import { Config } from '../config/config';
import { extractCodeContentToFile } from '../code-extractor/extract-code';
import { IndividualTestResult, runTestAndAnalyze } from '../enzyme-helper/run-test-analysis';
import { LLMCallFunction } from '../workflows/convert-test-files';
import { getFunctions } from './utils/getFunctions';
import get from 'lodash/get';

const failedTestsTryAgainUserMessage = {
    role: 'user',
    content: `The RTL code converted from Enzyme tests is failing. 
    Please analyze the failures by looking at evaluateAndRun function results.
    Try fixing the issue and provide a corrected version that passes all tests.`
};

const failedToCallFunctionUserMessage = {
    role: 'user',
    content: `Only respond by calling function evaluateAndRun. please try again.`
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

    while (attemptCounter <= 3) {
        attemptCounter++;

        const { content, toolCalls } = await llmCallFunction({
            messages,
            tools,
        });

        const naturalLanguageResponse = content;
        const calledFunctionArgs = get(toolCalls, '[0].function.arguments');

        if(naturalLanguageResponse && !calledFunctionArgs) {
            // LLM failed to call the function
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
