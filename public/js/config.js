// Edit these two values after you deploy (see README.md). They are the
// only two things the static frontend needs to know, and both are public
// by nature (a base API path and a public file CDN host) — nothing
// secret belongs in this file.
export const API_BASE = '/api';
export const FILES_BASE = 'https://files.example.com'; // your PUBLIC_FILES_BASE_URL / R2 custom domain

// The store's two independent "repositories" — one manifest per package
// type, served at fixed paths under repo/ (see src/catalog.js for why
// they're separate files rather than one combined manifest).
export const WIDGETS_MANIFEST_URL = `${FILES_BASE}/repo/widgets.json`;
export const THEMEPACKS_MANIFEST_URL = `${FILES_BASE}/repo/themepacks.json`;
