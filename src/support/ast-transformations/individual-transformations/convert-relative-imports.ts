import type { Collection, JSCodeshift } from 'jscodeshift';
import { astLogger } from '../utils/ast-logger';
import path from 'path';

/**
 * Calculates the relative path from one file to another
 * @param relativeToPath - Absolute path of the file containing the import statement
 * @param absolutePath - Absolute path of the file to be imported
 * @returns A relative path that can be used in an import statement
 */
export const getRelativePathFromAbsolutePath = (
    relativeToPath: string,
    absolutePath: string,
): string => {
    // Get directory paths
    const fromDir = path.dirname(relativeToPath);
    const toPath = absolutePath;
    
    // Calculate relative path from the importing file to the file to be imported
    let relativePath = path.relative(fromDir, toPath);
    
    // If the path doesn't start with a dot, add './'
    if (!relativePath.startsWith('.') && relativePath !== '') {
        relativePath = `./${relativePath}`;
    }
    
    // Normalize path separators to ensure they're consistent
    return relativePath.replace(/\\/g, '/');
};

/**
 * Get absolute path from a relative import path
 * @param relativePath - The relative import path
 * @param filePath - The absolute path of the file containing the import
 * @returns The absolute path to the imported file
 */
export const getAbsolutePathFromRelativePath = (
    relativePath: string,
    filePath: string,
): string => {
    const rootFolder = process.cwd();
    const absoluteBasePath = path.resolve(rootFolder, filePath);
    const absoluteSrcDir = path.dirname(absoluteBasePath);
    const resolvedPath = path.resolve(absoluteSrcDir, relativePath);

    // Check if the path already includes the root folder to avoid duplication
    if (resolvedPath.startsWith(rootFolder)) {
        return resolvedPath;
    }
    
    // Otherwise, prepend the root folder
    return path.join(rootFolder, resolvedPath);
};

/**
 * Generic function to convert all relative imports to absolute imports in a file
 * for both import declarations and jest.mock calls
 * @param j - JSCodeshift instance
 * @param root - AST Collection
 * @param filePath - The absolute path of the file being processed
 * @param excludePatterns - Optional array of patterns to exclude from conversion
 */
export const convertImportsToAbsolute = (
    j: JSCodeshift,
    root: Collection,
    filePath: string,
    excludePatterns: string[] = [],
): void => {
    astLogger.verbose('Converting relative imports to absolute paths');
    
    // Convert import declarations
    root.find(j.ImportDeclaration).forEach((astPath) => {
        const importPath = astPath.node.source.value as string;
        
        // Only process relative imports
        if (importPath.startsWith('.')) {
            // Skip if path matches any exclude pattern
            const shouldExclude = excludePatterns.some(pattern => 
                importPath.includes(pattern)
            );
            
            if (!shouldExclude) {
                const absoluteImportPath = getAbsolutePathFromRelativePath(
                    importPath,
                    filePath,
                );
                astPath.node.source.value = absoluteImportPath;
                astLogger.verbose(
                    `Changed import ${importPath} to ${absoluteImportPath}`,
                );
            }
        }
    });

    // Convert jest.mock calls
    root.find(j.CallExpression, {
        callee: {
            object: {
                name: 'jest',
            },
            property: {
                name: 'mock',
            },
        },
    }).forEach((astPath) => {
        const arg = astPath.value.arguments[0];
        if (j.StringLiteral.check(arg)) {
            const argValue = arg.value;
            if (argValue.startsWith('.')) {
                // Skip if path matches any exclude pattern
                const shouldExclude = excludePatterns.some(pattern => 
                    argValue.includes(pattern)
                );
                
                if (!shouldExclude) {
                    const absolutePath = getAbsolutePathFromRelativePath(
                        argValue,
                        filePath,
                    );
                    arg.value = absolutePath;
                    astLogger.verbose(
                        `Changed jest.mock path ${argValue} to ${absolutePath}`,
                    );
                }
            }
        }
    });
};

/**
 * Generic function to convert all absolute imports to relative imports in a file
 * for both import declarations and jest.mock calls
 * @param j - JSCodeshift instance
 * @param root - AST Collection
 * @param filePath - The absolute path of the file being processed
 * @param excludePatterns - Optional array of patterns to exclude from conversion
 */
export const convertImportsToRelative = (
    j: JSCodeshift,
    root: Collection,
    filePath: string,
    excludePatterns: string[] = [],
): void => {
    astLogger.verbose('Converting absolute imports to relative paths');
    
    // Convert import declarations
    root.find(j.ImportDeclaration).forEach((astPath) => {
        const importPath = astPath.node.source.value as string;
        
        // Only process absolute paths (ignoring node_modules and other non-filesystem paths)
        // We're checking for paths that look like absolute fs paths
        if (importPath.startsWith('/') || importPath.includes('\\') || 
            (path.isAbsolute(importPath) && !importPath.startsWith('@') && !importPath.match(/^[a-zA-Z0-9-_]+$/))) {
            
            // Skip if path matches any exclude pattern
            const shouldExclude = excludePatterns.some(pattern => 
                importPath.includes(pattern)
            );
            
            if (!shouldExclude) {
                const relativePath = getRelativePathFromAbsolutePath(
                    filePath,
                    importPath,
                );
                astPath.node.source.value = relativePath;
                astLogger.verbose(
                    `Changed import ${importPath} to ${relativePath}`,
                );
            }
        }
    });

    // Convert jest.mock calls
    root.find(j.CallExpression, {
        callee: {
            object: {
                name: 'jest',
            },
            property: {
                name: 'mock',
            },
        },
    }).forEach((astPath) => {
        const arg = astPath.value.arguments[0];
        if (j.StringLiteral.check(arg)) {
            const argValue = arg.value;
            
            // Only process absolute paths
            if (argValue.startsWith('/') || argValue.includes('\\') || 
                (path.isAbsolute(argValue) && !argValue.startsWith('@') && !argValue.match(/^[a-zA-Z0-9-_]+$/))) {
                
                // Skip if path matches any exclude pattern
                const shouldExclude = excludePatterns.some(pattern => 
                    argValue.includes(pattern)
                );
                
                if (!shouldExclude) {
                    const relativePath = getRelativePathFromAbsolutePath(
                        filePath,
                        argValue,
                    );
                    arg.value = relativePath;
                    astLogger.verbose(
                        `Changed jest.mock path ${argValue} to ${relativePath}`,
                    );
                }
            }
        }
    });
};

/**
 * Convert relative imports to absolute imports in both import declarations and jest.mock calls.
 * @param j
 * @param root
 * @param enzymeFilePath
 */
export const convertRelativeImports = (
    j: JSCodeshift,
    root: Collection,
    enzymeFilePath: string,
): void => {
    const convertPathToAbsolute = (
        relativePath: string,
        basePath: string,
    ): string => {
        const rootFolder = process.cwd();
        const absoluteBasePath = path.resolve(rootFolder, basePath);
        const absoluteSrcDir = path.dirname(absoluteBasePath);
        return path.resolve(absoluteSrcDir, relativePath);
    };

    // Convert relative paths in import declarations
    astLogger.verbose('Convert relative import paths');
    root.find(j.ImportDeclaration).forEach((astPath) => {
        const importPath = astPath.node.source.value as string;
        if (
            importPath.startsWith('.') &&
            !importPath.includes('./enzyme-mount-adapter')
        ) {
            const absoluteImportPath = convertPathToAbsolute(
                importPath,
                enzymeFilePath,
            );
            astPath.node.source.value = absoluteImportPath;
            astLogger.verbose(
                `Changed import ${importPath} to ${absoluteImportPath}`,
            );
        }
    });

    // Convert relative paths in jest.mock
    root.find(j.CallExpression, {
        callee: {
            object: {
                name: 'jest',
            },
            property: {
                name: 'mock',
            },
        },
    }).forEach((astPath) => {
        const arg = astPath.value.arguments[0];
        if (j.StringLiteral.check(arg)) {
            const argValue = arg.value;
            if (argValue.startsWith('.')) {
                const absoluteJestMockPath = convertPathToAbsolute(
                    argValue,
                    enzymeFilePath,
                );
                arg.value = absoluteJestMockPath;
                astLogger.verbose(
                    `Changed jest.mock path ${argValue} to ${absoluteJestMockPath}`,
                );
            }
        }
    });
};
