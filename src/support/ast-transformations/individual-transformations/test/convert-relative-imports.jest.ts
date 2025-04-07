import { convertRelativeImports, getRelativePathFromAbsolutePath } from '../convert-relative-imports';
import jscodeshift from 'jscodeshift';

describe('convertText', () => {
    let j: jscodeshift.JSCodeshift;

    beforeEach(() => {
        j = jscodeshift.withParser('tsx');
    });

    it('Should convert relative to absolute imports', () => {
        const source = `
            import { mount } from 'enzyme';
            import { addComment } from '../../utils/add-comment';
            import { countTestCases } from '../../../prompt-generation/utils/utils';
            import { anotherMethod } from '@aliasLocation/utils'
            import { shallow } from './enzyme-mount-adapter';
        `;

        // Transform the source code
        const root = j(source);
        convertRelativeImports(
            j,
            root,
            'src/support/ast-transformations/individual-transformations/test/convert-enzyme-imports.jest.ts',
        );

        // Generate the transformed source code
        const transformedSource = root.toSource();

        // Verify enzyme import is present
        expect(transformedSource).toContain("import { mount } from 'enzyme';");
        // Verify alias import is present
        expect(transformedSource).toContain(
            "import { anotherMethod } from '@aliasLocation/utils'",
        );
        // Verify a part of the abosolute path is present for both imports
        expect(transformedSource).toContain(
            'enzyme-to-rtl-codemod/src/support/ast-transformations/utils/add-comment',
        );
        expect(transformedSource).toContain(
            'enzyme-to-rtl-codemod/src/support/prompt-generation/utils/utils',
        );
        // Verify custom enzyme adapter is not converted
        expect(transformedSource).toContain(
            "import { shallow } from './enzyme-mount-adapter';",
        );
    });

    it('Should convert relative paths in jest.mock calls', () => {
        const source = "jest.mock('./utils/ast-logger');";

        // Transform the source code
        const root = j(source);
        convertRelativeImports(
            j,
            root,
            'src/support/ast-transformations/main-ast-transform.jest.ts',
        );

        // Generate the transformed source code
        const transformedSource = root.toSource();

        // Verify jest.mock relative paths are converted to absolute
        expect(transformedSource).toContain(
            'enzyme-to-rtl-codemod/src/support/ast-transformations/utils/ast-logger',
        );
    });
});

describe('getRelativePathFromAbsolutePath', () => {
    it('should return correct relative path when files are in different directories', () => {
        const relativeToPath = '/Users/project/src/__tests__/Button.spec.tsx';
        const absolutePath = '/Users/project/src/utils/test-file.ts';
        
        const result = getRelativePathFromAbsolutePath(relativeToPath, absolutePath);
        
        expect(result).toBe('../utils/test-file.ts');
    });
    
    it('should return correct relative path when files are in the same directory', () => {
        const relativeToPath = '/Users/project/src/utils/helper.ts';
        const absolutePath = '/Users/project/src/utils/test-file.ts';
        
        const result = getRelativePathFromAbsolutePath(relativeToPath, absolutePath);
        
        expect(result).toBe('./test-file.ts');
    });
    
    it('should return correct relative path when target is in a parent directory', () => {
        const relativeToPath = '/Users/project/src/components/Button/Button.tsx';
        const absolutePath = '/Users/project/src/utils/test-file.ts';
        
        const result = getRelativePathFromAbsolutePath(relativeToPath, absolutePath);
        
        expect(result).toBe('../../utils/test-file.ts');
    });
    
    it('should return correct relative path for nested directories', () => {
        const relativeToPath = '/Users/project/src/components/forms/inputs/TextInput.tsx';
        const absolutePath = '/Users/project/src/components/Button/Button.test.tsx';
        
        const result = getRelativePathFromAbsolutePath(relativeToPath, absolutePath);
        
        expect(result).toBe('../../Button/Button.test.tsx');
    });
    
    it('should handle paths with file name only', () => {
        const relativeToPath = '/Users/project/src/utils/index.ts';
        const absolutePath = '/Users/project/src/utils/test-file.ts';
        
        const result = getRelativePathFromAbsolutePath(relativeToPath, absolutePath);
        
        expect(result).toBe('./test-file.ts');
    });
});
