import { API_BASE } from './config.js';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const message = (data && data.error) || `request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export const api = {
  me: () => request('/me'),
  register: (payload) => request('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload) => request('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => request('/auth/logout', { method: 'POST' }),

  submit: (type, formData) => request(`/submit/${type}`, { method: 'POST', body: formData }),

  reviews: (type, id) => request(`/reviews/${type}/${encodeURIComponent(id)}`),
  postReview: (payload) => request('/reviews', { method: 'POST', body: JSON.stringify(payload) }),

  adminPending: () => request('/admin/pending'),
  adminApprove: (type, id) => request(`/admin/${type}/${encodeURIComponent(id)}/approve`, { method: 'POST' }),
  adminReject: (type, id, reason) => request(`/admin/${type}/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  adminDownloadUrl: (type, id) => `${API_BASE}/admin/${type}/${encodeURIComponent(id)}/download`,

  adminListUsers: () => request('/admin/users'),
  adminCreateUser: (payload) => request('/admin/users', { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateUser: (id, payload) => request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminRemoveUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
  adminDeleteReview: (id) => request(`/admin/reviews/${id}`, { method: 'DELETE' }),
};
