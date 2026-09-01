import { api } from './api.js';

const form = document.getElementById('login-form');
const alertBox = document.getElementById('alert');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertBox.innerHTML = '';
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    await api.login({
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value,
    });
    location.href = '/';
  } catch (err) {
    alertBox.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  } finally {
    submitBtn.disabled = false;
  }
});
