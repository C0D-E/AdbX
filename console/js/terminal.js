/**
 * AdbX Console - Command Terminal
 *
 * Provides an interactive shell terminal for running ADB shell commands
 * on the selected device. Supports command history and quick commands.
 */

'use strict';

const terminal = {
  _history: [],
  _historyIndex: -1,

  init() {
    const input  = document.getElementById('terminal-input');
    const runBtn = document.getElementById('run-cmd-btn');
    const clearBtn = document.getElementById('clear-terminal-btn');

    runBtn.addEventListener('click', () => this.runCommand());
    clearBtn.addEventListener('click', () => this.clear());

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.runCommand();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._navigateHistory(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._navigateHistory(1);
      }
    });

    // Quick command buttons
    document.querySelectorAll('.quick-cmd').forEach((btn) => {
      btn.addEventListener('click', () => {
        input.value = btn.dataset.cmd;
        this.runCommand();
      });
    });

    // Update prompt when device changes
    document.addEventListener('adbx:deviceSelected', (e) => {
      const serial = e.detail?.serial;
      const prompt = document.getElementById('terminal-prompt');
      prompt.textContent = serial ? `[${serial}]$ ` : '$ ';
    });

    this.print('AdbX Terminal ready. Select a device and type a shell command.', 'info');
  },

  async runCommand() {
    const input   = document.getElementById('terminal-input');
    const command = input.value.trim();
    if (!command) return;

    const serial = app.selectedSerial;
    if (!serial) {
      this.print('No device selected.', 'error');
      return;
    }

    input.value = '';
    this._history.unshift(command);
    if (this._history.length > 100) this._history.pop();
    this._historyIndex = -1;

    this.print(`$ ${command}`, 'cmd');

    try {
      const output = await app.sendShell(serial, command);
      this.print(output || '(no output)', 'output');
    } catch (err) {
      this.print(`Error: ${err.message}`, 'error');
    }
  },

  print(text, type = 'output') {
    const output = document.getElementById('terminal-output');
    const line   = document.createElement('div');
    line.className = type === 'cmd'   ? 'cmd-line'
                   : type === 'error' ? 'error-line'
                   : 'output-line';
    line.textContent = text;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  },

  clear() {
    document.getElementById('terminal-output').innerHTML = '';
  },

  _navigateHistory(direction) {
    const input = document.getElementById('terminal-input');
    const newIndex = this._historyIndex + direction;
    if (newIndex < -1 || newIndex >= this._history.length) return;
    this._historyIndex = newIndex;
    input.value = newIndex === -1 ? '' : this._history[newIndex];
  },
};

window.terminal = terminal;
terminal.init();
