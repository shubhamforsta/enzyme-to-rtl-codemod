import { Config } from '../config/config';
import { extractCodeContentToFile } from '../code-extractor/extract-code';
import { runTestAndAnalyze } from '../enzyme-helper/run-test-analysis';
import { LLMCallFunction } from '../workflows/convert-test-files';

const tryAgainUserMessage = {
    role: 'user',
    content: `The RTL code converted from Enzyme tests is failing. 
    Please analyze the failures by looking at evaluateAndRun function results.
    Try fixing the issue and provide a corrected version that passes all tests.`
};

export const attemptAndValidateTransformation = async ({
    config,
    llmCallFunction,
    initialPrompt,
    filePath
}: {
    config: Config,
    llmCallFunction: LLMCallFunction,
    initialPrompt: string,
    filePath: string,
}) => {
    // Call the API with a custom LLM method
    const { content, toolCalls } = await llmCallFunction({
        messages: [{ role: 'system', content: initialPrompt }],
        tools: [{
            type: 'function',
            function: {
                name: 'evaluateAndRun',
                description: 'Evaluates and runs the converted test file. ',
                parameters: {
                    type: 'object',
                    properties: {
                        file: {
                            type: 'string',
                            description: 'React testing Library converted code/file. it should run with jest without manual changes',
                        },
                    },
                    required: ['file'],
                },
            },
        }],
    });

    const LLMresponseAttmp1 = JSON.parse(toolCalls[0].function.arguments).file;

    // Extract generated code
    const convertedFilePath = extractCodeContentToFile({
        LLMresponse: LLMresponseAttmp1,
        rtlConvertedFilePath: config.rtlConvertedFilePathAttmp1,
    });

    // Run the file and analyze the failures
    const { jestRunLogs, ...attemptResult } = await runTestAndAnalyze({
        filePath: convertedFilePath,
        jestBinaryPath: config.jestBinaryPath,
        jestRunLogsPath: config.jestRunLogsFilePathAttmp1,
        rtlConvertedFilePath: config.rtlConvertedFilePathAttmp1,
        outputResultsPath: config.outputResultsPath,
        originalTestCaseNum: config.originalTestCaseNum,
        finalRun: false
    });

    return attemptResult;
};
