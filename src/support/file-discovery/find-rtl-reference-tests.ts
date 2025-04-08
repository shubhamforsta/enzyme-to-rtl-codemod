import fs from 'fs';
import path from 'path';
import { createCustomLogger } from '../logger/logger';

// Create a default logger, but allow it to be injected for testing
const defaultLogger = createCustomLogger('RTL Reference Tests');

// RTL imports and functions to identify RTL tests
export const RTL_PATTERNS = [
    '@testing-library/react',
    '@testing-library/jest-dom',
    'render(',
    'screen.',
    'getBy',
    'findBy',
    'queryBy',
    'getAllBy',
    'findAllBy',
    'queryAllBy',
    'waitFor(',
    'userEvent',
    'fireEvent'
];

/**
 * Find all test files in a directory
 * @param dir Directory to search in
 * @param logger Optional logger for testing
 * @returns Array of test file paths
 */
export const findTestFiles = (
    dir: string, 
    logger = defaultLogger
): string[] => {
    const files: string[] = [];
    try {
        const items = fs.readdirSync(dir) as (string | fs.Dirent)[];
        for (const item of items) {
            // Handle both string and Dirent objects
            const itemName = typeof item === 'string' ? item : item.name;
            const fullPath = path.join(dir, itemName);
            const stats = fs.statSync(fullPath);
            
            if (stats.isDirectory()) {
                // Skip node_modules and any hidden directories
                if (itemName !== 'node_modules' && !itemName.startsWith('.')) {
                    // Recursively search subdirectories
                    files.push(...findTestFiles(fullPath, logger));
                }
            } else if (stats.isFile()) {
                // Check if it's a test file
                if (/\.(spec|test)\.(js|jsx|ts|tsx)$/.test(itemName)) {
                    files.push(fullPath);
                }
            }
        }
    } catch (error) {
        logger.verbose(`Error searching directory ${dir}: ${error}`);
    }
    return files;
};

/**
 * Determines if a file is likely an RTL test based on its content
 * @param filePath Path to the file
 * @param patterns Array of patterns to look for
 * @param logger Optional logger for testing
 * @returns true if the file contains any of the patterns
 */
export const isRtlTest = (
    filePath: string, 
    patterns: string[] = RTL_PATTERNS,
    logger = defaultLogger
): boolean => {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return patterns.some(pattern => content.includes(pattern));
    } catch (error) {
        logger.verbose(`Error reading file ${filePath}: ${error}`);
        return false;
    }
};

/**
 * Finds RTL test files in nearby directories
 * @param testPath The absolute path to the current test file
 * @param searchDepth How many directory levels up to search
 * @param keywords Optional keywords to filter test files by content
 * @param logger Optional logger for testing
 * @returns An array of file paths and their contents
 */
export const findRtlReferenceTests = (
    testPath: string, 
    searchDepth: number = 2,
    keywords: string[] = [],
    logger = defaultLogger
): { path: string, content: string }[] => {
    try {
        const searchPatterns = [...RTL_PATTERNS, ...(keywords || [])];
        const results: { path: string, content: string }[] = [];
        
        // Get the directory of the test file
        const testDir = path.dirname(testPath);
        
        // Start with the current directory and add parent directories based on searchDepth
        const searchDirs: string[] = [];
        let currentDir = testDir;
        
        for (let i = 0; i < searchDepth; i++) {
            searchDirs.push(currentDir);
            // Move up one directory level
            const parentDir = path.dirname(currentDir);
            // Stop if we've reached the filesystem root
            if (parentDir === currentDir) break;
            currentDir = parentDir;
        }
        
        // Search for test files in all directories
        for (const dir of searchDirs) {
            // Find all test files
            const testFiles = findTestFiles(dir, logger);
            
            // Skip the current test file being converted
            const filteredTestFiles = testFiles.filter(file => file !== testPath);
            
            // Check each file for RTL patterns
            for (const file of filteredTestFiles) {
                try {
                    const content = fs.readFileSync(file, 'utf8');
                    
                    // Check if this is an RTL test by looking for RTL imports and functions
                    const isRtl = searchPatterns.some(pattern => content.includes(pattern));
                    
                    // If we found an RTL test, add it to results
                    if (isRtl) {
                        results.push({
                            path: file,
                            content
                        });
                        
                        // Limit the number of reference tests to avoid overwhelming the LLM
                        if (results.length >= 3) break;
                    }
                } catch (error) {
                    logger.verbose(`Error reading potential reference test file ${file}: ${error}`);
                }
            }
            
            // If we found enough references, stop searching
            if (results.length >= 3) break;
        }
        
        return results;
    } catch (error) {
        logger.verbose(`Error finding reference tests: ${error}`);
        return [];
    }
};
