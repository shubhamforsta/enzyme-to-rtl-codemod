import { Logger, createLogger, format, transports } from 'winston';
import path from 'path';

// Global variable to store the current log level
const currentLogLevel = process.env.LOG_LEVEL || 'info';

// Define log file path in project root
const getVerboseLogFilePath = (): string => {
    // Get the project root directory
    const projectRoot = process.cwd();
    
    return path.join(projectRoot, 'verbose.log');
};

// Create custom logging format
const logPrintFormat = format.printf(
    ({ level, message, label, timestamp }) =>
        `${timestamp} - [${label}] - ${level}: ${message}`,
);

// Array to store all logger instances
const loggers: Logger[] = [];

// Function to create a logger with a custom label
const createCustomLogger = (label: string): Logger => {
    // Create console transport with filter for non-verbose logs
    const consoleTransport = new transports.Console({
        format: format.combine(
            format.colorize(),
            format.label({ label }),
            format.timestamp(),
            logPrintFormat
        ),
        level: 'info'  // Console only gets info and above (error, warn, info)
    });
    
    // Create file transport for all logs (including verbose)
    const fileTransport = new transports.File({
        filename: getVerboseLogFilePath(),
        format: format.combine(
            format.label({ label }),
            format.timestamp(),
            logPrintFormat
        ),
        level: currentLogLevel  // File gets all logs based on current log level
    });
    
    const logger = createLogger({
        level: currentLogLevel, // Use the global log level variable
        silent: process.env.NODE_ENV === 'test',
        transports: [consoleTransport, fileTransport],
    });

    // Store the logger instance in the array
    loggers.push(logger);

    return logger;
};

// Function to update the log level for all loggers
const updateLogLevelForAllLoggers = (logLevel: string): void => {
    loggers.forEach((logger) => {
        logger.level = logLevel;
        
        // Update file transport level
        const fileTransport = logger.transports.find(
            t => t instanceof transports.File
        ) as transports.FileTransportInstance;
        
        if (fileTransport) {
            fileTransport.level = logLevel;
        }
    });
};

// Export the necessary components
export { createCustomLogger, updateLogLevelForAllLoggers, getVerboseLogFilePath };
