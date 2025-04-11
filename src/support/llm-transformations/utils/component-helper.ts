import fs from 'fs';
import path from 'path';
import { createCustomLogger } from '../../logger/logger';
import { processCodeImports } from '../../code-extractor/extract-code';

const componentHelperLogger = createCustomLogger('Component Helper');

/**
 * Resolves a relative import path from any file to an absolute path
 * @param relativePath The relative path to the component from the source file
 * @param sourceFilePath The absolute path to the source file
 * @returns The absolute path to the component
 */
export const getFileFromRelativeImports = (
    relativePath: string,
    sourceFilePath: string,
): string => {
    componentHelperLogger.verbose(`Resolving relative path: ${relativePath} from file: ${sourceFilePath}`);
    
    const rootFolder = process.cwd();
    const absoluteBasePath = path.resolve(rootFolder, sourceFilePath);
    const absoluteSrcDir = path.dirname(absoluteBasePath);
    const absoluteComponentPath = path.resolve(absoluteSrcDir, relativePath);
    
    componentHelperLogger.verbose(`Resolved absolute path: ${absoluteComponentPath}`);
    
    return absoluteComponentPath;
};

/**
 * Gets the content of a component file from its absolute path
 * @param absolutePath The absolute path to the component file
 * @returns The content of the component file or null if the file doesn't exist
 */
export const getComponentContent = (absolutePath: string): string | null => {
    try {
        // First check if the file exists as is
        if (fs.existsSync(absolutePath)) {
            // Check if it's a directory
            const stats = fs.statSync(absolutePath);
            if (!stats.isDirectory()) {
                // It's a regular file, read it directly
                return fs.readFileSync(absolutePath, 'utf-8');
            } else {
                // It's a directory, look for index files
                const extensions = ['.js', '.jsx', '.ts', '.tsx'];
                for (const ext of extensions) {
                    const indexPath = path.join(absolutePath, `index${ext}`);
                    if (fs.existsSync(indexPath)) {
                        return fs.readFileSync(indexPath, 'utf-8');
                    }
                }
                // No index files found
                return null;
            }
        }
        
        // Try adding common extensions if no extension was provided
        const extensions = ['.js', '.jsx', '.ts', '.tsx'];
        for (const ext of extensions) {
            const pathWithExt = `${absolutePath}${ext}`;
            if (fs.existsSync(pathWithExt)) {
                return fs.readFileSync(pathWithExt, 'utf-8');
            }
        }
        
        componentHelperLogger.warn(`Component file not found at: ${absolutePath}`);
        return null;
    } catch (error) {
        componentHelperLogger.error(`Error reading component file: ${error}`);
        return null;
    }
};

/**
 * Updates a component file with new content to support testing
 * Only makes minimal changes needed for testing, such as adding data-testid attributes
 * 
 * @param absolutePath - The absolute path to the component file
 * @param newContent - The updated content for the component file
 * @returns Object with success status and message
 */
export const updateComponentContent = (absolutePath: string, newContent: string): { success: boolean; message: string } => {
    const processedContent = processCodeImports(newContent, absolutePath);

    try {
        // First check if the file exists
        if (!fs.existsSync(absolutePath)) {
            // Try adding common extensions if no extension was provided
            const extensions = ['.js', '.jsx', '.ts', '.tsx'];
            let fileFound = false;
            
            for (const ext of extensions) {
                const pathWithExt = `${absolutePath}${ext}`;
                if (fs.existsSync(pathWithExt)) {
                    absolutePath = pathWithExt;
                    fileFound = true;
                    break;
                }
            }
            
            if (!fileFound) {
                return { 
                    success: false, 
                    message: `Component file not found at: ${absolutePath}` 
                };
            }
        }
        
        // Check if it's a directory
        const stats = fs.statSync(absolutePath);
        if (stats.isDirectory()) {
            return { 
                success: false, 
                message: `Cannot update a directory: ${absolutePath}` 
            };
        }
        
        // Write the new content to the file
        fs.writeFileSync(absolutePath, processedContent, 'utf-8');
        
        componentHelperLogger.info(`Component file updated successfully at: ${absolutePath}`);
        return { 
            success: true, 
            message: `Component file updated successfully at: ${absolutePath}` 
        };
    } catch (error) {
        componentHelperLogger.error(`Error updating component file: ${error}`);
        return { 
            success: false, 
            message: `Error updating component file: ${error instanceof Error ? error.message : String(error)}` 
        };
    }
};
