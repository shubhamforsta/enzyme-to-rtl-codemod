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
 * @param {string} params.getByTestIdAttribute - The configured attribute for screen.getByTestId queries.
 * @param {string} params.renderedCompCode - The rendered component DOM tree code.
 * @param {number} params.originalTestCaseNum - The number of test cases in the original file.
 * @param {string[]} [params.extendPrompt] - Optional user-provided additional instructions for the prompt.
 * @returns {string} The generated prompt to be sent to the LLM.
 */
export const generateInitialPrompt = ({
    filePath,
    getByTestIdAttribute,
    renderedCompCode,
    originalTestCaseNum,
    extendPrompt,
}: {
    filePath: string;
    getByTestIdAttribute: string;
    renderedCompCode: string;
    originalTestCaseNum: number;
    extendPrompt?: string[];
}): string => {
    promptLogger.info('Start: generating prompt');

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

    Important:
	- Do not modify anything else, unless it is required for the conversion.
	- Preserve all abstracted functions as they are and use them in the converted file.
	- Maintain the original organization and naming of describe and it blocks.
	- Ensure that all conditions are met. The converted file should be runnable by Jest without any manual changes.`;

    // const additionalRequest = `\nOther instructions section, use them when applicable:
	// 1. Prioritize queries in the following order getByRole, getByPlaceholderText, getByText, getByDisplayValue, getByAltText, getByTitle, then getByTestId.
	// 2. ${getByTestIdAttribute} attribute is configured to be used with "screen.getByTestId" queries.
	// 3. For user simulations use userEvent and import it with "import userEvent from '@testing-library/user-event';"
	// 4. Use query* variants only for non-existence checks: Example "expect(screen.query*('example')).not.toBeInTheDocument();"
	// 5. Ensure all text/strings are converted to lowercase regex expression. Example: screen.getByText(/your text here/i), screen.getByRole('button', {name: /your text here/i}).
	// 6. When asserting that a DOM renders nothing, replace isEmptyRender()).toBe(true) with toBeEmptyDOMElement() by wrapping the component into a container. Example: expect(container).toBeEmptyDOMElement();.`;

    // // User additions to the prompt:
    // const extendedPromptSection =
    //     extendPrompt && extendPrompt.length > 0
    //         ? '\nAdditional user instructions:\n' +
    //           extendPrompt
    //               .filter((item) => item.trim() !== '')
    //               .map((item, index) => `${index + 1}. ${item}`)
    //               .join('\n')
    //         : '';

    const conclusion = `\nMOST IMPORTANT :: Please call evaluateAndRun function and pass the converted test file`;

    // Test file code prompt
    const testFileCode = fs.readFileSync(filePath, 'utf-8');
    const testCaseCodePrompt = `\nEnzyme test case code: <enzyme_test_code>${testFileCode}</enzyme_test_code>`;

    // Rendered component prompt
    const renderedCompCodePrompt = `\nRendered component DOM tree: <component>${renderedCompCode}</component>`;

    const finalPrompt =
        contextSetting +
        mainRequest +
        // additionalRequest +
        // extendedPromptSection +
        conclusion +
        testCaseCodePrompt +
        renderedCompCodePrompt;

    promptLogger.info('Done: generating prompt');
    return finalPrompt;
};
