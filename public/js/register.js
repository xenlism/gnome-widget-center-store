import { api } from './api.js';

const form = document.getElementById('register-form');
const alertBox = document.getElementById('alert');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertBox.innerHTML = '';
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    const res = await api.register({
      displayName: document.getElementById('displayName').value.trim(),
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value,
    });
    alertBox.innerHTML = `<div class="alert alert-success">${res.message}</div>`;
    form.reset();
  } catch (err) {
    alertBox.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  } finally {
    submitBtn.disabled = false;
  }
});
