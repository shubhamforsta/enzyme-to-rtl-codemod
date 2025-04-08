import { Config } from '../config/config';
import { extractCodeContentToFile } from '../code-extractor/extract-code';
import { IndividualTestResult, runTestAndAnalyze } from '../enzyme-helper/run-test-analysis';
import { LLMCallFunction } from '../workflows/convert-test-files';
import { getFunctions } from './utils/getFunctions';
import { getFileFromRelativeImports, getComponentContent, updateComponentContent } from './utils/component-helper';
import { findRtlReferenceTests } from '../file-discovery/find-rtl-reference-tests';
import { convertImportsToAbsolute } from '../ast-transformations/individual-transformations/convert-relative-imports';
import get from 'lodash/get';
import { Ora } from 'ora';
import { createCustomLogger } from '../logger/logger';
import fs from 'fs';
import path from 'path';
import jscodeshift from 'jscodeshift';

const llmCallandTransformLogger = createCustomLogger('LLM Call and Transform');

// Maximum number of attempts allowed for conversion
export const MAX_ATTEMPTS = 5;

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

const remainingAttemptsMessage = (attemptsRemaining: number) => {
    return {
        role: 'user',
        content: attemptsRemaining > 1 
            ? `You have ${attemptsRemaining} attempts remaining to fix these issues.` 
            : `THIS IS YOUR FINAL ATTEMPT! Please provide your best conversion even if some tests might still fail.`
    }
};

const failedTestsTryAgainUserMessage = () => ({
    role: 'user',
    content: `The React Testing Library code converted from Enzyme tests is failing. 
    Please carefully analyze the failures by looking at the evaluateAndRun function results.
    Pay special attention to:
    1. Error messages that indicate missing elements or incorrect queries
    2. Assertion failures that suggest incorrect test logic
    3. Syntax errors or runtime exceptions
    4. Async testing issues that might require waitFor or findBy queries
    
    Only if you cannot diagnose the issue from the test failures alone, you may use requestForFile to examine the actual implementation of any files mentioned in error messages or imports. Look for files with absolute paths in error messages or examine component files needed to understand the test.
    
    Fix all identified issues and call evaluateAndRun function with corrected version that passes all tests. Remember to maintain the same test structure and number of test cases while fixing the issues.`
});

const failedToCallFunctionUserMessage = {
    role: 'user',
    content: `You must respond by calling the evaluateAndRun function with your complete converted test code. 
    Do not provide explanations, analysis, or any other text outside of the function call.
    The evaluateAndRun function is the only way to submit your converted code for validation.
    Please try again and ensure you're calling the evaluateAndRun function with the complete test file.`
};

// Helper function to convert relative imports to absolute in file content
const processFileImports = (fileContent: string, filePath: string): string => {
    try {
        if (!fileContent) return fileContent;
        
        // Use jscodeshift to parse and transform the content
        const j = jscodeshift.withParser('tsx');
        const root = j(fileContent);
        
        // Convert relative imports to absolute
        convertImportsToAbsolute(j, root, filePath);
        
        // Return the transformed source
        return root.toSource();
    } catch (error) {
        llmCallandTransformLogger.verbose(`Error processing imports in file: ${error}`);
        // Return original content if transformation fails
        return fileContent;
    }
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
    let attemptCounter = 1;
    let previousSuccessRates: number[] = [];
    // Add attempt info to the initial prompt
    const promptWithAttemptInfo = `${initialPrompt}\n\nYou will have up to ${MAX_ATTEMPTS} attempts to successfully convert this test file. Please provide the best conversion possible with each attempt. Note: Using requestForComponent to gather information does not count as an attempt.`;
    
    const messages: any[] = [{ role: 'system', content: promptWithAttemptInfo }];
    const tools = getFunctions();
    let finalResult: IndividualTestResult | null = null;
    
    // Wrap the LLM call function with logging if in verbose mode
    const loggingLLMCallFunction = withLogging(llmCallFunction, logLevel, config.rtlConvertedFilePath);

    // Try up to MAX_ATTEMPTS times to get a successful conversion
    while (attemptCounter <= MAX_ATTEMPTS) {
        const attemptsRemaining = MAX_ATTEMPTS - attemptCounter;
        
        llmCallandTransformLogger.verbose(`Attempt ${attemptCounter} of ${MAX_ATTEMPTS} - Calling LLM`);
        spinner.start(`Attempt ${attemptCounter} of ${MAX_ATTEMPTS} - Calling LLM`);
        let response;

        try {
            response = await loggingLLMCallFunction({
                messages,
                tools,
            });
        } catch (error) {
            spinner.fail(`Failed to call LLM: ${error}`);
            break;
        }
        
        const message = response.message;
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

        // Add the message with tool calls to our conversation history
        messages.push(message);

        // Process each tool call
        for (const toolCall of toolCalls) {
            const functionName = get(toolCall, 'function.name');
            const functionArgs = get(toolCall, 'function.arguments');
            const toolCallId = get(toolCall, 'id');
            
            if (functionName === 'requestForFile') {
                llmCallandTransformLogger.verbose('LLM requested file content');
                spinner.start('Processing file request');
                
                try {
                    // Parse the arguments
                    const args = JSON.parse(functionArgs);
                    let absoluteFilePath = '';
                    
                    // If absolutePath is provided, use it directly
                    if (args.absolutePath) {
                        absoluteFilePath = args.absolutePath;
                        llmCallandTransformLogger.verbose(`Requested absolute file path: ${absoluteFilePath}`);
                    } else {
                        // Otherwise resolve from relative path and current file
                        const componentPath = args.path;
                        const currentFilePath = args.currentFilePath;
                        
                        llmCallandTransformLogger.verbose(`Requested relative path: ${componentPath}`);
                        llmCallandTransformLogger.verbose(`From file: ${currentFilePath}`);
                        
                        // Get the absolute path to the file
                        absoluteFilePath = getFileFromRelativeImports(componentPath, currentFilePath);
                    }
                    
                    // Get the file content
                    const fileContent = getComponentContent(absoluteFilePath);
                    
                    // Process imports in the file content to make them absolute
                    const processedContent = fileContent ? 
                        processFileImports(fileContent, absoluteFilePath) : 
                        null;
                    
                    // Add file path as a comment at the top of the content to help LLM with future requests
                    const contentWithPath = processedContent ? 
                        `// File: ${absoluteFilePath}\n${processedContent}` : 
                        JSON.stringify({ error: 'File not found. Please try solving the tests without seeing this file content. Do not request for this file again.' });
                    
                    // Add the response to messages
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        name: 'requestForFile',
                        content: contentWithPath,
                    });
                    
                    spinner.succeed('File content retrieved');
                } catch (error) {
                    llmCallandTransformLogger.verbose(`Error processing file request: ${error}`);
                    spinner.fail('Failed to process file request');
                    
                    // Add error response to messages
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        name: 'requestForFile',
                        content: JSON.stringify({ error: `Failed to process file request: ${error}` }),
                    });
                }
            } else if (functionName === 'requestForReferenceTests') {
                llmCallandTransformLogger.verbose('LLM requested reference tests');
                spinner.start('Searching for RTL reference tests');
                
                try {
                    // Parse the arguments
                    const args = JSON.parse(functionArgs);
                    const currentTestPath = args.currentTestPath;
                    const searchDepth = args.searchDepth || 2;
                    const keywords = args.keywords || [];
                    
                    llmCallandTransformLogger.verbose(`Searching for RTL tests near: ${currentTestPath}`);
                    llmCallandTransformLogger.verbose(`Search depth: ${searchDepth}`);
                    
                    // Find RTL reference tests - pass the logger
                    const referenceTests = findRtlReferenceTests(
                        currentTestPath, 
                        searchDepth, 
                        keywords
                    );
                    
                    // Format the response
                    let response = '';
                    if (referenceTests.length === 0) {
                        response = JSON.stringify({ error: 'No RTL reference tests found in nearby directories' });
                    } else {
                        response = `Found ${referenceTests.length} RTL reference test(s):\n\n`;
                        
                        referenceTests.forEach((test, index) => {
                            // Process imports in the reference test to make them absolute
                            const processedContent = processFileImports(test.content, test.path);
                            
                            response += `--- Reference Test ${index + 1}: ${test.path} ---\n\n`;
                            response += processedContent;
                            response += '\n\n';
                        });
                    }
                    
                    // Add the response to messages
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        name: 'requestForReferenceTests',
                        content: response,
                    });
                    
                    spinner.succeed(`Found ${referenceTests.length} RTL reference tests`);
                } catch (error) {
                    llmCallandTransformLogger.verbose(`Error processing reference tests request: ${error}`);
                    spinner.fail('Failed to process reference tests request');
                    
                    // Add error response to messages
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        name: 'requestForReferenceTests',
                        content: JSON.stringify({ error: `Failed to process reference tests request: ${error}` }),
                    });
                }
            } else if (functionName === 'updateComponent') {
                llmCallandTransformLogger.verbose('LLM requested component update');
                spinner.start('Processing component update request');
                
                try {
                    // Parse the arguments
                    const args = JSON.parse(functionArgs);
                    let absoluteFilePath = '';
                    
                    // If absolutePath is provided, use it directly
                    if (args.absolutePath) {
                        absoluteFilePath = args.absolutePath;
                        llmCallandTransformLogger.verbose(`Requested component update for absolute path: ${absoluteFilePath}`);
                    } else if (args.path && args.currentFilePath) {
                        // Otherwise resolve from relative path and current file
                        const componentPath = args.path;
                        const currentFilePath = args.currentFilePath;
                        
                        llmCallandTransformLogger.verbose(`Requested component update for relative path: ${componentPath}`);
                        llmCallandTransformLogger.verbose(`From file: ${currentFilePath}`);
                        
                        // Get the absolute path to the component
                        absoluteFilePath = getFileFromRelativeImports(componentPath, currentFilePath);
                    } else {
                        throw new Error('Either absolutePath or both path and currentFilePath must be provided');
                    }
                    
                    // Update the component file
                    const newContent = args.newContent;
                    const explanation = args.explanation;
                    
                    if (!newContent) {
                        throw new Error('newContent must be provided');
                    }
                    
                    if (!explanation) {
                        throw new Error('explanation must be provided');
                    }
                    
                    llmCallandTransformLogger.verbose(`Updating component file at: ${absoluteFilePath}`);
                    llmCallandTransformLogger.verbose(`Explanation for changes: ${explanation}`);
                    
                    // Update the component file
                    const updateResult = updateComponentContent(absoluteFilePath, newContent);
                    
                    // Add the response to messages
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        name: 'updateComponent',
                        content: JSON.stringify(updateResult),
                    });
                    
                    if (updateResult.success) {
                        spinner.succeed('Component file updated successfully');
                    } else {
                        spinner.fail(`Failed to update component file: ${updateResult.message}`);
                    }
                } catch (error) {
                    llmCallandTransformLogger.verbose(`Error updating component file: ${error}`);
                    spinner.fail('Failed to update component file');
                    
                    // Add error response to messages
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        name: 'updateComponent',
                        content: JSON.stringify({ 
                            success: false, 
                            message: `Failed to update component file: ${error instanceof Error ? error.message : String(error)}` 
                        }),
                    });
                }
            } else if (functionName === 'evaluateAndRun') {
                hasEvaluateAndRunCall = true;
                attemptCounter = attemptCounter + 1;
                
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
                previousSuccessRates.push(finalResult?.successRate || 0);

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
                // If repeated attempts are not improving the success rate, break
                if(attemptCounter > 3) {
                    if(previousSuccessRates[previousSuccessRates.length - 1] === previousSuccessRates[previousSuccessRates.length - 2] && 
                       previousSuccessRates[previousSuccessRates.length - 2] === previousSuccessRates[previousSuccessRates.length - 3]) {
                        spinner.fail('No improvement in success rate after 3 attempts with identical results, breaking');
                        break;
                    }
                };
                // Else, ask LLM to try again
                messages.push(failedTestsTryAgainUserMessage());
                messages.push(remainingAttemptsMessage(attemptsRemaining));
            }
        } else if (toolCalls && toolCalls.length > 0) {
            // We had tool calls but no evaluateAndRun, continue to get the next response
            continue;
        }
    }
    
    spinner.text = 'Moving to next test file';
    return finalResult;
};
