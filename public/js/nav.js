import { api } from './api.js';

export async function initNav() {
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => links.classList.toggle('open'));
  }

  const right = document.getElementById('nav-right');
  if (!right) return;

  try {
    const { user } = await api.me();
    if (user) {
      right.innerHTML = `
        <span class="faint">${escapeHtml(user.displayName || user.email)}</span>
        ${user.isAdmin ? '<a class="btn btn-sm" href="/admin/index.html">Admin</a>' : ''}
        <a class="btn btn-sm btn-primary" href="/submit.html">Submit</a>
        <button class="btn btn-sm" id="nav-logout">ออกจากระบบ</button>
      `;
      document.getElementById('nav-logout').addEventListener('click', async () => {
        await api.logout();
        location.reload();
      });
    } else {
      right.innerHTML = `
        <a class="btn btn-sm" href="/login.html">เข้าสู่ระบบ</a>
        <a class="btn btn-sm btn-primary" href="/register.html">สมัครสมาชิก</a>
      `;
    }
  } catch {
    right.innerHTML = `<a class="btn btn-sm" href="/login.html">เข้าสู่ระบบ</a>`;
  }
}

export function escapeHtml(str) {
  return (str ?? '').toString().replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

initNav();
