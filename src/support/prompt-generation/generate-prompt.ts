import fs from 'fs';
import { createCustomLogger } from '../logger/logger';

export const promptLogger = createCustomLogger('Prompt');

/**
 * Generate a prompt for an LLM to assist in converting Enzyme test cases to React Testing Library.
 *
 * This function generates a detailed prompt that includes context, instructions,
 * test case code, and rendered component DOM for an LLM to perform code conversion.
 *
 * @param {Object} params - The parameters for the function.
 * @param {string} params.filePath - The path to the Enzyme test file.
 * @param {string} params.renderedCompCode - The rendered component DOM tree code.
 * @param {number} params.originalTestCaseNum - The number of test cases in the original file.
 * @param {string[]} [params.extendPrompt] - Optional user-provided additional instructions for the prompt.
 * @returns {string} The generated prompt to be sent to the LLM.
 */
export const generateInitialPrompt = ({
    filePath,
    renderedCompCode,
    originalTestCaseNum,
    extendPrompt,
}: {
    filePath: string;
    renderedCompCode: string;
    originalTestCaseNum: number;
    extendPrompt?: string[];
}): string => {

    // Get number of test cases
    let numTestCasesString = '';
    if (originalTestCaseNum > 0) {
        numTestCasesString = `In the original file there are ${originalTestCaseNum.toString()} test cases.`;
    } else {
        promptLogger.warn(`No test cases have been found in ${filePath}`);
    }

    const contextSetting = `I need assistance converting an Enzyme test case to the React Testing Library framework.
	I will provide you with the Enzyme test file code inside <enzyme_test_code></enzyme_test_code> tags.
	The rendered component DOM tree for each test case will be provided in <component></component> tags with this structure for one or more test cases "<test_case_title></test_case_title> and <dom_tree></dom_tree>"

	Enzyme and React Testing Library are both testing utilities for React, but they have different philosophies:
	- Enzyme focuses on implementation details and provides methods to directly manipulate component instances
	- React Testing Library focuses on user interactions and accessibility, encouraging tests that resemble how users interact with components

	This conversion requires careful mapping of Enzyme patterns to React Testing Library equivalents.`;

    const mainRequest = `\nPlease perform the following tasks:
	1. Transform the Enzyme test file wrapped in <enzyme_test_code></enzyme_test_code> tags into a React Testing Library test file.
	2. Convert all test cases and ensure the same number of tests in the file. ${numTestCasesString}
	3. Replace Enzyme methods with the equivalent React Testing Library methods.
	4. Update Enzyme imports to React Testing Library imports.
	5. Adjust Jest matchers for React Testing Library.
	6. Make sure import '@testing-library/jest-dom'; is present if not add it.
	7. If any other components are used under find or other query methods, those queries need to be updated with what is available in DOM tree. check how the component rendered in enzyme under <component></component> tags.

    CONVERSION APPROACH:
    - You will have multiple attempts to convert this file. If tests fail in the first attempt, you'll get error messages and can fix your solution.
    - **First attempt the conversion using only the information provided in the test file and DOM tree - DO NOT request component files for the initial conversion.**
    - **Make sure same testing logic is preserved. snapshot tests should be snapshot tests, user interactions should be user interactions, query based tests should be query based tests.**
	- *Do not modify anything else, unless it is required for the conversion.*
	- *Preserve all abstracted functions as they are and use them in the converted file.*
	- *Maintain the original organization and naming of describe and it blocks.*
	- *Ensure that all conditions are met. The converted file should be runnable by Jest without any manual changes.*`;

    // const additionalRequest = `\nOther instructions section, use them when applicable:
	// 1. Prioritize queries in the following order getByRole, getByPlaceholderText, getByText, getByDisplayValue, getByAltText, getByTitle, then getByTestId.
	// 2. ${getByTestIdAttribute} attribute is configured to be used with "screen.getByTestId" queries.
	// 3. For user simulations use userEvent and import it with "import userEvent from '@testing-library/user-event';"
	// 4. Use query* variants only for non-existence checks: Example "expect(screen.query*('example')).not.toBeInTheDocument();"
	// 5. Ensure all text/strings are converted to lowercase regex expression. Example: screen.getByText(/your text here/i), screen.getByRole('button', {name: /your text here/i}).
	// 6. When asserting that a DOM renders nothing, replace isEmptyRender()).toBe(true) with toBeEmptyDOMElement() by wrapping the component into a container. Example: expect(container).toBeEmptyDOMElement();.`;

    const availableTools = `\nAvailable tools:
    1. evaluateAndRun - Use this function to submit your converted test file for validation. Each evaluateAndRun call counts as one attempt.
       
       IMPORTANT NOTE ABOUT IMPORTS: You can use absolute imports in your submitted code. Our system will automatically convert absolute imports to appropriate relative imports when saving the file. This makes it easier for you to reuse import paths from example files without having to calculate relative paths.
    
    2. requestForFile - Use this ONLY when tests are failing and you need to understand how components, utilities or other files work to fix the conversion.
       Only request files when absolutely necessary to resolve failing tests, not for initial conversion.
       Using requestForFile does NOT count as an attempt - only evaluateAndRun calls count toward your attempt limit.
       
       IMPORTANT NOTE ABOUT FILE REQUESTS:
       - If a file doesn't exist, do NOT keep requesting it, assume the file doesn't exist and work around it.
       - Focus on making tests pass with the available information. Sometimes you can infer the component structure from the test itself.
       - Prefer to solve problems without requesting many files, especially when the test failures are clear.
       
       IMPORTANT NOTE ABOUT IMPORTS: The file content you receive will have all relative imports converted to absolute imports for easier reference. You can directly copy these import paths into your code if needed.
       
       You can request files in two ways:
       
       A) For files referenced by relative imports:
       - path: The relative import path exactly as it appears in the import statement (e.g., "../components/MyComponent")
       - currentFilePath: The absolute path of the file where this import appears
       
       B) For files mentioned in error logs with absolute paths:
       - absolutePath: The complete absolute path to the file (e.g., "/Users/user/project/src/components/MyComponent.tsx")
       
       Note: When you receive a file, it will include a comment at the top with its absolute path.
       If you need to request more files imported in that file, use the absolute path from the comment as the currentFilePath.
       
    3. requestForReferenceTests - Use this to find existing React Testing Library tests in the codebase that can serve as reference examples.
       This is helpful if you're unsure about test patterns, conventions, or specific RTL usage in this codebase.
       This tool will search for RTL tests in nearby directories and return up to 3 examples.
       
       IMPORTANT NOTE ABOUT IMPORTS: The reference test examples you receive will have all relative imports converted to absolute imports for easier reference. You can directly copy these import paths into your code if needed.
       
       Parameters:
       - currentTestPath: The absolute path of the current test file being converted (provided at the beginning of this conversation)
       - searchDepth: (Optional) How many directory levels to search (1 = same directory, 2 = parent directory, etc.)
       - keywords: (Optional) An array of specific RTL features you're interested in seeing examples of (e.g., ["userEvent", "waitFor"])
       
       Using requestForReferenceTests does NOT count as an attempt.
       
    4. updateComponent - Use this to update a component file to add testing-specific attributes (like data-testid).
       ONLY use this when it's absolutely necessary and RTL conversion cannot be done without modifying the component.
       
       IMPORTANT NOTE ABOUT COMPONENT UPDATES:
       - This should be used as a last resort when all other approaches have failed
       - Make MINIMAL changes - only add test-specific attributes like data-testid
       - DO NOT modify component logic, functionality, or styling
       - Any changes made will affect the actual component files in the codebase
       - Provide a clear explanation of why the change is necessary
       
       You can update components in two ways:
       
       A) For components referenced by relative imports:
       - path: The relative import path exactly as it appears in the import statement (e.g., "../components/MyComponent")
       - currentFilePath: The absolute path of the file where this import appears
       - newContent: The updated component code with test attributes added
       - explanation: Brief explanation of why this change is necessary and what was changed
       
       B) For components referenced by absolute paths:
       - absolutePath: The complete absolute path to the component (e.g., "/Users/user/project/src/components/MyComponent.tsx")
       - newContent: The updated component code with test attributes added
       - explanation: Brief explanation of why this change is necessary and what was changed
       
       Using updateComponent does NOT count as an attempt.`;

    // User additions to the prompt:
    const extendedPromptSection =
        extendPrompt && extendPrompt.length > 0
            ? '\nAdditional user instructions:\n' +
              extendPrompt
                  .filter((item) => item.trim() !== '')
                  .map((item, index) => `${index + 1}. ${item}`)
                  .join('\n')
            : '';

    const conclusion = `\nMOST IMPORTANT :: Please call evaluateAndRun function and pass the converted test file. Only Respond with the function call and nothing else, no natural response only function call.
    
If your conversion doesn't pass all tests in the first attempt, you'll have multiple chances to fix it. We'll provide test failure details to help you improve your solution with each attempt.

Important: Only evaluateAndRun calls count as attempts. You can use requestForFile as needed to gather information without using up your attempt count.

In final attempt, you have to provide the best conversion possible even if some tests might still fail.`;

    // Test file code prompt
    const testFileCode = fs.readFileSync(filePath, 'utf-8');
    const testCaseCodePrompt = `\nEnzyme test case code: <enzyme_test_code>${testFileCode}</enzyme_test_code>`;

    // Rendered component prompt
    const renderedCompCodePrompt = `\nRendered component DOM tree: <component>${renderedCompCode}</component>`;

    const finalPrompt =
        contextSetting +
        mainRequest +
        availableTools +
        extendedPromptSection +
        conclusion +
        testCaseCodePrompt +
        renderedCompCodePrompt;

    return finalPrompt;
};
