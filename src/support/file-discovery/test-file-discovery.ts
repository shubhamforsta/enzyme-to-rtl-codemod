import { runCommand } from '../shell-helper/shell-helper';
import fs from 'fs';
import { createCustomLogger } from '../logger/logger';
import { type Ora } from 'ora';

export const fileDiscoveryLogger = createCustomLogger('File Discovery');

/**
 * Discovers test files in the project that use Enzyme.
 * @param projectRoot - The root directory of the project to search in
 * @returns A promise resolving to an array of file paths
 */
export const discoverTestFiles = async (projectRoot: string, spinner: Ora): Promise<string[]> => {
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
        
        fileDiscoveryLogger.verbose(`Found ${filePaths.length} test files in total`);
        fileDiscoveryLogger.verbose('All test files found:');
        filePaths.forEach(file => fileDiscoveryLogger.verbose(`  - ${file}`));
        
        // Filter for files that use Enzyme
        const enzymeFiles = await filterEnzymeTestFiles(filePaths, spinner);
        
        fileDiscoveryLogger.verbose(`Identified ${enzymeFiles.length} files using Enzyme`);
        
        return enzymeFiles;
    } catch (error) {
        fileDiscoveryLogger.error(`Error executing find command: ${error}`);
        return [];
    }
};

/**
 * Helper function to detect Enzyme usage in test files
 * @param filePaths - Array of file paths to check
 * @returns Promise resolving to array of file paths that use Enzyme
 */
const filterEnzymeTestFiles = async (filePaths: string[], spinner: Ora): Promise<string[]> => {
    
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
    
    spinner.text = `Processing 0/${filePaths.length} files... [0%]`;
    
    for (const filePath of filePaths) {
        try {
            filesProcessed++;
            if (filesProcessed % 10 === 0) {
                spinner.text = `Processing ${filesProcessed}/${filePaths.length} files... [${Math.round((filesProcessed / filePaths.length) * 100)}%]`;
            }
            
            const content = fs.readFileSync(filePath, 'utf8');
            
            // Check for Enzyme imports or usage
            const hasEnzyme = enzymePatterns.some(pattern => content.includes(pattern));
            
            if (hasEnzyme) {
                enzymeFiles.push(filePath);
            }
        } catch (error) {
            filesWithErrors++;
            fileDiscoveryLogger.verbose(`Error processing file ${filePath}: ${error}`);
        }
    }
    
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
