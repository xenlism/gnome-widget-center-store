import { API_BASE } from './config.js';

const result = document.getElementById('result');
const token = new URLSearchParams(location.search).get('token');

if (!token) {
  result.innerHTML = '<div class="alert alert-error">ไม่พบ token ในลิงก์</div>';
} else {
  fetch(`${API_BASE}/auth/verify-email?token=${encodeURIComponent(token)}`)
    .then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ยืนยันไม่สำเร็จ');
      result.innerHTML = `<div class="alert alert-success">ยืนยันอีเมลสำเร็จ! <a href="/login.html">เข้าสู่ระบบ</a></div>`;
    })
    .catch((err) => {
      result.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    });
}
