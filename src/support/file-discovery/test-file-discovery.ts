import { runCommand } from '../shell-helper/shell-helper';
import fs from 'fs';
import path from 'path';
import { createCustomLogger } from '../logger/logger';
import ora from 'ora';

export const fileDiscoveryLogger = createCustomLogger('File Discovery');

/**
 * Discovers test files in the project that use Enzyme.
 * @param projectRoot - The root directory of the project to search in
 * @param logLevel - Optional log level to control verbosity ('info' or 'verbose')
 * @returns A promise resolving to an array of file paths
 */
export const discoverTestFiles = async (projectRoot: string, logLevel?: string): Promise<string[]> => {
    fileDiscoveryLogger.info(`Searching for test files in directory: ${projectRoot}`);
    
    // Build a command to find all test files using a more reliable approach for macOS
    // First find all JS/TS files, then filter for test files
    const findCommand = `find ${projectRoot} -type f \\( -name "*.js" -o -name "*.jsx" -o -name "*.ts" -o -name "*.tsx" \\) -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/build/*" | grep -E '(\\.test\\.|\\.spec\\.|/__tests__/)'`;
    
    try {
        const result = await runCommand(findCommand);
        
        // Check for errors
        if (result.stderr) {
            fileDiscoveryLogger.error(`Error in find command: ${result.stderr}`);
        }
        
        // Parse the output into an array of file paths
        const filePaths = result.output.trim().split('\n').filter(Boolean);
        
        if (logLevel === 'verbose') {
            fileDiscoveryLogger.info(`Found ${filePaths.length} test files in total`);
            fileDiscoveryLogger.info('All test files found:');
            filePaths.forEach(file => fileDiscoveryLogger.info(`  - ${file}`));
        }
        
        // Filter for files that use Enzyme
        const enzymeFiles = await filterEnzymeTestFiles(filePaths, logLevel);
        
        if (logLevel === 'verbose') {
            fileDiscoveryLogger.info(`Identified ${enzymeFiles.length} files using Enzyme`);
        }
        
        return enzymeFiles;
    } catch (error) {
        fileDiscoveryLogger.error(`Error executing find command: ${error}`);
        return [];
    }
};

/**
 * Helper function to detect Enzyme usage in test files
 * @param filePaths - Array of file paths to check
 * @param logLevel - Optional log level to control verbosity
 * @returns Promise resolving to array of file paths that use Enzyme
 */
const filterEnzymeTestFiles = async (filePaths: string[], logLevel?: string): Promise<string[]> => {
    
    const enzymeFiles: string[] = [];
    const enzymePatterns = [
        'import { mount',
        'import {mount',
        'import { shallow',
        'import {shallow',
        'from "enzyme"',
        "from 'enzyme'",
        'require("enzyme")',
        "require('enzyme')",
        '.mount(',
        '.shallow('
    ];
    
    let filesProcessed = 0;
    let filesWithErrors = 0;
    
    // Create a spinner
    const spinner = ora({
        text: `Processing 0/${filePaths.length} files...`,
        color: 'blue',
    }).start();
    
    for (const filePath of filePaths) {
        try {
            filesProcessed++;
            if (filesProcessed % 10 === 0 || logLevel === 'verbose') {
                // Update spinner text
                spinner.text = `Processing ${filesProcessed}/${filePaths.length} files... [${Math.round((filesProcessed / filePaths.length) * 100)}%]`;
                
                if (logLevel === 'verbose') {
                    // In verbose mode, also log the progress
                    fileDiscoveryLogger.info(`Processed ${filesProcessed}/${filePaths.length} files...`);
                }
            }
            
            const content = fs.readFileSync(filePath, 'utf8');
            
            // Check for Enzyme imports or usage
            const hasEnzyme = enzymePatterns.some(pattern => content.includes(pattern));
            
            if (hasEnzyme) {
                enzymeFiles.push(filePath);
                if (logLevel === 'verbose') {
                    fileDiscoveryLogger.info(`Found Enzyme usage in: ${path.basename(filePath)}`);
                    // Log which pattern matched
                    const matchedPatterns = enzymePatterns
                        .filter(pattern => content.includes(pattern))
                        .join(', ');
                    fileDiscoveryLogger.info(`  - Matched patterns: ${matchedPatterns}`);
                }
            }
        } catch (error) {
            filesWithErrors++;
            fileDiscoveryLogger.error(`Error processing file ${filePath}: ${error}`);
        }
    }
    
    // Stop the spinner and show completion message
    spinner.succeed(`Completed processing ${filesProcessed} files. Found ${enzymeFiles.length} files with Enzyme usage.`);
    
    if (filesWithErrors > 0) {
        fileDiscoveryLogger.warn(`Encountered errors in ${filesWithErrors} files.`);
    }
    
    fileDiscoveryLogger.info(`Analysis complete:`);
    fileDiscoveryLogger.info(`  - Total files processed: ${filesProcessed}`);
    fileDiscoveryLogger.info(`  - Files with errors: ${filesWithErrors}`);
    fileDiscoveryLogger.info(`  - Files using Enzyme: ${enzymeFiles.length}`);
    
    return enzymeFiles;
};
