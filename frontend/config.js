import { PRODUCTION_API_BASE } from './shared/apiConfig.js';

// Runtime API configuration for static deployments. This detects local static
// development automatically; the shared API module owns the production URL.
const guLocalApiHosts = {
  localhost: 'http://localhost:4000/api',
  '127.0.0.1': 'http://127.0.0.1:4000/api'
};
window.__GU_API_BASE__ = guLocalApiHosts[window.location.hostname]
  || PRODUCTION_API_BASE;
