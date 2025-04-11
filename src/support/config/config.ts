import path from 'path';
import fs from 'fs';
import { config as winstonConfig } from 'winston';
import { countTestCases } from './utils/utils';
import {
    createCustomLogger,
    updateLogLevelForAllLoggers,
    getVerboseLogFilePath,
} from '../logger/logger';
import { Ora } from 'ora';

export const configLogger = createCustomLogger('Config');

// Define type for valid log level strings
type LogLevel = keyof typeof winstonConfig.npm.levels;

// Config interface
export interface Config {
    // Shared
    jestBinaryPath: string;
    typeCheckBinaryPath: string;
    outputResultsPath: string;
    jsonSummaryPath: string;
    logLevel: LogLevel;
    verboseLogFilePath: string;
    testId: string;
    reactVersion: number;
    configInitialized: boolean;
    projectRootPath: string;

    // Per test file
    filePathTitle: string;
    filePathExtension: string;
    astTranformedFilePath: string;
    collectedDomTreeFilePath: string;
    originalTestCaseNum: number;
    filePathWithEnzymeAdapter: string;
    enzymeMountAdapterFilePath: string;
    enzymeImportsPresent: boolean;

    // Attempt 1
    rtlConvertedFilePath: string;
    jestRunLogsFilePath: string;
}

// Persistent config object
const config: Config = {} as Config;

interface InitializeSharedConfigArgs {
    jestBinaryPath: string;
    typeCheckBinaryPath: string;
    logLevel: LogLevel;
    testId: string;
}

export const getProjectRootPath = (): string => {
    return process.cwd();
};

/**
 * Initialize shared config
 * @param {Object} options
 * @param {string} options.jestBinaryPath - The path to the Jest binary.
 * @param {string} options.typeCheckBinaryPath - The path to the TypeScript binary.
 * @param {string} options.logLevel - The logging level for the test execution.
 * @param {string} options.testId - getByTestAttribute
 *
 */
export const initializeSharedConfig = ({
    jestBinaryPath,
    typeCheckBinaryPath,
    logLevel,
    testId,
}: InitializeSharedConfigArgs): void => {
    config.jestBinaryPath = jestBinaryPath;
    config.typeCheckBinaryPath = typeCheckBinaryPath;
    config.logLevel = logLevel;
    // Set log level
    configureLogLevel(config.logLevel);
    config.testId = testId;
    config.reactVersion = getReactVersion();
    config.jsonSummaryPath = `${getProjectRootPath()}/summary.json`;
    config.projectRootPath = getProjectRootPath();
    // Check shared config
    checkSharedConfig();

    config.configInitialized = true;
};

// Main function to initialize config
// Define an interface for the named arguments
interface InitializeConfigArgs {
    filePath: string;
    jestBinaryPath: string;
    typeCheckBinaryPath: string;
    testId?: string;
    logLevel?: LogLevel;
    spinner: Ora;
}

/**
 * Initialize the configuration
 *
 * This function ensures that the shared configuration is initialized once and then
 * initializes or updates the configuration specific to a particular test file.
 * It returns the updated configuration object, which can be used throughout the process.
 *
 * @param {Object} params
 * @param {string} params.filePath - The path to the test file being processed.
 * @param {string} params.jestBinaryPath - The path to the Jest binary that can run one test file
 * @param {string} params.testId - getByTestAttribute
 * @param {string} [params.logLevel='info'] - The logging level 'info' or 'verbose'
 *
 * @returns {Config} The configuration object
 *
 * @example
 * const config = initializeConfig({
 *   filePath: 'tests/example.jest.tsx',
 *   jestBinaryPath: 'npm run test',
 *   testId: 'data-test',
 *   logLevel: 'verbose',
 * });
 */
export const initializeConfig = ({
    filePath,
    jestBinaryPath,
    typeCheckBinaryPath,
    testId = 'data-testid',
    logLevel = 'info',
    spinner
}: InitializeConfigArgs): Config => {
    // Check if the shared config has already been initialized
    if (!config.configInitialized) {
        initializeSharedConfig({
            jestBinaryPath,
            typeCheckBinaryPath,
            logLevel,
            testId,
        });
    }

    // Initialize or update per test file properties
    initializePerFileConfig(filePath);

    spinner.info(`Transforming Enzyme file: ${filePath}`);
    spinner.info(
        `Number of test cases in file: ${config.originalTestCaseNum}`,
    );

    return config;
};

/**
 * Extracts the folder path containing the file
 * @param filePath
 */
const extractFolderPathContainingFile = (filePath: string): string => {
    const folderPath = filePath.split('/').slice(0, -1).join('/');
    return folderPath;
};

/**
 * Initialize config for each file conversion
 * @param filePath
 */
const initializePerFileConfig = (filePath: string): void => {
    // Common
    config.outputResultsPath = extractFolderPathContainingFile(filePath);
    const { fileTitle, fileExtension } = extractFileDetails(filePath);
    config.filePathTitle = fileTitle;
    config.filePathExtension = fileExtension;
    config.astTranformedFilePath = `${config.outputResultsPath}/ast-transformed-${config.filePathTitle}${config.filePathExtension}`;
    config.collectedDomTreeFilePath = `${config.outputResultsPath}/dom-tree-${config.filePathTitle}.csv`;
    config.originalTestCaseNum = countTestCases(filePath);
    config.filePathWithEnzymeAdapter = `${config.outputResultsPath}/enzyme-mount-overwritten-${config.filePathTitle}${config.filePathExtension}`;
    config.enzymeMountAdapterFilePath = `${config.outputResultsPath}/enzyme-mount-adapter.js`;
    config.enzymeImportsPresent = checkIfEnzyme(filePath);

    config.rtlConvertedFilePath = `${config.outputResultsPath}/rtl-converted-${config.filePathTitle}${config.filePathExtension}`;
    config.jestRunLogsFilePath = `${config.outputResultsPath}/jest-run-logs-${config.filePathTitle}.md`;

    // Check per file config
    checkPerFileConfig(filePath);
};

/**
 * Configure log level
 * Winston logging levels, see: https://github.com/winstonjs/winston#logging
 * @param logLevel
 */
export const configureLogLevel = (logLevel: LogLevel): void => {
    configLogger.info(`Set log level to ${logLevel}`);
    process.env.LOG_LEVEL = logLevel as string;
    // Update the global log level and all loggers
    updateLogLevelForAllLoggers(logLevel as string);
    
    // Set the verbose log file path in config
    config.verboseLogFilePath = getVerboseLogFilePath();
    configLogger.info(`Verbose logs will be written to: ${config.verboseLogFilePath}`);
};

/**
 * Sets resolved output results path
 * @param outputResultsPath
 */
export const setOutputResultsPath = (outputResultsPath: string): string => {
    const hostProjectRoot = process.cwd();
    const resolvedPath = path.resolve(hostProjectRoot, outputResultsPath);
    configLogger.info(`Set output results path to "${resolvedPath}"`);
    return resolvedPath;
};

/**
 * Extract file title and extension
 * @param filePath
 * @returns
 */
export const extractFileDetails = (
    filePath: string,
): { fileTitle: string; fileExtension: string } => {
    // Extract the file name with extension
    const fileNameWithExtension = filePath.split('/').pop();

    if (!fileNameWithExtension) {
        throw new Error('Invalid file path');
    }

    // Extract the file extension
    const fileExtension = fileNameWithExtension.slice(
        fileNameWithExtension.indexOf('.'),
    );

    // Extract the file title by removing the extension from the file name
    const fileTitle = fileNameWithExtension.slice(
        0,
        fileNameWithExtension.indexOf('.'),
    );

    return { fileTitle, fileExtension };
};

/**
 * Create folder for each test case conversion
 * @param filePath
 * @returns
 */
export const createFileConversionFolder = (filePath: string): string => {
    const fileConversionFolder = `${config.outputResultsPath}/${filePath.replace(/[<>:"/|?*.]+/g, '-')}`;
    configLogger.verbose(`Create folder for ${fileConversionFolder}`);
    fs.mkdirSync(fileConversionFolder, { recursive: true });
    return fileConversionFolder;
};

/**
 * Get React version from package.json
 * @returns
 */
export const getReactVersion = (): number => {
    let reactVersion: number | null = null;

    try {
        const packageJsonPath = path.resolve(process.cwd(), 'package.json');
        const packageJson = JSON.parse(
            fs.readFileSync(packageJsonPath, 'utf-8'),
        );

        const reactVersionString =
            packageJson.dependencies.react ||
            packageJson.devDependencies.react ||
            null;

        if (reactVersionString) {
            // Extract the main version number (e.g., "16" from "^16.8.0", "~16.8.0", etc.)
            const versionMatch = reactVersionString.match(/^\D*(\d+)\./);
            if (versionMatch) {
                reactVersion = parseInt(versionMatch[1], 10);
            }
        }
    } catch (error) {
        configLogger.warn(
            'Error reading package.json. Defaulting to React version 17',
        );
    }

    // Check the version and deault to 17 if not found
    if (reactVersion === null) {
        configLogger.warn(
            'Could not get React version from package.json. Defaulting to 17',
        );
        // Default to React version 17 if not found
        return 17;
    } else {
        return reactVersion;
    }
};

/**
 * Check dependency util function
 * @param dependency
 */
const checkDependency = (dependency: string): void => {
    try {
        configLogger.verbose(
            `Check if ${dependency} exists and can be resolved`,
        );
        require.resolve(dependency);
    } catch {
        configLogger.error(
            `${dependency} is not installed. Please ensure that ${dependency} is installed in the host project.`,
        );
        throw new Error(
            `${dependency} is not installed. Please ensure that ${dependency} is installed in the host project.`,
        );
    }
};

/**
 * Check shared config
 */
export const checkSharedConfig = (): void => {
    // Check if jestBinaryPath can be found
    configLogger.verbose('Check if jest exists and can be resolved');
    checkDependency('jest');

    configLogger.verbose('Check if jscodeshift exists and can be resolved');
    checkDependency('jscodeshift');

    configLogger.verbose('Check if enzyme exists and can be resolved');
    checkDependency('enzyme');
};

/**
 * Check per file config
 * @param filePath
 */
export const checkPerFileConfig = (filePath: string): void => {
    // Check if file path exists
    if (filePath) {
        configLogger.verbose('Check if Enzyme file exists');
        if (!fs.existsSync(filePath)) {
            configLogger.error('Enzyme file provided does not exist');
            throw new Error('Enzyme file provided does not exist');
        }
    }

    // Check if output results path exists
    if (!fs.existsSync(config.outputResultsPath)) {
        configLogger.error('Output results path does not exist');
        throw new Error('Output results path does not exist');
    }
};

/**
 * Check if test file has enzyme imports
 * @param filePath
 * @returns
 */
export const checkIfEnzyme = (filePath: string): boolean => {
    // Check if it is an Enzyme file
    configLogger.verbose('Check if Enzyme file has Enzyme imports');
    const importStatementRegex = /(import\s*{[^}]*}\s*from\s*'enzyme'\s*;)/;
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    if (importStatementRegex.test(fileContent)) {
        configLogger.verbose(`Found tests in ${filePath}`);
        return true;
    }
    configLogger.warn(
        'Enzyme file provided does not have any tests. Cannot collect DOM tree for tests',
    );
    return false;
};
