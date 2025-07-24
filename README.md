# Ollama Agent VS Code Extension

This is a Visual Studio Code extension that provides an AI developer assistant in your sidebar. It connects to a locally running Ollama instance to understand your prompts and help you with various development tasks.

## Features

*   **AI Chat:** Converse with a large language model directly in your editor.
*   **Task Execution:** The agent can perform actions based on your requests, such as:
    *   Creating, reading, and updating files.
    *   Listing files and directories.
    *   Executing shell commands in the integrated terminal.
*   **Interactive Planning:** The agent can propose a plan of action for complex tasks, which you can then approve for execution.

## Prerequisites

*   You must have [Ollama](https://ollama.com/) installed and running on your local machine.
*   You need a model pulled, for example: `ollama pull llama2`.

## How to Use

1.  Make sure your local Ollama server is running.
2.  Open the Ollama Agent sidebar in VS Code.
3.  The status indicator will show if the connection to Ollama is successful.
4.  Type your request into the prompt box and let the agent assist you.
