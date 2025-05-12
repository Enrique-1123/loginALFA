// public/auth.js
document.addEventListener('DOMContentLoaded', () => {
    const loginContainer = document.getElementById('login-container');
    const registerContainer = document.getElementById('register-container');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const showRegisterLink = document.getElementById('show-register-link');
    const showLoginLink = document.getElementById('show-login-link');
    const authMessageDiv = document.getElementById('auth-message');

    const authWrapper = document.getElementById('auth-wrapper');
    const appMainContent = document.querySelector('.app-main-content');
    const userGreetingSpan = document.getElementById('user-greeting');
    const logoutButton = document.getElementById('logout-button');

    function displayAuthMessage(message, type = 'info') {
        authMessageDiv.textContent = message;
        authMessageDiv.className = ''; // Limpiar clases previas
        if (message) { // Solo añadir clase de tipo si hay mensaje
            authMessageDiv.classList.add(`auth-message-${type}`);
        }
    }

    function showLoginFormView() {
        if(loginContainer) loginContainer.classList.remove('hidden');
        if(registerContainer) registerContainer.classList.add('hidden');
        if(appMainContent) appMainContent.classList.add('hidden');
        if(authWrapper) authWrapper.classList.remove('hidden');
        displayAuthMessage('');
        if (loginForm) loginForm.reset();
    }

    function showRegisterFormView() {
        if(loginContainer) loginContainer.classList.add('hidden');
        if(registerContainer) registerContainer.classList.remove('hidden');
        if(appMainContent) appMainContent.classList.add('hidden');
        if(authWrapper) authWrapper.classList.remove('hidden');
        displayAuthMessage('');
        if (registerForm) registerForm.reset();
    }

    function showAppContentView(user) {
        if(authWrapper) authWrapper.classList.add('hidden');
        if(appMainContent) appMainContent.classList.remove('hidden');
        if (userGreetingSpan && user) {
            userGreetingSpan.textContent = `¡Hola, ${user.displayName || user.username}!`;
        }
        document.dispatchEvent(new CustomEvent('userAuthenticated', { detail: { user } }));
    }

    if (showRegisterLink) {
        showRegisterLink.addEventListener('click', (e) => {
            e.preventDefault();
            showRegisterFormView();
        });
    }

    if (showLoginLink) {
        showLoginLink.addEventListener('click', (e) => {
            e.preventDefault();
            showLoginFormView();
        });
    }

    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            displayAuthMessage('Creando tu cuenta...', 'info');
            const formData = new FormData(registerForm);
            const data = Object.fromEntries(formData.entries());

            try {
                const response = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const result = await response.json();
                if (result.success) {
                    displayAuthMessage(result.message + " Ahora puedes iniciar sesión.", 'success');
                    setTimeout(() => showLoginFormView(), 2500);
                } else {
                    displayAuthMessage(result.message || (result.errors ? result.errors.join('. ') : 'Error desconocido.'), 'error');
                }
            } catch (error) {
                console.error('Error en el fetch de registro:', error);
                displayAuthMessage('No se pudo conectar al servidor. Intenta de nuevo más tarde.', 'error');
            }
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            displayAuthMessage('Iniciando sesión...', 'info');
            const formData = new FormData(loginForm);
            const data = Object.fromEntries(formData.entries());

            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const result = await response.json();
                if (result.success && result.token && result.user) {
                    localStorage.setItem('authToken', result.token);
                    localStorage.setItem('currentUser', JSON.stringify(result.user));
                    displayAuthMessage('');
                    showAppContentView(result.user);
                } else {
                    displayAuthMessage(result.message || (result.errors ? result.errors.join('. ') : 'Error al iniciar sesión.'), 'error');
                }
            } catch (error) {
                console.error('Error en el fetch de login:', error);
                displayAuthMessage('No se pudo conectar al servidor. Intenta de nuevo más tarde.', 'error');
            }
        });
    }

    if (logoutButton) {
        logoutButton.addEventListener('click', () => {
            localStorage.removeItem('authToken');
            localStorage.removeItem('currentUser');
            showLoginFormView();
            displayAuthMessage('Has cerrado sesión.', 'success');
            setTimeout(() => displayAuthMessage(''), 2000);
            document.dispatchEvent(new CustomEvent('userLoggedOut'));
        });
    }

    const token = localStorage.getItem('authToken');
    const storedUserString = localStorage.getItem('currentUser');

    if (token && storedUserString) {
        try {
            const user = JSON.parse(storedUserString);
            console.log('AUTH.JS: Usuario autenticado encontrado en localStorage, mostrando app:', user);
            showAppContentView(user);
        } catch (e) {
            console.error("AUTH.JS: Error parseando datos de usuario de localStorage, limpiando.", e);
            localStorage.removeItem('authToken');
            localStorage.removeItem('currentUser');
            showLoginFormView();
        }
    } else {
        console.log('AUTH.JS: No hay token/usuario en localStorage, mostrando formulario de login.');
        showLoginFormView(); // Mostrar login por defecto si no hay sesión activa
    }
});