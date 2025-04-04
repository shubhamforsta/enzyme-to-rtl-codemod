export const getFunctions = () => {
    return [{
        type: 'function',
        function: {
            name: 'evaluateAndRun',
            description: 'Evaluates and runs the converted test file. ',
            parameters: {
                type: 'object',
                properties: {
                    file: {
                        type: 'string',
                        description: 'React testing Library converted code/file. it should run with jest without manual changes',
                    },
                },
                required: ['file'],
            },
        },
    }];
};
    