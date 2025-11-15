import { request } from '../api.js';
import { showToast } from '../ui.js';

export async function initPage() {
  const form = document.getElementById('loginForm');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      await request('/api/login', { method: 'POST', body: data });
      window.location.href = '/dashboard.html';
    } catch (err) {
      showToast(err.message);
    }
  });
}
