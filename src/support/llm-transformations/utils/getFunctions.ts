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
    }];
};
    