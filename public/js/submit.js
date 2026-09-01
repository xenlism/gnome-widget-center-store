import { api } from './api.js';

let currentType = 'widget';

const tabs = document.querySelectorAll('.tab');
const fileInput = document.getElementById('file');
const fileLabel = document.getElementById('file-label');
const versionField = document.getElementById('version-field');

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    currentType = tab.dataset.type;
    fileLabel.textContent = currentType === 'widget' ? 'ไฟล์ .gwcw' : 'ไฟล์ .gwct';
    fileInput.accept = currentType === 'widget' ? '.gwcw' : '.gwct';
    versionField.style.display = currentType === 'widget' ? 'block' : 'none';
  });
});
fileInput.accept = '.gwcw';

const form = document.getElementById('submit-form');
const alertBox = document.getElementById('alert');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertBox.innerHTML = '';
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    const fd = new FormData();
    fd.set('name', document.getElementById('name').value.trim());
    fd.set('description', document.getElementById('description').value.trim());
    if (currentType === 'widget') fd.set('version', document.getElementById('version').value.trim());
    fd.set('file', fileInput.files[0]);

    const res = await api.submit(currentType, fd);
    alertBox.innerHTML = `<div class="alert alert-success">ส่งสำเร็จ! รหัส: ${res.id} — สถานะรอตรวจสอบ</div>`;
    form.reset();
  } catch (err) {
    alertBox.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  } finally {
    submitBtn.disabled = false;
  }
});
