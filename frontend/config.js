// Runtime API configuration for static deployments. This detects local static
// development automatically, while every deployed hostname uses Render.
const guLocalApiHosts = {
  localhost: 'http://localhost:4000/api',
  '127.0.0.1': 'http://127.0.0.1:4000/api'
};
window.__GU_API_BASE__ = guLocalApiHosts[window.location.hostname]
  || 'https://galala-university-study-plan-full-stack-kd69.onrender.com/api';
