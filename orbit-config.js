/* Shared ORBIT configuration. Keep this file before each page's own script. */
(() => {
  const host = window.location.hostname;
  const local = window.location.protocol === "file:" || host === "localhost" || host === "127.0.0.1";
  const separateFrontendHost = "orbit-website-sg7o.onrender.com";
  window.ORBIT_API_BASE = local
    ? "http://127.0.0.1:5000"
    : (host === separateFrontendHost ? "https://orbit-1-70mn.onrender.com" : "");
})();
