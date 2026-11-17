const form = document.getElementById("loginForm");

// Use the local server when testing on your computer,
// and the Render server when the site is online.
const API = window.ORBIT_API_BASE;

form.addEventListener("submit", async function (event) {
    event.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    if (username === "" || password === "") {
        alert("Please enter both your username and password.");
        return;
    }
    try {
        const response = await fetch(`${API}/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: username,
                password: password
            })
        });

        const result = await response.json();

        if (!response.ok) {
            alert(result.error || "Login failed.");
            return;
        }

        // Save the login so the chat page knows who you are.
        localStorage.setItem("orbitToken", result.token);
        localStorage.setItem("username", result.username || username);

        window.location.href = "orbithome.html";

    } catch (error) {
        console.error("Login error:", error);
        alert("Could not connect to ORBIT. Please try again.");
    }
});
