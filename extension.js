const vscode = require('vscode');
const path = require('path');
const http = require('http');
const AGENT_SYSTEM_PROMPT = `You are an expert, technology-agnostic AI developer assistant inside VS Code.
Your SOLE PURPOSE is to analyze the user's request, the conversation history, and the current state, think step-by-step, and then generate a SINGLE JSON object to achieve the goal. Do not add any explanations or surrounding text.

**YOUR CORE LOGIC:**
1.  **Analyze Goal, History & State:** First, deeply understand the user's ultimate goal. Review the 'conversation_history' to understand the context of the dialogue. Review the provided 'current_state' to understand what has already been done (e.g., file listings, command outputs).
2.  **Think Step-by-Step:** Before making a plan, formulate an internal monologue (a "thought" process) to break down the problem. What is the most logical next step? Do I have enough information, or do I need to ask the user or explore the file system first? Is the user asking a new question or continuing a previous task?
3.  **Differentiate Chat vs. Task:** Is the user making small talk, or asking for a development task?
4.  **Propose ONE Action:** For tasks, do NOT propose a full multi-step plan at once. Propose ONLY the very next logical action to move towards the goal. After you receive the result of this action, you will be invoked again with the updated state to decide the next action. This allows you to be adaptive.

**YOUR TOOLBOX (Your JSON response MUST use one of these commands):**
* {"command": "chat", "text": "..."}: For conversation or to inform the user of your progress/completion.
* {"command": "ask_user", "question": "..."}: When you need clarification or a decision from the user to proceed.
* {"command": "execute_shell_command", "thought": "...", "shell_command": "..."}: To run any terminal command. Explain your reasoning in the 'thought' field.
* {"command": "create_file", "thought": "...", "path": "...", "content": "..."}: To create a new file.
* {"command": "read_file", "thought": "...", "path": "..."}: To read an existing file's content.
* {"command": "update_file", "thought": "...", "path": "...", "content": "..."}: To insert, replace or delete content in an existing file.
* {"command": "list_files", "thought": "...", "path": "..."}: To list files and directories to understand the project structure.
* {"command": "finish_task", "final_message": "..."}: When you believe the user's entire request has been successfully completed.

**CRUCIAL RULES:**
1.  **You are the expert.** Do NOT ask the user for shell commands or code. It is your job to figure them out.
2.  **One Action at a Time:** Your 'actions' array (if you use one) should contain ONLY ONE action object. This iterative process is key.
3.  **Think First:** ALWAYS include a "thought" field in your action JSON. This field should explain WHY you are taking this specific action.
4.  **Be Economical:** Always choose the most direct and efficient action. Do not list files if you already know the file structure from the previous turn.
5.  **Self-Correction:** If a previous action resulted in an error (which will be in the 'state'), analyze the error and try a different approach to fix it. For example, if a directory doesn't exist, create it before trying to create a file inside it.
6.  **Paths are Relative:** All file paths must be relative to the workspace root.
7.  **Be Proactive:** Don't ask for permission or clarification on obvious next steps. If the user asks to create a project, infer the necessary commands. Use the current workspace as the default location for all file operations unless the user specifies otherwise. Make reasonable assumptions to keep the workflow moving forward. Only ask the user if you are truly blocked or a critical decision is needed.

Now, analyze the user's prompt, the conversation history, and the current state, then generate the correct JSON response for the very next action.`;

function activate(context) {
    const provider = new OllamaAgentViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(OllamaAgentViewProvider.viewType, provider)
    );
}

class OllamaAgentViewProvider {
    static viewType = 'ollama-agent-sidebar';

    constructor(extensionUri) {
        this._extensionUri = extensionUri;
        this._view = null;
        this.conversationHistory = [];
    }

    resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'submitPrompt':
                    this.handlePrompt(message.text);
                    break;
                case 'newChat':
                    this.conversationHistory = [];
                    this.postMessageToWebview('clearChat');
                    break;
                case 'execute_plan':
                    this.executePlan(message.actions);
                    break;
                case 'checkOllama':
                    this.checkOllamaStatus();
                    break;
            }
        });
    }

    checkOllamaStatus() {
        const options = { hostname: 'localhost', port: 11434, path: '/', method: 'GET' };
        const req = http.request(options, res => {
            this.postMessageToWebview('setStatus', { status: res.statusCode === 200 ? 'running' : 'not-running' });
        });
        req.on('error', () => {
            this.postMessageToWebview('setStatus', { status: 'not-running' });
        });
        req.end();
    }

    async handlePrompt(prompt) {
        if (!this._view) return;

        const userMessage = { role: 'user', text: prompt };
        this.conversationHistory.push(userMessage);
        this.postMessageToWebview('addMessage', userMessage);
        this.postMessageToWebview('setStatus', { status: 'thinking' });

        const requestPayload = {
            model: 'llama2',
            stream: false,
            format: 'json',
            prompt: `${AGENT_SYSTEM_PROMPT}\n\nConversation History:\n${JSON.stringify(this.conversationHistory, null, 2)}`
        };

        const postData = JSON.stringify(requestPayload);
        const options = {
            hostname: 'localhost', port: 11434, path: '/api/generate', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        };

        let rawResponse = '';
        const req = http.request(options, (res) => {
            res.on('data', (chunk) => rawResponse += chunk.toString());
            res.on('end', async () => {
                try {
                    const jsonResponse = JSON.parse(rawResponse);
                    const agentResponse = JSON.parse(jsonResponse.response);
                    this.conversationHistory.push({ role: 'assistant', text: JSON.stringify(agentResponse) });
                    await this.processAgentResponse(agentResponse);
                } catch (e) {
                    const errorMessage = { role: 'assistant', text: `\n**Error:** I received an invalid response from the model. ${e.message}` };
                    this.postMessageToWebview('addMessage', errorMessage);
                    this.conversationHistory.push(errorMessage);
                }
                this.postMessageToWebview('setStatus', { status: 'running' });
            });
        });

        req.on('error', (e) => {
            const errorMessage = { role: 'assistant', text: `\n**Error:** Could not connect to Ollama. ${e.message}` };
            this.postMessageToWebview('addMessage', errorMessage);
            this.conversationHistory.push(errorMessage);
            this.postMessageToWebview('setStatus', { status: 'running' });
        });

        req.write(postData);
        req.end();
    }

    async processAgentResponse(agentResponse) {
        const { command, ...args } = agentResponse;
        switch (command) {
            case 'chat':
                this.postMessageToWebview('addMessage', { role: 'assistant', text: args.text });
                break;
            case 'ask_user':
                this.postMessageToWebview('addMessage', { role: 'assistant', text: args.question });
                break;
            case 'propose_plan':
                this.postMessageToWebview('proposePlan', { summary: args.plan_summary, actions: args.actions });
                break;
            default:
                 this.postMessageToWebview('addMessage', { role: 'assistant', text: `\n**Error:** Unknown command '${command}'.` });
        }
    }

    async executePlan(actions) {
        this.postMessageToWebview('setStatus', { status: 'executing' });
        try {
            for (const action of actions) {
                await this.executeSingleCommand(action);
            }
            this.postMessageToWebview('addMessage', { role: 'assistant', text: '✅ Plan executed successfully.' });
        } catch (e) {
            this.postMessageToWebview('addMessage', { role: 'assistant', text: `\n**Error executing plan:** ${e.message}` });
        }
        this.postMessageToWebview('setStatus', { status: 'running' });
    }

    async executeSingleCommand(action) {
        const { command, ...args } = action;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) throw new Error('No workspace folder is open.');
        const workspaceRoot = workspaceFolders[0].uri;

        switch (command) {
            case 'chat':
                this.postMessageToWebview('addMessage', { role: 'assistant', text: args.text });
                break;
            case 'ask_user':
                this.postMessageToWebview('addMessage', { role: 'assistant', text: args.question });
                break;
            case 'finish_task':
                 this.postMessageToWebview('addMessage', { role: 'assistant', text: args.final_message });
                 break;
            case 'create_file':
            case 'update_file':
                const fileUri = vscode.Uri.joinPath(workspaceRoot, args.path);
                await vscode.workspace.fs.writeFile(fileUri, Buffer.from(args.content, 'utf8'));
                break;
            case 'read_file':
                const readFileUri = vscode.Uri.joinPath(workspaceRoot, args.path);
                const contentBytes = await vscode.workspace.fs.readFile(readFileUri);
                const content = Buffer.from(contentBytes).toString('utf8');
                this.postMessageToWebview('addMessage', { role: 'assistant', text: `I have read the file ${args.path}. It contains:\n\n\`\`\`\n${content}\n\`\`\`` });
                break;
            case 'list_files':
                const dirUri = vscode.Uri.joinPath(workspaceRoot, args.path || '.');
                const files = await vscode.workspace.fs.readDirectory(dirUri);
                const fileList = files.map(([name, type]) => type === vscode.FileType.Directory ? `${name}/` : name).join('\n');
                this.postMessageToWebview('addMessage', { role: 'assistant', text: `Files in ${args.path || '/'}:\n\n\`\`\`\n${fileList}\n\`\`\`` });
                break;
            case 'execute_shell_command':
                const terminal = vscode.window.createTerminal({ name: "Ollama Agent Task" });
                terminal.show();
                terminal.sendText(args.shell_command);
                break;
            default:
                throw new Error(`Unknown action command: ${command}`);
        }
    }

    postMessageToWebview(command, data) {
        if (this._view) {
            this._view.webview.postMessage({ command, ...data });
        }
    }

    _getHtmlForWebview(webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
        const nonce = getNonce();
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link href="${stylesUri}" rel="stylesheet"><title>Ollama Agent</title></head><body><div id="chat-container"></div><div class="prompt-container"><div id="status-bar"></div><div class="prompt-input-wrapper"><textarea id="prompt-input" placeholder="Ask me anything..."></textarea><button id="submit-button">➢</button></div><button id="new-chat-button">New Chat</button></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
    }
}

function deactivate() {}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

module.exports = { activate, deactivate };