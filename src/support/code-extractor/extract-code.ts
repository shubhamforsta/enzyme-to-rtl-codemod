import fs from 'fs';

/**
 * Extract code content from an LLM response and write it to a file.
 *
 * This function parses the LLM response for code enclosed in `<rtl_test_code>` tags
 * and writes the extracted code to the specified file path. If the extraction fails,
 * an error is thrown with detailed logging information.
 *
 * @param {Object} params - The parameters for the function.
 * @param {string} params.LLMresponse - The response from the LLM containing the code to extract.
 * @param {string} params.rtlConvertedFilePath - The file path where the extracted code will be saved.
 * @returns {string} The path to the file where the extracted code is written.
 * @throws Will throw an error if the code cannot be extracted from the LLM response.
 */
export const extractCodeContentToFile = ({
    LLMresponse,
    rtlConvertedFilePath,
}: {
    LLMresponse: string;
    rtlConvertedFilePath: string;
}): string => {
    if (!LLMresponse) {
        throw new Error('Could not extract code from the LLM response');
    }

    // Write extracted code to file
    fs.writeFileSync(`${rtlConvertedFilePath}`, LLMresponse, 'utf-8');

    return rtlConvertedFilePath;
};
