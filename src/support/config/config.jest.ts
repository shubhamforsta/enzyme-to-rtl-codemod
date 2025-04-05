import fs from 'fs';
import path from 'path';
import {
    configureLogLevel,
    setOutputResultsPath,
    getReactVersion,
    checkPerFileConfig,
    checkIfEnzyme,
    extractFileDetails,
    initializeConfig,
    Config,
} from './config';
import { countTestCases } from './utils/utils';
import { Ora } from 'ora';

const spinner = {
    info: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    succeed: jest.fn(),
    fail: jest.fn()
} as unknown as Ora;

// Mock the modules
jest.mock('fs');
jest.mock('path', () => {
    const originalPath = jest.requireActual('path');
    return {
        join: jest.fn(() => '/verbose.log'),
        resolve: jest.fn(),
        ...originalPath
    };
});

describe('Configuration Functions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('initializeConfig - Happy Path', () => {
        it('should initialize the config with the correct values', () => {
            const mockArgs = {
                filePath: 'some/path/to/file.test.tsx',
                jestBinaryPath: 'path/to/jest',
                testId: 'data-test-id',
                logLevel: 'verbose',
                spinner,
            };
            // Mock the file content to simulate test cases number
            const mockFileContent = `
            it('should do something', () => {});
            test('should do something else', () => {});
            `;
            jest.spyOn(fs, 'readFileSync').mockReturnValue(mockFileContent);

            // Pass the verification for the Enzyme file
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);

            // Call the function to initialize the config
            const resultConfig = initializeConfig(mockArgs);

            // Assertions for shared config
            expect(resultConfig.jestBinaryPath).toBe(mockArgs.jestBinaryPath);
            expect(resultConfig.outputResultsPath).toBe(
                'some/path/to',
            );
            expect(resultConfig.jsonSummaryPath).toContain(
                `${resultConfig.projectRootPath}/summary.json`,
            );
            expect(resultConfig.logLevel).toBe(mockArgs.logLevel);
            expect(resultConfig.testId).toBe(mockArgs.testId);
            expect(resultConfig.reactVersion).toBe(17);
            expect(resultConfig.configInitialized).toBe(true);

            // Assertions for per test file config
            expect(resultConfig.filePathTitle).toBe('file');
            expect(resultConfig.filePathExtension).toBe('.test.tsx');
            expect(resultConfig.astTranformedFilePath).toBe(
                `${resultConfig.outputResultsPath}/ast-transformed-file.test.tsx`,
            );
            expect(resultConfig.collectedDomTreeFilePath).toBe(
                `${resultConfig.outputResultsPath}/dom-tree-file.csv`,
            );
            expect(resultConfig.originalTestCaseNum).toBe(2);
            expect(resultConfig.filePathWithEnzymeAdapter).toBe(
                `${resultConfig.outputResultsPath}/enzyme-mount-overwritten-file.test.tsx`,
            );
            expect(resultConfig.enzymeMountAdapterFilePath).toBe(
                `${resultConfig.outputResultsPath}/enzyme-mount-adapter.js`,
            );
            expect(resultConfig.enzymeImportsPresent).toBe(false);

            // Assertions for attempt paths
            expect(resultConfig.rtlConvertedFilePath).toContain(
                `${resultConfig.outputResultsPath}/rtl-converted-file.test.tsx`,
            );
            expect(resultConfig.jestRunLogsFilePath).toContain(
                `${resultConfig.outputResultsPath}/jest-run-logs-file.md`,
            );
            // Reset the config object after the test
            (Object.keys(resultConfig) as Array<keyof Config>).forEach(
                (key) => {
                    resultConfig[key] = undefined!;
                },
            );
        });
    });

    describe('configureLogLevel', () => {
        it('should set the log level', () => {
            configureLogLevel('verbose');
            expect(process.env.LOG_LEVEL).toBe('verbose');
        });
    });

    describe('setOutputResultsPath', () => {
        it('should set and resolve the output results path', () => {
            const outputPath = 'path/to/output';
            const resolvedPath = '/resolved/path/to/output';

            jest.spyOn(path, 'resolve').mockImplementation(() => resolvedPath);

            const resultPath = setOutputResultsPath(outputPath);
            expect(resultPath).toBe(resolvedPath);
        });
    });

    describe('extractFileDetails', () => {
        it('should extract the file title and extension correctly', () => {
            const filePath = 'some/path/to/file.jest.tsx';

            const result = extractFileDetails(filePath);

            expect(result).toEqual({
                fileTitle: 'file',
                fileExtension: '.jest.tsx',
            });
        });

        it('should throw an error if the file path is invalid', () => {
            const invalidFilePath = 'some/path/to/folder/';

            expect(() => extractFileDetails(invalidFilePath)).toThrow(
                'Invalid file path',
            );
        });
    });

    describe('getReactVersion', () => {
        it('should return the correct major version when React is in dependencies', () => {
            const mockPackageJson = JSON.stringify({
                dependencies: {
                    react: '^16.8.0',
                },
            });

            jest.spyOn(path, 'resolve').mockImplementation(() => 
                '/mocked/path/to/package.json'
            );
            (fs.readFileSync as jest.Mock).mockReturnValue(mockPackageJson);

            const version = getReactVersion();
            expect(version).toBe(16);
            expect(fs.readFileSync).toHaveBeenCalledWith(
                '/mocked/path/to/package.json',
                'utf-8',
            );
        });

        it('should default to React version 17 if no React version is found', () => {
            const mockPackageJson = JSON.stringify({
                dependencies: {
                    enzyme: '3.11.0',
                },
            });

            jest.spyOn(path, 'resolve').mockImplementation(() => 
                '/mocked/path/to/package.json'
            );
            (fs.readFileSync as jest.Mock).mockReturnValue(mockPackageJson);

            const version = getReactVersion();
            expect(version).toBe(17);
            expect(fs.readFileSync).toHaveBeenCalledWith(
                '/mocked/path/to/package.json',
                'utf-8',
            );
        });
    });

    describe('checkPerFileConfig', () => {
        it('should throw an error if the test file does not exist', () => {
            (fs.existsSync as jest.Mock).mockReturnValueOnce(false);

            expect(() => checkPerFileConfig('non/existent/file')).toThrow(
                'Enzyme file provided does not exist',
            );
        });

        it('should throw an error if the output results path does not exist', () => {
            (fs.existsSync as jest.Mock).mockReturnValueOnce(true);
            (fs.existsSync as jest.Mock).mockReturnValueOnce(false);

            expect(() => checkPerFileConfig('some/file')).toThrow(
                'Output results path does not exist',
            );
        });
    });

    describe('checkIfEnzyme', () => {
        it('should return true if the file contains Enzyme imports', () => {
            const fileContent = "import { mount } from 'enzyme';\nconst a = 1;";
            (fs.readFileSync as jest.Mock).mockReturnValue(fileContent);

            const result = checkIfEnzyme('some/file');
            expect(result).toBe(true);
        });

        it('should return false if the file does not contain Enzyme imports', () => {
            const fileContent = "import React from 'react';\nconst a = 1;";
            (fs.readFileSync as jest.Mock).mockReturnValue(fileContent);

            const result = checkIfEnzyme('some/file');
            expect(result).toBe(false);
        });
    });
});

describe('Count test cases', () => {
    it('should count test cases correctly', () => {
        const fileContent = `
        describe('Test suite', () => {
            it('test case 1', () => {});
            it.each([1, 2, 3])('test case 2', (num) => {});
            test('test case 3', () => {});
            test.each([4, 5, 6])('test case 4', (num) => {});
        });
        `;
        (fs.readFileSync as jest.Mock).mockReturnValue(fileContent);
        const result = countTestCases('enzymeFilePath');
        expect(result).toBe(4);
    });

    it('should return 0 if no test cases are found in the test file code', () => {
        // Use jest.spyOn to mock fs.readFileSync for this test
        const readFileSyncMock = jest.spyOn(fs, 'readFileSync');

        // Define the mock file content
        const fileContent = `
        describe('Test suite that has no test cases', () => {
            // No test
        });
    `;

        // Mock fs.readFileSync to return the specified file content
        readFileSyncMock.mockReturnValue(fileContent);

        // Call the function under test
        const result = countTestCases('enzymeFilePathNoTests');

        // Assert that the result is as expected
        expect(result).toBe(0);
    });
});
