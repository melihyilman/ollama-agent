(function () {
    const vscode = acquireVsCodeApi();
    const chatContainer = document.getElementById('chat-container');
    const promptInput = document.getElementById('prompt-input');
    const submitButton = document.getElementById('submit-button');
    const statusBar = document.getElementById('status-bar');

    let assistantMessageElement = null;

    // Save state to VS Code
    const saveState = () => {
        vscode.setState({ history: chatContainer.innerHTML });
    };

    // Restore state from VS Code
    const restoreState = () => {
        const previousState = vscode.getState();
        if (previousState && previousState.history) {
            chatContainer.innerHTML = previousState.history;
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    };

    function submitPrompt() {
        const text = promptInput.value.trim();
        if (text) {
            promptInput.value = '';
            vscode.postMessage({ command: 'submitPrompt', text });
        }
    }

    submitButton.addEventListener('click', submitPrompt);

    promptInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitPrompt();
        }
    });

    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function renderContent(text) {
        text = escapeHtml(text);
        text = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
        text = text.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        return text;
    }

    function createMessageElement(role, text, isHtml = false) {
        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message-wrapper message-${role}`;
        const icon = document.createElement('div');
        icon.className = 'message-icon';
        icon.textContent = role === 'user' ? '👤' : '🤖';
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        messageContent.innerHTML = isHtml ? text : renderContent(text);

        messageWrapper.appendChild(icon);
        messageWrapper.appendChild(messageContent);
        return messageWrapper;
    }

    function createPlanElement(summary, actions) {
        const planWrapper = document.createElement('div');
        planWrapper.className = 'plan-wrapper';

        const summaryEl = document.createElement('p');
        summaryEl.innerHTML = renderContent(summary);
        planWrapper.appendChild(summaryEl);

        actions.forEach(action => {
            const actionBlock = document.createElement('div');
            actionBlock.className = 'plan-action-block';
            const actionTitle = document.createElement('strong');
            actionTitle.textContent = action.command.replace(/_/g, ' ').toUpperCase();
            actionBlock.appendChild(actionTitle);

            const codeBlock = document.createElement('pre');
            const codeEl = document.createElement('code');
            codeEl.textContent = action.content || action.shell_command || action.path;
            codeBlock.appendChild(codeEl);
            actionBlock.appendChild(codeBlock);
            planWrapper.appendChild(actionBlock);
        });

        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'plan-buttons';

        const approveButton = document.createElement('button');
        approveButton.textContent = '✅ Approve & Run';
        approveButton.onclick = () => {
            vscode.postMessage({ command: 'execute_plan', actions: actions });
            planWrapper.innerHTML = `<p>Plan approved. Executing all steps...</p>`;
        };

        const denyButton = document.createElement('button');
        denyButton.textContent = '❌ Deny';
        denyButton.onclick = () => {
            planWrapper.innerHTML = `<p>Plan denied.</p>`;
        };

        buttonGroup.appendChild(approveButton);
        buttonGroup.appendChild(denyButton);

        planWrapper.appendChild(buttonGroup);
        return planWrapper;
    }

    window.addEventListener('message', event => {
        const message = event.data;

        switch (message.command) {
            case 'addMessage':
                if (message.role === 'assistant' && message.text === '') {
                    const thinkingIndicator = `<div class="thinking-indicator"><div class="spinner"></div><span>Thinking...</span></div>`;
                    assistantMessageElement = createMessageElement('assistant', thinkingIndicator, true);
                    chatContainer.appendChild(assistantMessageElement);
                } else {
                    const newMsg = createMessageElement(message.role, message.text);
                    chatContainer.appendChild(newMsg);
                    assistantMessageElement = null;
                }
                break;

            case 'appendToMessage':
                if (assistantMessageElement) {
                    const content = assistantMessageElement.querySelector('.message-content');
                    if (content.querySelector('.thinking-indicator')) {
                        content.innerHTML = '';
                    }
                    content.innerHTML += renderContent(message.text);
                }
                break;

            case 'proposePlan':
                if (assistantMessageElement) {
                    const content = assistantMessageElement.querySelector('.message-content');
                    content.innerHTML = '';
                    const planElement = createPlanElement(message.summary, message.actions);
                    content.appendChild(planElement);
                    assistantMessageElement = null;
                }
                break;

            case 'setStatus':
                statusBar.textContent = `Ollama is ${message.status}`;
                if (message.status !== 'thinking' && assistantMessageElement) {
                    const content = assistantMessageElement.querySelector('.message-content');
                    if (content.querySelector('.thinking-indicator')) {
                        content.innerHTML = '✅ Done.';
                    }
                    assistantMessageElement = null;
                }
                break;
        }
        chatContainer.scrollTop = chatContainer.scrollHeight;
        saveState(); // Save history after every update
    });

    // Restore history on load
    restoreState();
    vscode.postMessage({ command: 'checkOllama' });
}());