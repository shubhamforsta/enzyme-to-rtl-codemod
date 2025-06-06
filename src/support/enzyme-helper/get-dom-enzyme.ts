import fs from 'fs';
import { runCommand } from '../shell-helper/shell-helper';
import { createCustomLogger } from '../logger/logger';
import jscodeshift from 'jscodeshift';
import { convertRelativeImports } from '../ast-transformations/individual-transformations/convert-relative-imports';

export const getDomEnzymeLogger = createCustomLogger('Get DOM Enzyme');

/**
 * Get React component DOM for test cases.
 *
 * This function collects the DOM tree of a React component using Enzyme
 * for rendering in test cases. It configures Enzyme adapters, overwrites
 * mount methods, converts relative imports to absolute, and runs Jest tests
 * to capture the DOM tree.
 *
 * @param {Object} params - The parameters for the function.
 * @param {string} params.filePath - The path to the test file to process.
 * @param {boolean} params.enzymeImportsPresent - Indicates if Enzyme imports are present in the file.
 * @param {string} params.filePathWithEnzymeAdapter - The file path where the modified test file will be saved.
 * @param {string} params.collectedDomTreeFilePath - The file path where the collected DOM tree will be written.
 * @param {string} params.enzymeMountAdapterFilePath - The file path to the Enzyme adapter for mount rendering.
 * @param {string} params.jestBinaryPath - The path to the Jest binary to run the tests.
 * @param {number} params.reactVersion - The version of React being used.
 * @returns {Promise<string>} The collected DOM tree output.
 */
export const getReactCompDom = async ({
    filePath,
    enzymeImportsPresent,
    filePathWithEnzymeAdapter,
    collectedDomTreeFilePath,
    enzymeMountAdapterFilePath,
    jestBinaryPath,
    reactVersion,
}: {
    filePath: string;
    enzymeImportsPresent: boolean;
    filePathWithEnzymeAdapter: string;
    collectedDomTreeFilePath: string;
    enzymeMountAdapterFilePath: string;
    jestBinaryPath: string;
    reactVersion: number;
}): Promise<string> => {

    // Check if file has Enzyme imports for mount/shallow
    if (!enzymeImportsPresent) {
        getDomEnzymeLogger.warn(
            'No Enzyme imports present. Cannot collect logs. Continue...',
        );
        return 'Could not collect DOM for test cases. Proceed without DOM';
    }

    // Create setup for collecting DOM for rendered components in tests
    getDomEnzymeLogger.verbose('Create enzyme adapter to collect DOM');
    createEnzymeAdapter(
        reactVersion,
        collectedDomTreeFilePath,
        enzymeMountAdapterFilePath,
    );

    // Overwrite Enzyme mounts with custom methods
    getDomEnzymeLogger.verbose(
        'Overwrite enzyme shallow/mount methods and relative imports',
    );
    const overwriteEnzymeMountCode = overwriteEnzymeMounts(filePath);

    // Convert relative to absolute imports
    getDomEnzymeLogger.verbose('Convert relative to absolute imports');
    const relToAbsolutePathsCode = overwriteRelativeImports(
        filePath,
        overwriteEnzymeMountCode,
    );

    // Write final code to a new file
    fs.writeFileSync(
        filePathWithEnzymeAdapter,
        relToAbsolutePathsCode,
        'utf-8',
    );

    // Run tests with child process
    getDomEnzymeLogger.verbose('Run Enzyme jest test to collect DOM');
    const jestRunProcess = await runJestInChildProcess(
        jestBinaryPath,
        filePathWithEnzymeAdapter,
    );

    // Return output
    getDomEnzymeLogger.verbose('Get DOM tree output');
    const domTreeOutput = getDomTreeOutputFromFile(collectedDomTreeFilePath);

    // Check if jest ran successfully and share the logs
    if (
        domTreeOutput ===
        'Could not collect DOM for test cases. Proceed without DOM'
    ) {
        getDomEnzymeLogger.warn(
            `Check the output for the jest run: ${jestRunProcess}`,
        );
    }

    // Clean up temporary files
    try {
        getDomEnzymeLogger.verbose('Cleaning up temporary files');
        if (fs.existsSync(filePathWithEnzymeAdapter)) {
            fs.unlinkSync(filePathWithEnzymeAdapter);
            getDomEnzymeLogger.verbose(`Deleted temporary file: ${filePathWithEnzymeAdapter}`);
        }
        if (fs.existsSync(enzymeMountAdapterFilePath)) {
            fs.unlinkSync(enzymeMountAdapterFilePath);
            getDomEnzymeLogger.verbose(`Deleted temporary file: ${enzymeMountAdapterFilePath}`);
        }
        if (fs.existsSync(collectedDomTreeFilePath)) {
            fs.unlinkSync(collectedDomTreeFilePath);
            getDomEnzymeLogger.verbose(`Deleted temporary file: ${collectedDomTreeFilePath}`);
        }
    } catch (error) {
        getDomEnzymeLogger.warn(`Error cleaning up temporary files: ${error}`);
    }

    return domTreeOutput;
};

/**
 * Overwrite enzyme methods to collect DOM for test case renders
 * import { mount } from 'enzyme';
 * to
 * import { mount, shallow } from './enzyme-mount-adapter';
 * @param filePath
 * @returns
 */
export const overwriteEnzymeMounts = (filePath: string): string => {
    // Regex to match the import statement
    const importStatementRegex = /(import\s*{[^}]*}\s*from\s*'enzyme'\s*;)/;

    // Get file content
    let fileContent = fs.readFileSync(filePath, 'utf-8');

    const match = fileContent.match(importStatementRegex);
    const matchedImportString = match && match[1];

    // Direct import from enzyme
    // Check if matched and doesn't have 'type' in it, to avoid `import type { ReactWrapper } from 'enzyme';`
    if (matchedImportString && !matchedImportString.includes('type')) {
        fileContent = fileContent.replace(
            matchedImportString,
            "import { mount, shallow } from './enzyme-mount-adapter';",
        );
    }
    return fileContent;
};

/**
 * Convert relative to absolute imports to
 * @param filePath
 * @param fileContent
 * @returns
 */
export const overwriteRelativeImports = (
    filePath: string,
    fileContent: string,
): string => {
    // Use jscodeshift to parse the source with tsx flag
    const j = jscodeshift.withParser('tsx');
    const root = j(fileContent);
    convertRelativeImports(j, root, filePath);
    const convertedRelativeImportsCode = root.toSource();
    return convertedRelativeImportsCode;
};

/**
 * Create Enzyme adapter with overwritten mount/shallow methods that collect DOM in each test case
 */
export const createEnzymeAdapter = (
    reactVersion: number,
    collectedDomTreeFilePath: string,
    enzymeMountAdapterFilePath: string,
): void => {
    // Create a string with enzyme shallow/mount adapters wih the path to csv for DOM tree
    getDomEnzymeLogger.verbose('Get enzymeRenderAdapterCode');
    const enzymeRenderAdapterCode = getenzymeRenderAdapterCode(
        reactVersion,
        collectedDomTreeFilePath,
    );

    // Create a file with shallow/enzyme adapter that collects DOM
    getDomEnzymeLogger.verbose('Create shallow/enzyme adapter to collect DOM');
    fs.writeFileSync(
        enzymeMountAdapterFilePath,
        enzymeRenderAdapterCode,
        'utf-8',
    );
};

/**
 * Run command in a child process
 * @param jestCommand
 * @returns
 */
export const runJestInChildProcess = async (
    jestBinaryPath: string,
    filePathWithEnzymeAdapter: string,
): Promise<string | null> => {
    getDomEnzymeLogger.verbose('Generate jest command');
    const jestCommand = `${jestBinaryPath} ${filePathWithEnzymeAdapter}`;
    try {
        getDomEnzymeLogger.verbose(
            `Run jest file with command: ${jestCommand}`,
        );
        const commandRunProcess = await runCommand(jestCommand);
        return commandRunProcess.output;
    } catch (error) {
        getDomEnzymeLogger.warn(
            `Could not run jest command command: ${jestCommand}`,
        );
        getDomEnzymeLogger.warn(`Error: ${error}`);
        return null;
    }
};

/**
 * Get collected DOM from a file
 * @returns
 */
export const getDomTreeOutputFromFile = (
    collectedDomTreeFilePath: string,
): string => {
    let domTreeOutput =
        'Could not collect DOM for test cases. Proceed without DOM';

    try {
        getDomEnzymeLogger.verbose(
            `Getting collected DOM from ${collectedDomTreeFilePath}`,
        );
        domTreeOutput = fs.readFileSync(collectedDomTreeFilePath, 'utf-8');
    } catch (error) {
        getDomEnzymeLogger.warn(
            `Could not collect DOM logs from ${collectedDomTreeFilePath}\nError: ${error}`,
        );
    }
    return domTreeOutput;
};

/**
 * Create string with enzyme mount adapters
 * @param collectedDomTreeFilePath
 * @returns
 */
export const getenzymeRenderAdapterCode = (
    reactVersion: number,
    collectedDomTreeFilePath: string,
): string => {
    let adapterCode = '';

    if (reactVersion === 16) {
        adapterCode = `
import Adapter from 'enzyme-adapter-react-16';
enzyme.configure({ adapter: new Adapter() });
`;
    } else if (reactVersion === 17) {
        adapterCode = `
import Adapter from '@wojtekmaj/enzyme-adapter-react-17';
enzyme.configure({ adapter: new Adapter() });
`;
    } else {
        adapterCode = `// No Enzyme adapter configured for React version: ${reactVersion}`;
    }
    const enzymeRenderAdapterCodeJS = `
// Import original methods
import enzyme, { mount as originalMount, shallow as originalShallow } from 'enzyme';
import fs from 'fs';

// Set up Enzyme with the adapter
${adapterCode}

let currentTestCaseName = null;

beforeEach(() => {
    // Set the current test case name before each test
    const testName = expect.getState().currentTestName;
    currentTestCaseName = testName ? testName.trim() : null;
});

afterEach(() => {
    // Reset the current test case name after each test
    currentTestCaseName = null;
});

// Overwrite mount method
enzyme.mount = (node, options) => {
    const wrapper = originalMount(node, options);
    const htmlContent = wrapper.html();
	fs.appendFileSync(
		'${collectedDomTreeFilePath}',
		\`<test_case_title>\${currentTestCaseName}</test_case_title> and <dom_tree>\${htmlContent}</dom_tree>;\n\`,
	);
    return wrapper;
};

// Overwrite shallow method
enzyme.shallow = (node, options) => {
    const wrapper = originalShallow(node, options);
    let resultString;

    try {
        // Try to get HTML
        const htmlContent = wrapper.html();
		resultString = \`<test_case_title>\${currentTestCaseName}</test_case_title> and <dom_tree>\${htmlContent}</dom_tree>;\n\`;
    } catch (htmlError) {
        // If html() fails, use debug() as a fallback
        try {
			const debugContent = wrapper.debug().replace(/\\n/g, ' ');
			resultString = \`<test_case_title>\${currentTestCaseName}</test_case_title> and <dom_tree>\${debugContent}</dom_tree>;\n\`;
        } catch (debugError) {
            // If both html() and debug() fail, provide a default string or handle the error as needed
			resultString = \`<test_case_title>\${currentTestCaseName}</test_case_title> and <dom_tree>Failed to retrieve DOM tree</dom_tree>;\n\`;
        }
    }
	fs.appendFileSync('${collectedDomTreeFilePath}', resultString);
    return wrapper;
};

export const { shallow, mount } = enzyme;`;
    return enzymeRenderAdapterCodeJS;
};
