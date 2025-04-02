import { runCommand } from './shell-helper';

describe('runCommand Integration Test', () => {
    it('should execute "echo hello" command and return the output', async () => {
        const command = 'echo hello';

        const result = await runCommand(command);
        expect(result.command).toBe(command);
        expect(result.output).toBe('hello\n');
        expect(result.stderr).toBe('');
    });

    it('should handle a command that generates an error', async () => {
        const command = 'ls non_existing_directory';

        const result = await runCommand(command);

        expect(result.command).toBe(command);
        expect(result.output).toBe('');
        // Different OS may have different error message formats
        expect(result.stderr).toContain('non_existing_directory');
    });

    it('should kill the process if it runs longer than the allowed time', async () => {
        const command = 'sleep 10';
        const timeout = 2000; // Set a timeout of 2 seconds

        try {
            await runCommand(command, timeout);
        } catch (error) {
            // Ensure the error message indicates that the process was killed due to timeout
            const typedError = error as Error;
            expect(typedError).toBeDefined();
            expect(typedError.message).toContain(
                `Command timed out after ${timeout / 1000 / 60} minutes`,
            );
        }
    }, 40000);
});
