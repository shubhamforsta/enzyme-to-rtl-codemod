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
	The rendered component DOM tree for each test case will be provided in <component></component> tags with this structure for one or more test cases "<test_case_title></test_case_title> and <dom_tree></dom_tree>"`;

    const mainRequest = `\nPlease perform the following tasks:
	1. Transform the Enzyme test file into a React Testing Library test file wrapped in <enzyme_test_code></enzyme_test_code> tags.
	2. Convert all test cases and ensure the same number of tests in the file. ${numTestCasesString}
	3. Replace Enzyme methods with the equivalent React Testing Library methods.
	4. Update Enzyme imports to React Testing Library imports.
	5. Adjust Jest matchers for React Testing Library.
	6. Return the entire file with all converted test cases, enclosed in <rtl_test_code></rtl_test_code> tags.
	7. Do not modify anything else, until unless it is required.
	8. Preserve all abstracted functions as they are and use them in the converted file.
	9. Maintain the original organization and naming of describe and it blocks.
	Ensure that all conditions are met. The converted file should be runnable by Jest without any manual changes.`;

    const additionalRequest = `\nOther instructions section, use them when applicable:
	1. Prioritize queries in the following order getByRole, getByPlaceholderText, getByText, getByDisplayValue, getByAltText, getByTitle, then getByTestId.
	2. ${getByTestIdAttribute} attribute is configured to be used with "screen.getByTestId" queries.
	3. For user simulations use userEvent and import it with "import userEvent from '@testing-library/user-event';"
	4. Use query* variants only for non-existence checks: Example "expect(screen.query*('example')).not.toBeInTheDocument();"
	5. Ensure all text/strings are converted to lowercase regex expression. Example: screen.getByText(/your text here/i), screen.getByRole('button', {name: /your text here/i}).
	6. When asserting that a DOM renders nothing, replace isEmptyRender()).toBe(true) with toBeEmptyDOMElement() by wrapping the component into a container. Example: expect(container).toBeEmptyDOMElement();.`;

    // User additions to the prompt:
    const extendedPromptSection =
        extendPrompt && extendPrompt.length > 0
            ? '\nAdditional user instructions:\n' +
              extendPrompt
                  .filter((item) => item.trim() !== '')
                  .map((item, index) => `${index + 1}. ${item}`)
                  .join('\n')
            : '';

    const conclusion = `\nNow, please evaluate your output and make sure your converted code is between <rtl_test_code></rtl_test_code> tags.
	If there are any deviations from the specified conditions, list them explicitly.
	If the output adheres to all conditions and uses instructions section, you can simply state "The output meets all specified conditions."`;

    // Test file code prompt
    const testFileCode = fs.readFileSync(filePath, 'utf-8');
    const testCaseCodePrompt = `\nEnzyme test case code: <enzyme_test_code>${testFileCode}</enzyme_test_code>`;

    // Rendered component prompt
    const renderedCompCodePrompt = `\nRendered component DOM tree: <component>${renderedCompCode}</component>`;

    const finalPrompt =
        contextSetting +
        mainRequest +
        additionalRequest +
        extendedPromptSection +
        conclusion +
        testCaseCodePrompt +
        renderedCompCodePrompt;

    promptLogger.info('Done: generating prompt');
    return finalPrompt;
};

/**
 * Generate a feedback prompt for an LLM to assist in fixing React unit tests using React Testing Library.
 *
 * This function generates a detailed feedback prompt that includes test case code, Jest run logs,
 * and rendered component DOM to help the LLM fix failing test cases.
 *
 * @param {Object} params - The parameters for the function.
 * @param {string} params.rtlConvertedFilePathAttmpt1 - The path to the React Testing Library test file (attempt 1).
 * @param {string} params.getByTestIdAttribute - The configured attribute for screen.getByTestId queries.
 * @param {string} params.jestRunLogsFilePathAttmp1 - The path to the Jest test run logs (attempt 1).
 * @param {string} params.renderedCompCode - The rendered component DOM tree code.
 * @param {number} params.originalTestCaseNum - The number of test cases in the original file.
 * @param {string[]} [params.extendPrompt] - Optional user-provided additional instructions for the prompt.
 * @returns {string} The generated feedback prompt to be sent to the LLM.
 */
export const generateFeedbackPrompt = ({
    rtlConvertedFilePathAttmpt1,
    getByTestIdAttribute,
    jestRunLogsFilePathAttmp1,
    renderedCompCode,
    originalTestCaseNum,
    extendPrompt,
}: {
    rtlConvertedFilePathAttmpt1: string;
    getByTestIdAttribute: string;
    jestRunLogsFilePathAttmp1: string;
    renderedCompCode: string;
    originalTestCaseNum: number;
    extendPrompt?: string[];
}): string => {
    promptLogger.info('Start: generating feedback prompt');

    // Get number of test cases
    let numTestCasesString = '';
    if (originalTestCaseNum > 0) {
        numTestCasesString = `In the original file there are ${originalTestCaseNum.toString()} test cases.`;
    } else {
        promptLogger.warn(
            `No test cases have been found in ${rtlConvertedFilePathAttmpt1}`,
        );
    }

    const contextSetting = `I need assistance fixing a React unit test that uses React Testing Library.
    I will provide you with the test file code inside <rtl_test_code></rtl_test_code> tags.
    I will provide you with jest test run logs inside <jest_run_logs></jest_run_logs>.
    The rendered component DOM tree for each test case will be provided in <component></component> tags with this structure for one or more test cases "<test_case_title></test_case_title> and <dom_tree></dom_tree>"`;

    const mainRequest = `\nPlease perform the following tasks:
    1. Fix only failing test cases based on the <jest_run_logs>.
    2. The number of test cases must remain the same. ${numTestCasesString}
    3. Remove unused imports.
    4. Keep configured import and testIdAttribute setup.
    5. Fix any syntax errors.
    6. Return the entire file with all converted test cases, enclosed in <rtl_test_code></rtl_test_code> tags.
    Ensure that all conditions are met. The converted file should be runnable by Jest without any manual changes.`;

    const additionalRequest = `\nOther instructions section, use them when applicable:
	1. Prioritize queries in the following order getByRole, getByPlaceholderText, getByText, getByDisplayValue, getByAltText, getByTitle, then getByTestId.
	2. ${getByTestIdAttribute} attribute is configured to be used with "screen.getByTestId" queries.
	3. For user simulations use userEvent and import it with "import userEvent from '@testing-library/user-event';"
	4. Use query* variants only for non-existence checks: Example "expect(screen.query*('example')).not.toBeInTheDocument();"
	5. Ensure all text/strings are converted to lowercase regex expressions. Example: screen.getByText(/your text here/i), screen.getByRole('button', {name: /your text here/i}).
	6. When asserting that a DOM renders nothing, replace isEmptyRender()).toBe(true) with toBeEmptyDOMElement() by wrapping the component into a container. Example: expect(container).toBeEmptyDOMElement();`;

    // User additions to the prompt:
    const extendedPromptSection =
        extendPrompt && extendPrompt.length > 0
            ? '\nAdditional user instructions:\n' +
              extendPrompt
                  .filter((item) => item.trim() !== '')
                  .map((item, index) => `${index + 1}. ${item}`)
                  .join('\n')
            : '';

    const conclusion = `\nNow, please evaluate your output and make sure your converted code is between <rtl_test_code></rtl_test_code> tags.
	If there are any deviations from the specified conditions, list them explicitly.
	If the output adheres to all conditions and uses instructions section, you can simply state "The output meets all specified conditions."`;

    // Test case code prompt
    const testFileCode = fs.readFileSync(rtlConvertedFilePathAttmpt1, 'utf-8');
    const testFileCodePrompt = `\nReact Testing Library test file code: <code>${testFileCode}</code>`;

    // Jest run logs prompt
    const jestRunLogs = fs.readFileSync(jestRunLogsFilePathAttmp1, 'utf-8');
    const jestRunLogsPrompt = `\nJest test run logs: <jest_run_logs>${jestRunLogs}</jest_run_logs>`;

    // Rendered component prompt
    const renderedCompCodePrompt = `\nRendered component DOM tree: <component>${renderedCompCode}</component>`;

    const finalPrompt =
        contextSetting +
        mainRequest +
        additionalRequest +
        extendedPromptSection +
        conclusion +
        testFileCodePrompt +
        jestRunLogsPrompt +
        renderedCompCodePrompt;

    promptLogger.info('Done: generating feedback prompt');
    return finalPrompt;
};
