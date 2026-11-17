(() => {
  const tokenKey = "orbitToken";
  const usernameKey = "username";
  const welcome = document.getElementById("welcome");
  const login = document.getElementById("auth-login");
  const signup = document.getElementById("auth-signup");
  const mainCta = document.getElementById("main-cta");
  const heroCta = document.getElementById("hero-cta");
  const secondary = document.getElementById("hero-secondary");

  let token = null;
  let username = "";
  try {
    token = localStorage.getItem(tokenKey);
    username = localStorage.getItem(usernameKey) || "";
  } catch (_) {}

  const signedIn = Boolean(token && token.length > 30);
  if (token && !signedIn) {
    try { localStorage.removeItem(tokenKey); localStorage.removeItem(usernameKey); } catch (_) {}
  }
  if (welcome) {
    welcome.textContent = signedIn && username
      ? `WELCOME BACK, ${username.toUpperCase()}`
      : "YOUR NEXT IDEA STARTS HERE";
  }

  if (signedIn) {
    if (login) login.style.display = "none";
    if (signup) signup.style.display = "none";
    if (mainCta) mainCta.textContent = "Open ORBIT";
    if (heroCta) heroCta.textContent = "Open ORBIT";
    if (secondary) { secondary.href = "#about"; secondary.textContent = "Explore features"; }
  } else {
    if (mainCta) { mainCta.href = "login.html"; mainCta.textContent = "Sign in to ORBIT"; }
    if (heroCta) { heroCta.href = "login.html"; heroCta.textContent = "Sign in to ORBIT"; }
  }
})();
