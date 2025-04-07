import fs from 'fs';
import path from 'path';

// Mock the logger before importing the module under test
jest.mock('../../logger/logger', () => ({
  createCustomLogger: jest.fn().mockReturnValue({
    verbose: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn()
  })
}));

// Mock fs and path modules
jest.mock('fs');
jest.mock('path');

// Import after mocking dependencies
import { getFileFromRelativeImports, getComponentContent } from './component-helper';



describe('Component Helper', () => {
  // Save the original process.cwd
  const originalCwd = process.cwd;
  
  beforeEach(() => {
    // Reset all mocks before each test
    jest.resetAllMocks();
    
    // Mock process.cwd
    process.cwd = jest.fn().mockReturnValue('/project/root');
    
    // Mock path.resolve to simulate path resolution
    (path.resolve as jest.Mock).mockImplementation((...paths: string[]) => {
      return paths.join('/');
    });
    
    // Mock path.dirname to return the directory name
    (path.dirname as jest.Mock).mockImplementation((p: string) => {
      return p.split('/').slice(0, -1).join('/');
    });
    
    // Mock path.join
    (path.join as jest.Mock).mockImplementation((...segments: string[]) => {
      return segments.join('/');
    });
  });
  
  afterEach(() => {
    // Restore the original process.cwd
    process.cwd = originalCwd;
  });
  
  describe('getFileFromRelativeImportsFromTestFile', () => {
    it('should resolve a relative path to an absolute path', () => {
      // Arrange
      const relativePath = '../components/Button';
      const testFilePath = '/project/root/src/tests/Button.test.tsx';
      
      // Mock implementation to better simulate actual path resolution behavior
      (path.resolve as jest.Mock).mockImplementation((...paths: string[]) => {
        if (paths[0] === '/project/root' && paths[1] === testFilePath) {
          return testFilePath;
        }
        if (paths[0] === '/project/root/src/tests' && paths[1] === relativePath) {
          return '/project/root/src/components/Button';
        }
        return paths.join('/');
      });
      
      // Act
      const result = getFileFromRelativeImports(relativePath, testFilePath);
      
      // Assert
      expect(result).toBe('/project/root/src/components/Button');
      expect(path.resolve).toHaveBeenCalledWith('/project/root', testFilePath);
      expect(path.dirname).toHaveBeenCalledWith(testFilePath);
      expect(path.resolve).toHaveBeenCalledWith('/project/root/src/tests', relativePath);
    });
    
    it('should handle paths with file extensions', () => {
      // Arrange
      const relativePath = './Button.tsx';
      const testFilePath = '/project/root/src/tests/Button.test.tsx';
      
      // Mock implementation to better simulate actual path resolution behavior
      (path.resolve as jest.Mock).mockImplementation((...paths: string[]) => {
        if (paths[0] === '/project/root' && paths[1] === testFilePath) {
          return testFilePath;
        }
        if (paths[0] === '/project/root/src/tests' && paths[1] === relativePath) {
          return '/project/root/src/tests/Button.tsx';
        }
        return paths.join('/');
      });
      
      // Act
      const result = getFileFromRelativeImports(relativePath, testFilePath);
      
      // Assert
      expect(result).toBe('/project/root/src/tests/Button.tsx');
      expect(path.resolve).toHaveBeenCalledWith('/project/root', testFilePath);
      expect(path.dirname).toHaveBeenCalledWith(testFilePath);
      expect(path.resolve).toHaveBeenCalledWith('/project/root/src/tests', relativePath);
    });
  });
  
  describe('getComponentContent', () => {
    it('should return file content when file exists', () => {
      // Arrange
      const absolutePath = '/project/root/src/components/Button.tsx';
      const fileContent = 'export const Button = () => <button>Click me</button>';
      
      // Mock fs.existsSync and fs.readFileSync
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      // Mock fs.statSync to return non-directory for direct file
      (fs.statSync as jest.Mock).mockReturnValue({
        isDirectory: () => false
      });
      (fs.readFileSync as jest.Mock).mockReturnValue(fileContent);
      
      // Act
      const result = getComponentContent(absolutePath);
      
      // Assert
      expect(result).toBe(fileContent);
      expect(fs.existsSync).toHaveBeenCalledWith(absolutePath);
      expect(fs.readFileSync).toHaveBeenCalledWith(absolutePath, 'utf-8');
    });
    
    it('should try different extensions when file without extension does not exist', () => {
      // Arrange
      const absolutePath = '/project/root/src/components/Button';
      const fileContent = 'export const Button = () => <button>Click me</button>';
      
      // Mock fs.existsSync to return false for the original path and true for one with extension
      (fs.existsSync as jest.Mock).mockImplementation((path: string) => {
        return path === '/project/root/src/components/Button.tsx';
      });
      
      // Mock fs.readFileSync
      (fs.readFileSync as jest.Mock).mockReturnValue(fileContent);
      
      // Act
      const result = getComponentContent(absolutePath);
      
      // Assert
      expect(result).toBe(fileContent);
      expect(fs.existsSync).toHaveBeenCalledWith(absolutePath);
      expect(fs.existsSync).toHaveBeenCalledWith(`${absolutePath}.js`);
      expect(fs.existsSync).toHaveBeenCalledWith(`${absolutePath}.jsx`);
      expect(fs.existsSync).toHaveBeenCalledWith(`${absolutePath}.ts`);
      expect(fs.existsSync).toHaveBeenCalledWith(`${absolutePath}.tsx`);
      expect(fs.readFileSync).toHaveBeenCalledWith(`${absolutePath}.tsx`, 'utf-8');
    });
    
    it('should return null when file does not exist with any extension', () => {
      // Arrange
      const absolutePath = '/project/root/src/components/Button';
      
      // Mock fs.existsSync to return false for all paths
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      
      // Act
      const result = getComponentContent(absolutePath);
      
      // Assert
      expect(result).toBeNull();
      expect(fs.existsSync).toHaveBeenCalledWith(absolutePath);
      expect(fs.existsSync).toHaveBeenCalledWith(`${absolutePath}.js`);
      expect(fs.existsSync).toHaveBeenCalledWith(`${absolutePath}.jsx`);
      expect(fs.existsSync).toHaveBeenCalledWith(`${absolutePath}.ts`);
      expect(fs.existsSync).toHaveBeenCalledWith(`${absolutePath}.tsx`);
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });
    
    it('should return null when an error occurs while reading the file', () => {
      // Arrange
      const absolutePath = '/project/root/src/components/Button.tsx';
      
      // Mock fs.existsSync to return true
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      
      // Mock fs.statSync to return non-directory
      (fs.statSync as jest.Mock).mockReturnValue({
        isDirectory: () => false
      });
      
      // Mock fs.readFileSync to throw an error
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('File read error');
      });
      
      // Act
      const result = getComponentContent(absolutePath);
      
      // Assert
      expect(result).toBeNull();
      expect(fs.existsSync).toHaveBeenCalledWith(absolutePath);
      expect(fs.readFileSync).toHaveBeenCalledWith(absolutePath, 'utf-8');
    });
    
    it('should handle directory paths with index files', () => {
      // Arrange
      const absolutePath = '/project/root/src/components/Button';
      const fileContent = 'export const Button = () => <button>Click me</button>';
      
      // Mock fs.existsSync to respond correctly to all expected calls
      (fs.existsSync as jest.Mock).mockImplementation((path: string) => {
        // Direct path exists
        if (path === absolutePath) return true;
        // Index with .tsx extension exists
        if (path === '/project/root/src/components/Button/index.tsx') return true;
        // Other index files don't exist
        if (path === '/project/root/src/components/Button/index.js' ||
            path === '/project/root/src/components/Button/index.jsx' ||
            path === '/project/root/src/components/Button/index.ts') return false;
        // Extension paths don't exist
        if (path === `${absolutePath}.js` ||
            path === `${absolutePath}.jsx` ||
            path === `${absolutePath}.ts` ||
            path === `${absolutePath}.tsx`) return false;
        return false;
      });
      
      // Mock fs.statSync to return a directory stat for our path
      (fs.statSync as jest.Mock).mockReturnValue({
        isDirectory: () => true
      });
      
      // Mock fs.readFileSync to return our content
      (fs.readFileSync as jest.Mock).mockReturnValue(fileContent);
      
      // Act
      const result = getComponentContent(absolutePath);
      
      // Assert
      expect(result).toBe(fileContent);
      expect(fs.existsSync).toHaveBeenCalledWith(absolutePath);
      expect(fs.statSync).toHaveBeenCalledWith(absolutePath);
      // We should check for index.tsx file
      expect(fs.existsSync).toHaveBeenCalledWith('/project/root/src/components/Button/index.js');
      expect(fs.existsSync).toHaveBeenCalledWith('/project/root/src/components/Button/index.jsx');
      expect(fs.existsSync).toHaveBeenCalledWith('/project/root/src/components/Button/index.ts');
      expect(fs.existsSync).toHaveBeenCalledWith('/project/root/src/components/Button/index.tsx');
      expect(fs.readFileSync).toHaveBeenCalledWith('/project/root/src/components/Button/index.tsx', 'utf-8');
    });
    
    it('should return null when directory has no index files', () => {
      // Arrange
      const absolutePath = '/project/root/src/components/Button';
      
      // Mock fs.existsSync to return true for the path but false for all index files
      (fs.existsSync as jest.Mock).mockImplementation((path: string) => {
        // Direct path exists
        if (path === absolutePath) return true;
        // No extension paths exist
        if (path === `${absolutePath}.js` ||
            path === `${absolutePath}.jsx` ||
            path === `${absolutePath}.ts` ||
            path === `${absolutePath}.tsx`) return false;
        // No index files exist
        if (path === '/project/root/src/components/Button/index.js' ||
            path === '/project/root/src/components/Button/index.jsx' ||
            path === '/project/root/src/components/Button/index.ts' ||
            path === '/project/root/src/components/Button/index.tsx') return false;
        return false;
      });
      
      // Mock fs.statSync to return a directory stat
      (fs.statSync as jest.Mock).mockReturnValue({
        isDirectory: () => true
      });
      
      // Act
      const result = getComponentContent(absolutePath);
      
      // Assert
      expect(result).toBeNull();
      expect(fs.existsSync).toHaveBeenCalledWith(absolutePath);
      expect(fs.statSync).toHaveBeenCalledWith(absolutePath);
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });
  });
});
