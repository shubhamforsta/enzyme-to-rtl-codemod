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
    return attemptsRemaining > 1 
        ? `You have ${attemptsRemaining} attempts remaining to fix these issues.` 
        : `THIS IS YOUR FINAL ATTEMPT! Please provide your best conversion even if some tests might still fail.`
};

const failedTestsTryAgainUserMessage = (attemptCounter: number, attemptsRemaining: number, unusedFunctions: string[], testPass: boolean | null, typeCheckPass: boolean | null, disabledUpdateComponent: boolean) => {
    // If we're past attempt #2 and LLM hasn't used the helper functions, force them to use them
    if (attemptCounter > 2 && unusedFunctions.length > 0) {
        return {
            role: 'user',
            content: `The React Testing Library code converted from Enzyme tests is still failing.
                
                IMPORTANT: You need to better understand the project before making more attempts.
                
                REQUIRED ACTIONS:
                ${unusedFunctions.includes('requestForReferenceTests') ? '- Use requestForReferenceTests function to get familiar with the project\'s test setup and patterns.' : ''}
                ${unusedFunctions.includes('requestForFile') ? '- Use requestForFile function to examine any component or file that might help you understand the failing tests.' : ''}
                
                Do NOT attempt to fix the code yet. First, gather information using these functions to understand the testing patterns.
                
                After using these helper functions, you'll receive a new opportunity to fix the tests.
                
                ${remainingAttemptsMessage(attemptsRemaining)}`
        };
    }
    
    return {
        role: 'user',
        content: `The React Testing Library code converted from Enzyme tests is failing. 
            carefully analyze the error messages to identify specific issues:
            
            SUGGESTED ACTION STEPS:
            1. **IMPORTANT** every project has its own test setups and patterns, consider using your ONE requestForReferenceTests function call to get familiar with the project's test setup and patterns.
            2. You can try adding screen.debug() to one of the tests and submit using evaluateAndRun function, the results will show you the DOM tree and help you identify the issue. 
            3. Focus on the SPECIFIC errors in the test failures - don't make broad changes
            4. Use requestForFile function to get understanding of any component or file that you think might help you fix the issue. You have limited number of requests for this function, use it wisely.
            ${disabledUpdateComponent ? '' : '5. As a last resort only, consider using your ONE updateComponent call to add a data-testid'} 
            
            ${typeCheckPass === null ? '' : typeCheckPass ? '': 'Type check is failing, fix the type errors as well. dont create new types but try to use requestForFile to get type info and fix the issue'}
            
            Fix all identified issues and call evaluateAndRun function with corrected version that passes all tests. Remember to maintain the same test structure and number of test cases while fixing the issues.
            
            ${remainingAttemptsMessage(attemptsRemaining)}`
    };
};

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
    logLevel,
    disableUpdateComponent = false
}: {
    config: Config,
    llmCallFunction: LLMCallFunction,
    initialPrompt: string,
    spinner: Ora,
    logLevel?: string,
    disableUpdateComponent?: boolean
}) => {
    let attemptCounter = 1;
    let previousSuccessRates: number[] = [];
    
    // Track function calls with counters
    const functionCallCounts = {
        requestForFile: 0,
        requestForReferenceTests: 0,
        ...(disableUpdateComponent ? {} : { updateComponent: 0 })
    };
    
    // Track which helper functions have been used
    const usedFunctions = {
        requestForFile: false,
        requestForReferenceTests: false,
        ...(disableUpdateComponent ? {} : { updateComponent: false })
    };
    
    // Set limits for function calls
    const FUNCTION_CALL_LIMITS = {
        requestForFile: 3,         // Max 3 file requests
        requestForReferenceTests: 1, // Max 1 reference test request
        ...(disableUpdateComponent ? {} : { updateComponent: 1 })         // Max 1 component update
    };
    
    // Add attempt info to the initial prompt
    const promptWithAttemptInfo = `${initialPrompt}\n\nYou will have up to ${MAX_ATTEMPTS} attempts to successfully convert this test file. Please provide the best conversion possible with each attempt. You are allowed a limited number of helper function calls: ${FUNCTION_CALL_LIMITS.requestForFile} file requests, ${FUNCTION_CALL_LIMITS.requestForReferenceTests} reference test request${disableUpdateComponent ? '' : `, and ${FUNCTION_CALL_LIMITS.updateComponent} component update`}.`;
    
    const messages: any[] = [{ role: 'system', content: promptWithAttemptInfo }];
    const tools = getFunctions(disableUpdateComponent).filter(tool => {
        if(attemptCounter > 2 && finalResult?.testPass === false && Object.values(usedFunctions).some(value => !value) && tool.function.name === 'evaluateAndRun') {
            return false;
        }
        return true;
    });
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
                // Check if we've reached the limit for file requests
                if (functionCallCounts.requestForFile >= FUNCTION_CALL_LIMITS.requestForFile) {
                    // Add response indicating limit reached
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        name: 'requestForFile',
                        content: JSON.stringify({ 
                            error: `You've reached the maximum limit (${FUNCTION_CALL_LIMITS.requestForFile}) of file requests. Please work with the information you already have to complete the conversion.` 
                        }),
                    });
                    continue;
                }
                
                functionCallCounts.requestForFile++;
                usedFunctions.requestForFile = true;
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
                // Check if we've reached the limit for reference test requests
                if (functionCallCounts.requestForReferenceTests >= FUNCTION_CALL_LIMITS.requestForReferenceTests) {
                    // Add response indicating limit reached
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        name: 'requestForReferenceTests',
                        content: JSON.stringify({ 
                            error: `You've reached the maximum limit (${FUNCTION_CALL_LIMITS.requestForReferenceTests}) of reference test requests. Please work with the examples you already have.` 
                        }),
                    });
                    continue;
                }
                
                functionCallCounts.requestForReferenceTests++;
                usedFunctions.requestForReferenceTests = true;
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
                // Check if updateComponent is disabled
                if (disableUpdateComponent) {
                    // Add response indicating feature is disabled
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        name: 'updateComponent',
                        content: JSON.stringify({ 
                            success: false,
                            message: 'The updateComponent function is disabled for this conversion. Please work with the existing component structure without modifications.' 
                        }),
                    });
                    continue;
                }
                
                // Check if we've reached the limit for component updates
                if ((functionCallCounts?.updateComponent ?? 0) >= (FUNCTION_CALL_LIMITS?.updateComponent ?? 0)) {
                    // Add response indicating limit reached
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        name: 'updateComponent',
                        content: JSON.stringify({ 
                            success: false,
                            message: `You've reached the maximum limit (${FUNCTION_CALL_LIMITS.updateComponent}) of component updates. Please work with the existing component structure.` 
                        }),
                    });
                    continue;
                }
                
                functionCallCounts.updateComponent = (functionCallCounts?.updateComponent ?? 0) + 1;
                usedFunctions.updateComponent = true;
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
                const { jestRunLogs, typeCheckLogs, testPass, typeCheckPass, ...restSummary } = await runTestAndAnalyze({
                    filePath: convertedFilePath,
                    jestBinaryPath: config.jestBinaryPath,
                    typeCheckBinaryPath: config.typeCheckBinaryPath,
                    jestRunLogsPath: config.jestRunLogsFilePath,
                    rtlConvertedFilePath: config.rtlConvertedFilePath,
                    outputResultsPath: config.outputResultsPath,
                    logLevel
                });
                spinner[testPass ? 'succeed' : 'fail'](`Detailed result: ${JSON.stringify(restSummary)}`);
                if(testPass && !typeCheckPass) {
                    spinner.fail('Test passed but type check failed');
                }

                // update the result to return
                finalResult = { testPass, typeCheckPass, ...restSummary };
                previousSuccessRates.push(finalResult?.successRate || 0);

                // Add the test run result to messages
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCallId,
                    name: 'evaluateAndRun',
                    content: JSON.stringify({
                        jestRunLogs,
                        typeCheckLogs,
                    }),
                });
            }
        }

        // After processing all tool calls, determine the next step
        if (hasEvaluateAndRunCall) {
            if (finalResult && finalResult.testPass && finalResult.typeCheckPass) {
                // If we had a successful evaluateAndRun, we're done
                break;
            } else {
                // Suggest unused functions first (before any potential break)
                const unusedFunctions = [];
                if (!usedFunctions.requestForFile) unusedFunctions.push('requestForFile');
                if (!usedFunctions.requestForReferenceTests) unusedFunctions.push('requestForReferenceTests');
                if (!usedFunctions.updateComponent && !disableUpdateComponent) unusedFunctions.push('updateComponent');
                
                // Check if we should break due to lack of improvement
                if(attemptCounter > 4) {
                    if(previousSuccessRates[previousSuccessRates.length - 1] === previousSuccessRates[previousSuccessRates.length - 2] && 
                       previousSuccessRates[previousSuccessRates.length - 2] === previousSuccessRates[previousSuccessRates.length - 3]) {
                        spinner.fail('No improvement in success rate after 4 attempts with identical results, breaking');
                        break;
                    }
                }
                
                messages.push(failedTestsTryAgainUserMessage(attemptCounter, attemptsRemaining, unusedFunctions, finalResult?.testPass || null, finalResult?.typeCheckPass || null, disableUpdateComponent));
            }
        } else if (toolCalls && toolCalls.length > 0) {
            // We had tool calls but no evaluateAndRun, continue to get the next response
            continue;
        }
    }
    
    spinner.text = 'Moving to next test file';
    return finalResult;
};
