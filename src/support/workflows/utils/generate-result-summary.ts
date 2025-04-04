import { TestResults } from '../convert-test-files';
import { IndividualTestResult } from '../../enzyme-helper/run-test-analysis';

export interface Summary {
    totalTests: number;
    totalSuccessRate: number;
    convertedAndPassed: number;
    convertedAndFailed: number;
}

export interface SummaryJson {
    summary: Summary;
    [filePath: string]: IndividualTestResult | Summary;
}

/**
 *
 * @param testResults
 * @returns
 */
export function generateSummaryJson(testResults: TestResults): SummaryJson {
    // Initialize summary variables
    let totalTests = 0;
    let totalSuccessRate = 0;
    let convertedAndPassed = 0;
    let convertedAndFailed = 0;

    // Iterate over the test results to calculate totals
    for (const filePath in testResults) {
        if (Object.prototype.hasOwnProperty.call(testResults, filePath)) {
            const { failedTests, passedTests, totalTests: _totalTests, successRate } = testResults[filePath];

            totalTests += _totalTests;
            totalSuccessRate += (successRate / 100) * _totalTests;
            convertedAndPassed += passedTests;
            convertedAndFailed += failedTests;
        }
    }

    // Handle the case where there are no tests to avoid division by zero
    totalSuccessRate =
        totalTests > 0 ? (totalSuccessRate / totalTests) * 100 : 0;

    // Create the summary object
    const summary: Summary = {
        totalTests,
        totalSuccessRate,
        convertedAndPassed,
        convertedAndFailed,
    };

    // Create the final JSON structure
    const summaryJson: SummaryJson = {
        summary,
        ...testResults, // Keep both attempt1 and attempt2 for each filePath
    };

    return summaryJson;
}
