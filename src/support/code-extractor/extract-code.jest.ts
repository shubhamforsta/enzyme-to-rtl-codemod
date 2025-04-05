import fs from 'fs';
import { extractCodeContentToFile } from './extract-code';

// Mock fs.writeFileSync
jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

describe('extractCodeContentToFile', () => {
    const rtlConvertedFilePathExpected = '/path/to/file';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should extract code content and write to file', () => {
        const LLMresponse = `console.log("test")`;
        const rtlConvertedFilePath = extractCodeContentToFile({
            LLMresponse,
            rtlConvertedFilePath: rtlConvertedFilePathExpected,
        });

        expect(rtlConvertedFilePath).toBe(rtlConvertedFilePath);
        expect(fs.writeFileSync).toHaveBeenCalledWith(
            rtlConvertedFilePath,
            `console.log("test")`,
            'utf-8',
        );
    });

    it('should throw an error if code is not extracted due to empty string', () => {
        const LLMresponse = '';

        expect(() =>
            extractCodeContentToFile({
                LLMresponse,
                rtlConvertedFilePath: rtlConvertedFilePathExpected,
            }),
        ).toThrow('Could not extract code from the LLM response');
    });
});
