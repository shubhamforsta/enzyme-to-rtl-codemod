import fs from 'fs';
import path from 'path';
import { findTestFiles, isRtlTest, findRtlReferenceTests, RTL_PATTERNS } from './find-rtl-reference-tests';

// Mock the logger module
jest.mock('../logger/logger', () => ({
    createCustomLogger: jest.fn().mockReturnValue({
        verbose: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        info: jest.fn()
    })
}));

// Mock the fs and path modules
jest.mock('fs');
jest.mock('path');

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedPath = path as jest.Mocked<typeof path>;

// Helper to create mock Dirent objects
function createMockDirent(name: string, isDir: boolean): fs.Dirent {
    return {
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false
    } as fs.Dirent;
}

describe('findRtlReferenceTests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        
        // Default path behavior
        mockedPath.dirname.mockImplementation((p: string) => `${p}_parent`);
        mockedPath.join.mockImplementation((...segments: string[]) => segments.join('/'));
    });
    
    describe('findTestFiles', () => {
        it('should find test files in a directory', () => {
            // Setup directory entries that will be processed
            const mockDirContents = [
                createMockDirent('file1.spec.ts', false),
                createMockDirent('file2.test.tsx', false),
                createMockDirent('regular.ts', false),
                createMockDirent('subdir', true)
            ];
            
            // Mock directory read functionality
            mockedFs.readdirSync.mockReturnValueOnce(mockDirContents);
            
            // Setup stat returns for each file type
            mockedFs.statSync.mockImplementation((filepath: fs.PathLike) => {
                const filename = String(filepath).split('/').pop();
                return {
                    isDirectory: () => filename === 'subdir',
                    isFile: () => filename !== 'subdir'
                } as fs.Stats;
            });
            
            // For the subdirectory call, return a nested test file
            mockedFs.readdirSync.mockReturnValueOnce([
                createMockDirent('nested.spec.ts', false)
            ]);
            
            // Set the file stat for the nested file
            const result = findTestFiles('/test/dir');
            
            // Check results
            expect(result).toEqual([
                '/test/dir/file1.spec.ts',
                '/test/dir/file2.test.tsx',
                '/test/dir/subdir/nested.spec.ts'
            ]);
            
            // Verify calls
            expect(mockedFs.readdirSync).toHaveBeenCalledTimes(2);
            expect(mockedFs.statSync).toHaveBeenCalledTimes(5); // 4 files + 1 extra check
        });
        
        it('should handle errors gracefully', () => {
            mockedFs.readdirSync.mockImplementationOnce(() => {
                throw new Error('Permission denied');
            });
            
            const result = findTestFiles('/test/dir');
            
            expect(result).toEqual([]);
        });
    });
    
    describe('isRtlTest', () => {
        it('should identify RTL tests by content', () => {
            // Mock file content with RTL imports
            mockedFs.readFileSync.mockReturnValueOnce(`
                import { render, screen } from '@testing-library/react';
                import userEvent from '@testing-library/user-event';
                
                test('should render', () => {
                    render(<Component />);
                    screen.getByText('Hello');
                });
            `);
            
            const result = isRtlTest('/test/rtl-test.spec.tsx');
            
            expect(result).toBe(true);
            expect(mockedFs.readFileSync).toHaveBeenCalledWith('/test/rtl-test.spec.tsx', 'utf8');
        });
        
        it('should return false for non-RTL tests', () => {
            // Mock file content without RTL imports
            mockedFs.readFileSync.mockReturnValueOnce(`
                import { shallow } from 'enzyme';
                
                test('should render', () => {
                    const wrapper = shallow(<Component />);
                    expect(wrapper.find('div')).toHaveLength(1);
                });
            `);
            
            const result = isRtlTest('/test/enzyme-test.spec.tsx');
            
            expect(result).toBe(false);
        });
        
        it('should handle file read errors', () => {
            mockedFs.readFileSync.mockImplementationOnce(() => {
                throw new Error('File not found');
            });
            
            const result = isRtlTest('/test/missing.spec.tsx');
            
            expect(result).toBe(false);
        });
    });
    
    describe('findRtlReferenceTests', () => {
        it('should find RTL test references', () => {
            // Mock path behavior for parent directory traversal
            mockedPath.dirname
                .mockReturnValueOnce('/test/dir')  // First call for testPath
                .mockReturnValueOnce('/test')      // Second call for parent
                .mockReturnValueOnce('/');         // Third call for root
            
            // Mock directory scanning
            mockedFs.readdirSync
                .mockReturnValueOnce([
                    createMockDirent('test1.spec.tsx', false),
                    createMockDirent('test2.spec.tsx', false)
                ]) // /test/dir
                .mockReturnValueOnce([
                    createMockDirent('test3.spec.tsx', false)
                ]); // /test
            
            // Set up file stat mocks
            mockedFs.statSync.mockReturnValue({
                isDirectory: () => false,
                isFile: () => true
            } as fs.Stats);
            
            // Mock file contents
            mockedFs.readFileSync
                .mockReturnValueOnce('import { render } from "@testing-library/react"') // test1.spec.tsx
                .mockReturnValueOnce('import { shallow } from "enzyme"')              // test2.spec.tsx
                .mockReturnValueOnce('import { screen } from "@testing-library/react"'); // test3.spec.tsx
            
            const result = findRtlReferenceTests('/test/dir/current.spec.tsx', 2);
            
            expect(result).toEqual([
                {
                    path: '/test/dir/test1.spec.tsx',
                    content: 'import { render } from "@testing-library/react"'
                },
                {
                    path: '/test/test3.spec.tsx',
                    content: 'import { screen } from "@testing-library/react"'
                }
            ]);
        });
        
        it('should limit results to 3 test files', () => {
            // Set up to find 4 RTL tests but expect only 3 returned
            mockedPath.dirname.mockReturnValue('/test/dir');
            
            // Return 4 test files
            mockedFs.readdirSync.mockReturnValueOnce([
                createMockDirent('test1.spec.tsx', false),
                createMockDirent('test2.spec.tsx', false),
                createMockDirent('test3.spec.tsx', false),
                createMockDirent('test4.spec.tsx', false)
            ]);
            
            // All are files, not directories
            mockedFs.statSync.mockReturnValue({
                isDirectory: () => false,
                isFile: () => true
            } as fs.Stats);
            
            // All files contain RTL content
            mockedFs.readFileSync.mockReturnValue('import { render } from "@testing-library/react"');
            
            const result = findRtlReferenceTests('/test/dir/current.spec.tsx');
            
            // Should limit to 3 results
            expect(result.length).toBe(3);
        });
        
        it('should filter by keywords if provided', () => {
            mockedPath.dirname.mockReturnValue('/test/dir');
            
            // Return 2 test files
            mockedFs.readdirSync.mockReturnValueOnce([
                createMockDirent('test1.spec.tsx', false),
                createMockDirent('test2.spec.tsx', false)
            ]);
            
            // All are files, not directories
            mockedFs.statSync.mockReturnValue({
                isDirectory: () => false,
                isFile: () => true
            } as fs.Stats);
            
            // First file has userEvent, second doesn't have RTL or userEvent
            mockedFs.readFileSync
                .mockReturnValueOnce('import userEvent from "@testing-library/user-event"')
                .mockReturnValueOnce('import { render } from "some-other-library"');
            
            const result = findRtlReferenceTests('/test/dir/current.spec.tsx', 1, ['userEvent']);
            
            // Should only return the file with userEvent
            expect(result.length).toBe(1);
            expect(result[0].path).toBe('/test/dir/test1.spec.tsx');
        });
        
        it('should handle errors gracefully', () => {
            mockedPath.dirname.mockImplementationOnce(() => {
                throw new Error('Invalid path');
            });
            
            const result = findRtlReferenceTests('/invalid/path');
            
            expect(result).toEqual([]);
        });
    });
});
