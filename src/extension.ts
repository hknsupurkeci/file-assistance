import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Data types
interface Todo {
  id: number;
  text: string;
  completed: boolean;
  createdAt: string;
}

interface FileMetadata {
  notes: string[];
  todos: Todo[];
}

// Global variables
let fileMetadataStore: { [filePath: string]: FileMetadata } = {};
let globalStoragePath = '';
let currentProvider: FileAssistantViewProvider | undefined;

// Extension activate/deactivate
export function activate(context: vscode.ExtensionContext) {
  console.log('File Assistant is now active!');

  // Set storage path
  globalStoragePath = context.globalStoragePath;
  loadMetadataStore();

  // Create and register the sidebar view provider
  currentProvider = new FileAssistantViewProvider(context.extensionUri);

  context.subscriptions.push(
    // Register the Webview with VSCode
    vscode.window.registerWebviewViewProvider(
      FileAssistantViewProvider.viewType,
      currentProvider
    ),
    // Register commands
    vscode.commands.registerCommand('fileAssistant.addNote', addNote),
    vscode.commands.registerCommand('fileAssistant.addTodo', addTodo),
    vscode.commands.registerCommand('fileAssistant.toggleTodo', toggleTodo),
    vscode.commands.registerCommand('fileAssistant.refreshView', refreshView),
    vscode.commands.registerCommand('fileAssistant.deleteNote', deleteNote),
    vscode.commands.registerCommand('fileAssistant.deleteTodo', deleteTodo)
  );

  // Update view when active file changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && currentProvider) {
        currentProvider.updateView(editor.document.uri.fsPath);
      }
    })
  );

  // Update view when file is saved
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (currentProvider) {
        currentProvider.updateView(document.uri.fsPath);
      }
    })
  );

  // Update view if there's an active editor on start
  if (vscode.window.activeTextEditor && currentProvider) {
    currentProvider.updateView(vscode.window.activeTextEditor.document.uri.fsPath);
  }
}

export function deactivate() {
  saveMetadataStore();
}

// Webview Provider Class
class FileAssistantViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'fileAssistant.sidebarView';
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Listen for messages from the webview
    webviewView.webview.onDidReceiveMessage((data) => {
      switch (data.type) {
        case 'addNote':
          vscode.commands.executeCommand('fileAssistant.addNote');
          break;
        case 'addTodo':
          vscode.commands.executeCommand('fileAssistant.addTodo');
          break;
        case 'toggleTodo':
          if (data.id !== undefined && data.completed !== undefined) {
            vscode.commands.executeCommand('fileAssistant.toggleTodo', data.id, data.completed);
          }
          break;
        case 'deleteNote':
          if (data.noteIndex !== undefined) {
            vscode.commands.executeCommand('fileAssistant.deleteNote', data.noteIndex);
          }
          break;
        case 'deleteTodo':
          if (data.todoId !== undefined) {
            vscode.commands.executeCommand('fileAssistant.deleteTodo', data.todoId);
          }
          break;
      }
    });

    // On initial load, check active editor
    if (vscode.window.activeTextEditor) {
      setTimeout(() => {
        this.updateView(vscode.window.activeTextEditor!.document.uri.fsPath);
      }, 300);
    }
  }

  /**
   * Gets file metadata and sends to webview
   */
  public updateView(filePath: string) {
    if (!this._view) {
      return;
    }
    if (!filePath) {
      return;
    }

    try {
      const metadata = getFileMetadata(filePath);
      this._view.webview.postMessage({
        type: 'update',
        filePath: filePath,
        fileName: path.basename(filePath),
        metadata: metadata,
      });
    } catch (error) {
      console.error('updateView Error:', error);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      <title>File Assistant</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", 
            Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
          padding: 10px;
          margin: 0;
        }
        .file-name {
          font-weight: bold;
          font-size: 1.1em;
          margin-bottom: 15px;
        }
        .buttons {
          margin-bottom: 20px;
          display: flex;
          gap: 5px;
          flex-wrap: wrap;
        }
        button {
          background-color: #007acc;
          color: #ffffff;
          border: none;
          padding: 6px 12px;
          cursor: pointer;
          border-radius: 4px;
        }
        button:hover {
          background-color: #005e99;
        }
        .section {
          margin-bottom: 20px;
        }
        .section-title {
          font-weight: bold;
          margin-bottom: 5px;
          border-bottom: 1px solid #ccc;
          padding-bottom: 3px;
          font-size: 0.95em;
        }
        .section-content {
          margin-top: 8px;
        }
        /* Notes List */
        .notes-list {
          list-style-type: disc;
          padding-left: 20px;
        }
        .note-item {
          position: relative;
          margin-bottom: 6px;
        }
        .note-delete-btn {
          position: absolute;
          top: 0;
          right: 0;
          background-color: transparent;
          border: none;
          color: #888;
          cursor: pointer;
        }
        .note-delete-btn:hover {
          color: #ff0000;
        }
        /* Todos */
        .todo-item {
          display: flex;
          align-items: center;
          margin-bottom: 6px;
          position: relative;
          padding: 4px 0;
        }
        .todo-item input[type="checkbox"] {
          margin-right: 8px;
        }
        .todo-item.completed span {
          text-decoration: line-through;
          opacity: 0.7;
        }
        .todo-delete-btn {
          position: absolute;
          right: 0;
          background-color: transparent;
          border: none;
          color: #888;
          cursor: pointer;
        }
        .todo-delete-btn:hover {
          color: #ff0000;
        }
        .no-file-message {
          font-style: italic;
          text-align: center;
          margin-top: 50px;
          color: #888;
        }
      </style>
    </head>
    <body>
      <div id="noFileView" class="no-file-message">Open a file to start</div>

      <div id="fileView" style="display: none;">
        <div id="fileName" class="file-name"></div>

        <div class="buttons">
          <button id="btnAddNote">Add Note</button>
          <button id="btnAddTodo">Add Todo</button>
        </div>

        <div class="section">
          <div class="section-title">Notes</div>
          <div class="section-content" id="notesContainer"></div>
        </div>

        <div class="section">
          <div class="section-title">Todos</div>
          <div class="section-content" id="todosContainer"></div>
        </div>
      </div>

      <script>
        // VSCode API for message passing
        const vscode = acquireVsCodeApi();

        const fileView = document.getElementById('fileView');
        const noFileView = document.getElementById('noFileView');
        const fileNameElem = document.getElementById('fileName');
        const notesContainer = document.getElementById('notesContainer');
        const todosContainer = document.getElementById('todosContainer');

        // Button click handlers
        document.getElementById('btnAddNote').addEventListener('click', () => {
          vscode.postMessage({ type: 'addNote' });
        });

        document.getElementById('btnAddTodo').addEventListener('click', () => {
          vscode.postMessage({ type: 'addTodo' });
        });

        // Listen for incoming messages
        window.addEventListener('message', (event) => {
          const message = event.data;
          switch (message.type) {
            case 'update':
              updateView(message.filePath, message.fileName, message.metadata);
              break;
          }
        });

        /**
         * Update UI with received metadata
         */
        function updateView(filePath, fileName, metadata) {
          if (!filePath) {
            noFileView.style.display = 'block';
            fileView.style.display = 'none';
            return;
          }
          noFileView.style.display = 'none';
          fileView.style.display = 'block';

          fileNameElem.textContent = fileName || 'Unknown File';

          // Update notes
          if (metadata.notes && metadata.notes.length > 0) {
            notesContainer.innerHTML = '';
            const ul = document.createElement('ul');
            ul.className = 'notes-list';

            metadata.notes.forEach((note, index) => {
              const li = document.createElement('li');
              li.className = 'note-item';
              li.textContent = note;

              // Delete button
              const deleteBtn = document.createElement('button');
              deleteBtn.className = 'note-delete-btn';
              deleteBtn.textContent = 'x';
              deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                vscode.postMessage({
                  type: 'deleteNote',
                  noteIndex: index
                });
              });

              li.appendChild(deleteBtn);
              ul.appendChild(li);
            });

            notesContainer.appendChild(ul);
          } else {
            notesContainer.innerHTML = '<div style="color: #888;">No notes yet</div>';
          }

          // Update todos
          if (metadata.todos && metadata.todos.length > 0) {
            todosContainer.innerHTML = '';
            metadata.todos.forEach((todo) => {
              const todoDiv = document.createElement('div');
              todoDiv.className = 'todo-item';

              if (todo.completed) {
                todoDiv.classList.add('completed');
              }

              const checkbox = document.createElement('input');
              checkbox.type = 'checkbox';
              checkbox.checked = todo.completed;

              checkbox.addEventListener('change', () => {
                vscode.postMessage({
                  type: 'toggleTodo',
                  id: todo.id,
                  completed: checkbox.checked
                });
              });

              const label = document.createElement('span');
              label.textContent = todo.text;

              // Delete button
              const deleteBtn = document.createElement('button');
              deleteBtn.className = 'todo-delete-btn';
              deleteBtn.textContent = 'x';
              deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                vscode.postMessage({
                  type: 'deleteTodo',
                  todoId: todo.id
                });
              });

              todoDiv.appendChild(checkbox);
              todoDiv.appendChild(label);
              todoDiv.appendChild(deleteBtn);
              todosContainer.appendChild(todoDiv);
            });
          } else {
            todosContainer.innerHTML = '<div style="color: #888;">No todos yet</div>';
          }
        }
      </script>
    </body>
    </html>`;
  }
}

// Helper functions for metadata load/save/retrieve
function loadMetadataStore() {
  try {
    if (!fs.existsSync(globalStoragePath)) {
      fs.mkdirSync(globalStoragePath, { recursive: true });
    }
    const filePath = path.join(globalStoragePath, 'fileMetadata.json');
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      fileMetadataStore = JSON.parse(data);
    } else {
      fileMetadataStore = {};
    }
  } catch (err) {
    console.error('Error loading metadata:', err);
    fileMetadataStore = {};
  }
}

function saveMetadataStore() {
  try {
    if (!fs.existsSync(globalStoragePath)) {
      fs.mkdirSync(globalStoragePath, { recursive: true });
    }
    const filePath = path.join(globalStoragePath, 'fileMetadata.json');
    fs.writeFileSync(filePath, JSON.stringify(fileMetadataStore, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving metadata:', err);
  }
}

function getFileMetadata(filePath: string): FileMetadata {
  if (!fileMetadataStore[filePath]) {
    fileMetadataStore[filePath] = {
      notes: [],
      todos: []
    };
  }
  return fileMetadataStore[filePath];
}

// Command functions
async function refreshView() {
  const editor = vscode.window.activeTextEditor;
  if (editor && currentProvider) {
    currentProvider.updateView(editor.document.uri.fsPath);
  }
}

async function addNote() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Open a file to add a note.');
    return;
  }

  const filePath = editor.document.uri.fsPath;
  const note = await vscode.window.showInputBox({
    prompt: 'Add a note for this file',
    placeHolder: 'E.g. This file manages user authentication'
  });

  if (note) {
    const metadata = getFileMetadata(filePath);
    metadata.notes.push(note);
    saveMetadataStore();
    currentProvider?.updateView(filePath);

    vscode.window.showInformationMessage('Note added!');
  }
}

async function addTodo() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Open a file to add a todo.');
    return;
  }

  const filePath = editor.document.uri.fsPath;
  const todoText = await vscode.window.showInputBox({
    prompt: 'Add a todo for this file',
    placeHolder: 'E.g. Add error handling mechanism'
  });

  if (todoText) {
    const metadata = getFileMetadata(filePath);
    const newId =
      metadata.todos.length > 0 ? Math.max(...metadata.todos.map(t => t.id)) + 1 : 1;

    metadata.todos.push({
      id: newId,
      text: todoText,
      completed: false,
      createdAt: new Date().toISOString()
    });

    saveMetadataStore();
    currentProvider?.updateView(filePath);

    vscode.window.showInformationMessage('Todo added!');
  }
}

/**
 * Toggles a todo's completion state (checkbox changes).
 */
async function toggleTodo(todoId: number, completed: boolean) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Open a file to toggle a todo.');
    return;
  }

  const filePath = editor.document.uri.fsPath;
  const metadata = getFileMetadata(filePath);

  const todo = metadata.todos.find(t => t.id === todoId);
  if (todo) {
    todo.completed = completed;
    saveMetadataStore();
    currentProvider?.updateView(filePath);

    vscode.window.showInformationMessage(
      completed
        ? `"${todo.text}" todo completed!`
        : `"${todo.text}" todo undone!`
    );
  }
}

/**
 * Deletes a note by index.
 */
async function deleteNote(noteIndex: number) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Open a file to delete a note.');
    return;
  }

  const filePath = editor.document.uri.fsPath;
  const metadata = getFileMetadata(filePath);

  if (noteIndex >= 0 && noteIndex < metadata.notes.length) {
    const removed = metadata.notes.splice(noteIndex, 1);
    saveMetadataStore();
    currentProvider?.updateView(filePath);

    vscode.window.showInformationMessage(`Note deleted: "${removed[0]}"`);
  }
}

/**
 * Deletes a todo by its id.
 */
async function deleteTodo(todoId: number) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Open a file to delete a todo.');
    return;
  }

  const filePath = editor.document.uri.fsPath;
  const metadata = getFileMetadata(filePath);

  const index = metadata.todos.findIndex(t => t.id === todoId);
  if (index !== -1) {
    const removed = metadata.todos.splice(index, 1);
    saveMetadataStore();
    currentProvider?.updateView(filePath);

    vscode.window.showInformationMessage(`Todo deleted: "${removed[0].text}"`);
  }
}