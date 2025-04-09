/**
 * Test data for convert-test-files tests
 */

// Sample Enzyme test file content
export const mockEnzymeTestContent = `
import React from 'react';
import { mount } from 'enzyme';
import TodoList from '../components/TodoList';

describe('TodoList Component', () => {
  it('should render todos correctly', () => {
    const todos = [
      { id: 1, text: 'Buy groceries', completed: false },
      { id: 2, text: 'Clean house', completed: true }
    ];
    const wrapper = mount(<TodoList todos={todos} />);
    expect(wrapper.find('.todo-item')).toHaveLength(2);
    expect(wrapper.find('.completed')).toHaveLength(1);
  });

  it('should handle adding new todo', () => {
    const addTodo = jest.fn();
    const wrapper = mount(<TodoList todos={[]} addTodo={addTodo} />);
    const input = wrapper.find('input');
    input.simulate('change', { target: { value: 'New task' } });
    wrapper.find('form').simulate('submit');
    expect(addTodo).toHaveBeenCalledWith('New task');
  });
});
`;

// Sample converted RTL test content
export const mockRtlTestContent = `
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TodoList from '../components/TodoList';

describe('TodoList Component', () => {
  it('should render todos correctly', () => {
    const todos = [
      { id: 1, text: 'Buy groceries', completed: false },
      { id: 2, text: 'Clean house', completed: true }
    ];
    render(<TodoList todos={todos} />);
    const todoItems = screen.getAllByTestId('todo-item');
    expect(todoItems).toHaveLength(2);
    expect(screen.getByText('Clean house').closest('[data-testid="todo-item"]')).toHaveClass('completed');
  });

  it('should handle adding new todo', () => {
    const addTodo = jest.fn();
    render(<TodoList todos={[]} addTodo={addTodo} />);
    const input = screen.getByPlaceholderText('Add a new todo');
    fireEvent.change(input, { target: { value: 'New task' } });
    fireEvent.submit(screen.getByTestId('todo-form'));
    expect(addTodo).toHaveBeenCalledWith('New task');
  });
});
`;

// Mock LLM response structure
export const mockLLMSuccessResponse = {
  finish_reason: 'complete',
  message: {
    content: '',
    tool_calls: [
      {
        id: 'call1',
        type: 'function',
        function: {
          name: 'evaluateAndRun',
          arguments: JSON.stringify({ file: mockRtlTestContent })
        }
      }
    ]
  }
};

// Mock another test case
export const mockEnzymeSecondTestContent = `
import React from 'react';
import { shallow } from 'enzyme';
import Counter from '../components/Counter';

describe('Counter Component', () => {
  it('should display the initial count', () => {
    const wrapper = shallow(<Counter initialCount={5} />);
    expect(wrapper.find('.count-display').text()).toEqual('5');
  });

  it('should increment count when button is clicked', () => {
    const wrapper = shallow(<Counter initialCount={0} />);
    wrapper.find('.increment-button').simulate('click');
    expect(wrapper.find('.count-display').text()).toEqual('1');
  });
});
`;

// Sample RTL test content for the second test
export const mockRtlSecondTestContent = `
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Counter from '../components/Counter';

describe('Counter Component', () => {
  it('should display the initial count', () => {
    render(<Counter initialCount={5} />);
    expect(screen.getByTestId('count-display').textContent).toEqual('5');
  });

  it('should increment count when button is clicked', () => {
    render(<Counter initialCount={0} />);
    fireEvent.click(screen.getByTestId('increment-button'));
    expect(screen.getByTestId('count-display').textContent).toEqual('1');
  });
});
`;

// Mock LLM response for second test
export const mockLLMSecondResponse = {
  finish_reason: 'complete',
  message: {
    content: '',
    tool_calls: [
      {
        id: 'call2',
        type: 'function',
        function: {
          name: 'evaluateAndRun',
          arguments: JSON.stringify({ file: mockRtlSecondTestContent })
        }
      }
    ]
  }
};

// Mock for DOM tree collection
export const mockDomTreeContent = `
<test_case_title>should render todos correctly</test_case_title> and <dom_tree><div class="todo-list"><div class="todo-item" data-testid="todo-item">Buy groceries</div><div class="todo-item completed" data-testid="todo-item">Clean house</div></div></dom_tree>;
<test_case_title>should handle adding new todo</test_case_title> and <dom_tree><div class="todo-list"><form data-testid="todo-form"><input type="text" placeholder="Add a new todo"/><button type="submit">Add</button></form></div></dom_tree>;
`;

// Mock for DOM tree collection - second test
export const mockDomTreeSecondContent = `
<test_case_title>should display the initial count</test_case_title> and <dom_tree><div class="counter"><span class="count-display" data-testid="count-display">5</span></div></dom_tree>;
<test_case_title>should increment count when button is clicked</test_case_title> and <dom_tree><div class="counter"><span class="count-display" data-testid="count-display">0</span><button class="increment-button" data-testid="increment-button">Increment</button></div></dom_tree>;
`;

// Mock for successful test analysis result
export const mockSuccessfulTestAnalysisResult = {
  testPass: true,
  failedTests: 0,
  passedTests: 2,
  totalTests: 2,
  successRate: 100,
  jestRunLogs: 'PASS test/TodoList.test.tsx\n✓ should render todos correctly\n✓ should handle adding new todo\n\nTest Suites: 1 passed, 1 total\nTests: 2 passed, 2 total'
};

// Mock command results
export const mockCommandSuccessResult = {
  process: {} as any,
  output: 'PASS test/TodoList.test.tsx\n✓ should render todos correctly\n✓ should handle adding new todo\n\nTest Suites: 1 passed, 1 total\nTests: 2 passed, 2 total',
  stderr: '',
  command: 'jest test/TodoList.test.tsx'
};
