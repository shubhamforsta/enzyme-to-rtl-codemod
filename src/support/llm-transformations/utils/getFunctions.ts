export const getFunctions = (disableUpdateComponent = false) => {
    const functions = [{
        type: 'function',
        function: {
            name: 'requestForFile',
            description: 'Requests the content of any file that might be needed to understand test failures or component behavior. This can include component files, utility files, constants, hooks, or any other files referenced in error messages or test code. Note: The file content you receive will have all relative imports converted to absolute imports for easier reference.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'The relative path to the file, exactly as it appears in the import statement.',
                    },
                    currentFilePath: {
                        type: 'string',
                        description: 'The absolute path of the current file where the import statement appears.',
                    },
                    absolutePath: {
                        type: 'string',
                        description: 'The absolute path to the file. If provided, this will be used directly instead of resolving from path and currentFilePath. Use this for files mentioned in error logs with absolute paths.',
                    }
                },
                required: ['path', 'currentFilePath'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'requestForReferenceTests',
            description: 'Searches for existing React Testing Library tests in nearby directories that can be used as reference for understanding patterns and conventions in the codebase. Note: The reference test examples you receive will have all relative imports converted to absolute imports for easier reference. You can directly copy these import paths into your code if needed.',
            parameters: {
                type: 'object',
                properties: {
                    currentTestPath: {
                        type: 'string',
                        description: 'The absolute path of the current test file being converted. This will be used as the starting point for finding nearby RTL tests.',
                    },
                    searchDepth: {
                        type: 'integer',
                        description: 'How many directory levels up to search (1 = same directory, 2 = parent directory, etc.). Default is 2.',
                    },
                    keywords: {
                        type: 'array',
                        items: {
                            type: 'string'
                        },
                        description: 'Optional keywords to filter test files by content, such as specific RTL functions or patterns you want to learn about.',
                    }
                },
                required: ['currentTestPath'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'evaluateAndRun',
            description: 'Evaluates and runs the converted React Testing Library test file. This function will take your converted code, save it to a file, and run Jest tests on it to validate that the conversion was successful. You must use this function to submit your final converted code. Note: You can use absolute imports in your code - they will be automatically converted to appropriate relative imports when saved.',
            parameters: {
                type: 'object',
                properties: {
                    file: {
                        type: 'string',
                        description: 'The complete React Testing Library converted code that should run with Jest without manual changes. This should be the entire test file content including all imports, test cases, and any helper functions. The code should follow React Testing Library best practices and correctly implement all the test cases from the original Enzyme file. You can use absolute import paths copied from reference files - they will be automatically converted to relative paths.',
                    },
                },
                required: ['file'],
            },
        },
    }] as any[];

    // Only include updateComponent function if it's not disabled
    if (!disableUpdateComponent) {
        functions.splice(2, 0, {
            type: 'function',
            function: {
                name: 'updateComponent',
                description: 'IMPORTANT: This function should be used ONLY as an absolute last resort when RTL conversion is impossible without component modification. You are STRICTLY LIMITED to adding 1-2 lines of test-specific attributes (like data-testid) ONLY. You MUST return the exact original file content with these minimal additions - NO OTHER CHANGES are allowed. You cannot modify ANY: component logic, implementation, functionality, styling, imports, exports, types, interfaces, or structure. Any changes beyond adding 1-2 test attribute lines will be rejected. Use this function with extreme caution.',
                parameters: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'The relative path to the component file, exactly as it appears in the import statement.',
                        },
                        currentFilePath: {
                            type: 'string',
                            description: 'The absolute path of the current file where the import statement appears.',
                        },
                        absolutePath: {
                            type: 'string',
                            description: 'The absolute path to the component file. If provided, this will be used directly instead of resolving from path and currentFilePath.',
                        },
                        newContent: {
                            type: 'string',
                            description: 'The updated content for the component file. You MUST send back the original file content exactly as is, with ONLY 1-2 lines added for testing attributes (like data-testid). The changes must be minimal and ONLY for testing purposes. You are NOT allowed to modify any component logic, implementation, functionality, styling or structure. Any changes beyond adding test attributes will be rejected.',
                        },
                        explanation: {
                            type: 'string',
                            description: 'A brief explanation of why this component update is necessary for testing and what changes were made. This helps reviewers understand the purpose of the modifications.',
                        }
                    },
                    required: ['path', 'currentFilePath', 'newContent', 'explanation'],
                },
            },
        });
    }

    return functions;
};
    