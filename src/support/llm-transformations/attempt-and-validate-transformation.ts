import { Config } from '../config/config';
import { extractCodeContentToFile } from '../code-extractor/extract-code';
import { IndividualTestResult, runTestAndAnalyze } from '../enzyme-helper/run-test-analysis';
import { LLMCallFunction } from '../workflows/convert-test-files';
import { getFunctions } from './utils/getFunctions';
import { getFileFromRelativeImports, getComponentContent } from './utils/component-helper';
import get from 'lodash/get';
import { Ora } from 'ora';
import { createCustomLogger } from '../logger/logger';
import fs from 'fs';
import path from 'path';

const llmCallandTransformLogger = createCustomLogger('LLM Call and Transform');

// Maximum number of attempts allowed for conversion
export const MAX_ATTEMPTS = 6;

/**
 * Wraps the LLM call function with logging when in verbose mode
 */
const withLogging = (
    llmCallFunction: LLMCallFunction, 
    logLevel: string | undefined, 
    filePath: string
): LLMCallFunction => {
    // If not in verbose mode, return the original function
    if (logLevel !== 'verbose') {
        return llmCallFunction;
    }
    
    // Create logs directory if it doesn't exist
    const logsDir = path.join(process.cwd(), 'llm-logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    
    // Return a wrapped function that logs input/output
    return async (args) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeFileName = filePath.replace(/[^a-zA-Z0-9]/g, '_');
        
        // Log the request
        const requestLogPath = path.join(logsDir, `${safeFileName}_request_${timestamp}.json`);
        fs.writeFileSync(requestLogPath, JSON.stringify(args, null, 2), 'utf8');
        llmCallandTransformLogger.verbose(`Logged LLM request to ${requestLogPath}`);
        
        // Call the original function
        const response = await llmCallFunction(args);
        
        // Log the response
        const responseLogPath = path.join(logsDir, `${safeFileName}_response_${timestamp}.json`);
        fs.writeFileSync(responseLogPath, JSON.stringify(response, null, 2), 'utf8');
        llmCallandTransformLogger.verbose(`Logged LLM response to ${responseLogPath}`);
        
        return response;
    };
};

const failedTestsTryAgainUserMessage = (attemptsRemaining: number) => ({
    role: 'user',
    content: `The React Testing Library code converted from Enzyme tests is failing. 
    Please carefully analyze the failures by looking at the evaluateAndRun function results.
    Pay special attention to:
    1. Error messages that indicate missing elements or incorrect queries
    2. Assertion failures that suggest incorrect test logic
    3. Syntax errors or runtime exceptions
    4. Async testing issues that might require waitFor or findBy queries
    
    Only if you cannot diagnose the issue from the test failures alone, you may use requestForComponent to examine the actual component implementation.
    
    ${attemptsRemaining > 1 
        ? `You have ${attemptsRemaining} attempts remaining to fix these issues.` 
        : `THIS IS YOUR FINAL ATTEMPT! Please provide your best conversion even if some tests might still fail.`}
    
    Fix all identified issues and call evaluateAndRun function with corrected version that passes all tests. Remember to maintain the same test structure and number of test cases while fixing the issues.`
});

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
    spinner,
    logLevel
}: {
    config: Config,
    llmCallFunction: LLMCallFunction,
    initialPrompt: string,
    spinner: Ora,
    logLevel?: string
}) => {
    let attemptCounter = 0;
    // Add attempt info to the initial prompt
    const promptWithAttemptInfo = `${initialPrompt}\n\nYou will have up to ${MAX_ATTEMPTS} attempts to successfully convert this test file. Please provide the best conversion possible with each attempt.`;
    
    const messages: any[] = [{ role: 'system', content: promptWithAttemptInfo }];
    const tools = getFunctions();
    let finalResult: IndividualTestResult | null = null;
    
    // Wrap the LLM call function with logging if in verbose mode
    const loggingLLMCallFunction = withLogging(llmCallFunction, logLevel, config.rtlConvertedFilePath);

    // Try up to MAX_ATTEMPTS times to get a successful conversion
    while (attemptCounter < MAX_ATTEMPTS) {
        attemptCounter = attemptCounter + 1;
        const attemptsRemaining = MAX_ATTEMPTS - attemptCounter;
        
        llmCallandTransformLogger.verbose(`Attempt ${attemptCounter} of ${MAX_ATTEMPTS} - Calling LLM`);
        spinner.start(`Attempt ${attemptCounter} of ${MAX_ATTEMPTS} - Calling LLM`);
        
        const { message } = await loggingLLMCallFunction({
            messages,
            tools,
        });
        
        const { content, tool_calls: toolCalls } = message;
        spinner.succeed();

        const naturalLanguageResponse = content;
        
        // Check if LLM returned no tool calls, only natural language response
        if(naturalLanguageResponse && (!toolCalls || toolCalls.length === 0)) {
            // LLM failed to call the function - it provided a text response instead
            // Add a message instructing it to use the function call format
            llmCallandTransformLogger.verbose(`LLM Response : ${JSON.stringify(message)}`);
            spinner.fail('LLM failed to call the function');
            messages.push(message);
            messages.push(failedToCallFunctionUserMessage);
            continue;
        }

        // Process all tool calls in sequence
        let hasEvaluateAndRunCall = false;
        let evaluateAndRunResult = null;

        // Add the message with tool calls to our conversation history
        messages.push(message);

        // Process each tool call
        for (const toolCall of toolCalls) {
            const functionName = get(toolCall, 'function.name');
            const functionArgs = get(toolCall, 'function.arguments');
            const toolCallId = get(toolCall, 'id');
            
            if (functionName === 'requestForComponent') {
                llmCallandTransformLogger.verbose('LLM requested component content');
                spinner.start('Processing component request');
                
                try {
                    // Parse the arguments to get the component path and current file path
                    const args = JSON.parse(functionArgs);
                    const componentPath = args.path;
                    const currentFilePath = args.currentFilePath;
                    
                    llmCallandTransformLogger.verbose(`Requested component path: ${componentPath}`);
                    llmCallandTransformLogger.verbose(`From file: ${currentFilePath}`);
                    
                    // Get the absolute path to the component
                    // We use the currentFilePath as the base path
                    const absoluteComponentPath = getFileFromRelativeImports(componentPath, currentFilePath);
                    
                    // Get the component content
                    const componentContent = getComponentContent(absoluteComponentPath);
                    
                    // Add file path as a comment at the top of the content to help LLM with future requests
                    const contentWithPath = componentContent ? 
                        `// File: ${absoluteComponentPath}\n${componentContent}` : 
                        JSON.stringify({ error: 'Component file not found' });
                    
                    // Add the response to messages
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        name: 'requestForComponent',
                        content: contentWithPath,
                    });
                    
                    spinner.succeed('Component content retrieved');
                } catch (error) {
                    llmCallandTransformLogger.verbose(`Error processing component request: ${error}`);
                    spinner.fail('Failed to process component request');
                    
                    // Add error response to messages
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        name: 'requestForComponent',
                        content: JSON.stringify({ error: `Failed to process component request: ${error}` }),
                    });
                }
            } else if (functionName === 'evaluateAndRun') {
                hasEvaluateAndRunCall = true;
                
                let LLMResponse = '';
                try {
                    LLMResponse = JSON.parse(functionArgs).file;
                } catch (error) {
                    llmCallandTransformLogger.verbose(`LLM Response : ${JSON.stringify(message)}`);
                    llmCallandTransformLogger.verbose(`Error : ${error}`);
                    spinner.fail('Failed to parse LLM response, probably due to context overflow');
                    break;
                }

                // Extract generated code
                const convertedFilePath = extractCodeContentToFile({
                    LLMresponse: LLMResponse,
                    rtlConvertedFilePath: config.rtlConvertedFilePath,
                });

                // Run the file and analyze the failures
                spinner.start('Running converted file and analyzing failures');
                const { jestRunLogs, testPass, ...restSummary } = await runTestAndAnalyze({
                    filePath: convertedFilePath,
                    jestBinaryPath: config.jestBinaryPath,
                    jestRunLogsPath: config.jestRunLogsFilePath,
                    rtlConvertedFilePath: config.rtlConvertedFilePath,
                    outputResultsPath: config.outputResultsPath,
                    logLevel
                });
                spinner[testPass ? 'succeed' : 'fail'](`Detailed result: ${JSON.stringify(restSummary)}`);

                // update the result to return
                finalResult = { testPass, ...restSummary };

                // Add the test run result to messages
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCallId,
                    name: 'evaluateAndRun',
                    content: jestRunLogs,
                });
            }
        }

        // After processing all tool calls, determine the next step
        if (hasEvaluateAndRunCall) {
            if (finalResult && finalResult.testPass) {
                // If we had a successful evaluateAndRun, we're done
                break;
            } else {
                // Test failed, ask LLM to try again
                messages.push(failedTestsTryAgainUserMessage(attemptsRemaining));
            }
        } else if (toolCalls && toolCalls.length > 0) {
            // We had tool calls but no evaluateAndRun, continue to get the next response
            continue;
        }
    }
    
    spinner.text = 'Moving to next test file';
    return finalResult;
};
