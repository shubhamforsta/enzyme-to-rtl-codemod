export const getFunctions = () => {
    return [{
        type: 'function',
        function: {
            name: 'evaluateAndRun',
            description: 'Evaluates and runs the converted React Testing Library test file. This function will take your converted code, save it to a file, and run Jest tests on it to validate that the conversion was successful. You must use this function to submit your final converted code.',
            parameters: {
                type: 'object',
                properties: {
                    file: {
                        type: 'string',
                        description: 'The complete React Testing Library converted code that should run with Jest without manual changes. This should be the entire test file content including all imports, test cases, and any helper functions. The code should follow React Testing Library best practices and correctly implement all the test cases from the original Enzyme file.',
                    },
                },
                required: ['file'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'requestForComponent',
            description: 'Requests the content of a component file referenced in the test file. This helps provide additional context for converting Enzyme tests to React Testing Library by examining the actual component being tested.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'The relative path to the component, exactly as it appears in the import statement.',
                    },
                    currentFilePath: {
                        type: 'string',
                        description: 'The absolute path of the current file where the import statement appears.',
                    },
                },
                required: ['path', 'currentFilePath'],
            },
        },
    }];
};
    