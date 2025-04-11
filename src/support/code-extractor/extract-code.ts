import fs from 'fs';
import jscodeshift from 'jscodeshift';
import { convertImportsToRelative } from '../ast-transformations/individual-transformations/convert-relative-imports';
import { createCustomLogger } from '../logger/logger';

const codeExtractorLogger = createCustomLogger('Code Extractor');

/**
 * Process the code to convert absolute imports to relative ones
 * 
 * @param code - The code content with absolute imports
 * @param filePath - The target file path where the code will be saved
 * @returns The code with relative imports
 */
export const processCodeImports = (code: string, filePath: string): string => {
    try {
        if (!code) return code;
        
        // Use jscodeshift to parse and transform the content
        const j = jscodeshift.withParser('tsx');
        const root = j(code);
        
        // Convert absolute imports to relative
        convertImportsToRelative(j, root, filePath);
        
        // Return the transformed source
        return root.toSource();
    } catch (error) {
        codeExtractorLogger.verbose(`Error processing imports in code: ${error}`);
        // Return original code if transformation fails
        return code;
    }
};

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
 * @param {boolean} [params.processImports=true] - Whether to process imports in the code.
 * @returns {string} The path to the file where the extracted code is written.
 * @throws Will throw an error if the code cannot be extracted from the LLM response.
 */
export const extractCodeContentToFile = ({
    LLMresponse,
    rtlConvertedFilePath,
    processImports = true,
}: {
    LLMresponse: string;
    rtlConvertedFilePath: string;
    processImports?: boolean;
}): string => {
    if (!LLMresponse) {
        throw new Error('Could not extract code from the LLM response');
    }

    // Process imports if enabled
    let processedCode = LLMresponse;
    if (processImports) {
        codeExtractorLogger.verbose('Processing imports in extracted code');
        processedCode = processCodeImports(LLMresponse, rtlConvertedFilePath);
    }

    // Write processed code to file
    fs.writeFileSync(`${rtlConvertedFilePath}`, processedCode, 'utf-8');

    return rtlConvertedFilePath;
};
