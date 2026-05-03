/**
 * AdbX Console - File Transfer
 *
 * Browse device filesystem, download (pull) files, and upload (push) files.
 */

'use strict';

const fileTransfer = {
  _currentPath: '/sdcard',
  _pathStack: ['/sdcard'],

  init() {
    document.getElementById('upload-btn').addEventListener('click', () => {
      document.getElementById('upload-input').click();
    });

    document.getElementById('upload-input').addEventListener('change', (e) => {
      this.uploadFiles(e.target.files);
      e.target.value = '';
    });

    document.addEventListener('adbx:deviceSelected', () => {
      this._currentPath = '/sdcard';
      this._pathStack   = ['/sdcard'];
      if (app.selectedSerial) this.loadDirectory('/sdcard');
    });

    // Open files tab and load when navigated to
    document.querySelector('.nav-btn[data-tab="files"]')?.addEventListener('click', () => {
      if (app.selectedSerial) this.loadDirectory(this._currentPath);
    });
  },

  async loadDirectory(path) {
    const serial = app.selectedSerial;
    if (!serial) return;

    try {
      const data = await app.apiGet(`/api/devices/${serial}/files?path=${encodeURIComponent(path)}`);
      this._currentPath = path;
      this._renderFiles(data.files || [], path);
      this._renderBreadcrumb(path);
    } catch (err) {
      toast('Could not list files: ' + err.message, 'error');
    }
  },

  _renderBreadcrumb(path) {
    const bc = document.getElementById('breadcrumb');
    bc.innerHTML = '';
    const parts = path.split('/').filter(Boolean);
    let cumulative = '';

    const rootBtn = document.createElement('button');
    rootBtn.className = 'breadcrumb-item';
    rootBtn.textContent = '/';
    rootBtn.addEventListener('click', () => this.loadDirectory('/'));
    bc.appendChild(rootBtn);

    for (const part of parts) {
      cumulative += '/' + part;
      const pathCopy = cumulative;
      const btn = document.createElement('button');
      btn.className = 'breadcrumb-item';
      btn.textContent = part;
      btn.addEventListener('click', () => this.loadDirectory(pathCopy));
      bc.appendChild(btn);
    }

    // Mark last as active
    const last = bc.lastElementChild;
    if (last) last.classList.add('active');
  },

  _renderFiles(files, basePath) {
    const tbody = document.getElementById('file-table-body');
    tbody.innerHTML = '';

    if (files.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="table-empty">Empty directory</td></tr>';
      return;
    }

    // Sort: directories first, then files
    files.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'directory' ? -1 : 1;
    });

    for (const file of files) {
      const tr = document.createElement('tr');
      const icon = file.type === 'directory' ? '📁' : '📄';
      const size = file.type === 'directory' ? '—' : formatSize(file.size);
      const remotePath = (basePath.endsWith('/') ? basePath : basePath + '/') + file.name;

      tr.innerHTML = `
        <td>
          <span class="file-icon">${escHtml(icon)}</span>
          ${file.type === 'directory'
            ? `<button class="file-name-btn" data-path="${escAttr(remotePath)}">${escHtml(file.name)}</button>`
            : escHtml(file.name)
          }
        </td>
        <td>${escHtml(file.type)}</td>
        <td>${escHtml(size)}</td>
        <td>
          ${file.type === 'file'
            ? `<button class="btn btn--secondary" data-download="${escAttr(remotePath)}">⬇ Download</button>`
            : ''
          }
        </td>
      `;

      // Navigate into directories
      const dirBtn = tr.querySelector('.file-name-btn');
      if (dirBtn) {
        dirBtn.addEventListener('click', () => this.loadDirectory(dirBtn.dataset.path));
      }

      // Pull file
      const dlBtn = tr.querySelector('[data-download]');
      if (dlBtn) {
        dlBtn.addEventListener('click', () => this.downloadFile(dlBtn.dataset.download));
      }

      tbody.appendChild(tr);
    }
  },

  async downloadFile(remotePath) {
    const serial = app.selectedSerial;
    if (!serial) return toast('No device selected', 'warning');

    try {
      const res = await fetch(HTTP_BASE() + `/api/devices/${serial}/files/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remotePath }),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = remotePath.split('/').pop();
      a.click();
      URL.revokeObjectURL(url);
      toast('Downloaded: ' + a.download, 'success');
    } catch (err) {
      toast('Download failed: ' + err.message, 'error');
    }
  },

  async uploadFiles(fileList) {
    const serial = app.selectedSerial;
    if (!serial) return toast('No device selected', 'warning');
    if (!fileList || fileList.length === 0) return;

    const progress  = document.getElementById('transfer-progress');
    const fill      = document.getElementById('progress-fill');
    const label     = document.getElementById('progress-label');
    progress.hidden = false;

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const remotePath = this._currentPath.endsWith('/')
        ? this._currentPath + file.name
        : this._currentPath + '/' + file.name;

      label.textContent = `Uploading ${file.name}… (${i + 1}/${fileList.length})`;
      fill.style.width  = `${Math.round(((i) / fileList.length) * 100)}%`;

      try {
        const arrayBuffer = await file.arrayBuffer();
        const res = await fetch(
          HTTP_BASE() + `/api/devices/${serial}/files/push?path=${encodeURIComponent(remotePath)}`,
          { method: 'POST', body: arrayBuffer, headers: { 'Content-Type': 'application/octet-stream' } }
        );
        if (!res.ok) throw new Error(await res.text());
      } catch (err) {
        toast(`Upload failed for ${file.name}: ${err.message}`, 'error');
      }
    }

    fill.style.width  = '100%';
    label.textContent = 'Upload complete!';
    setTimeout(() => { progress.hidden = true; }, 2000);

    this.loadDirectory(this._currentPath);
    toast(`Uploaded ${fileList.length} file(s)`, 'success');
  },
};

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

window.fileTransfer = fileTransfer;
fileTransfer.init();
