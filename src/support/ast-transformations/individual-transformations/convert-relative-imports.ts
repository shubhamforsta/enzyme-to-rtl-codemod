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
