import axios from 'axios';
export const api = axios.create({ baseURL:'/api', withCredentials:true });
export function formatErr(detail) { if (typeof detail === 'string') return detail; if (Array.isArray(detail)) return detail.map(x=>x.msg||JSON.stringify(x)).join('; '); return detail?.message || 'Request failed'; }
