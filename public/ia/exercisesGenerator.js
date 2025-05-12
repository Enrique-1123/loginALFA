// ia/exercisesGenerator.js
console.log('[exercisesGenerator] Script cargado.');

class ExerciseGenerator {
    constructor() {
        this.endpoint = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? 'http://localhost:3000/api/generate-exercises' : '/api/generate-exercises';
        this.minLength = 1; // AJUSTA ESTO si quieres un mínimo mayor (ej. 10)
        
        this.container = document.getElementById('exercises-container');
        this.button = document.getElementById('generate-exercises-btn');
        this.statusElement = document.getElementById('api-status');

        console.log(`ExerciseGenerator inicializado. Endpoint: ${this.endpoint}, MinLength: ${this.minLength}`);
        if (!this.container) console.error("[EG Constructor] Falta #exercises-container en el DOM.");
        if (!this.button) console.error("[EG Constructor] Falta #generate-exercises-btn en el DOM.");
        if (!this.statusElement) console.warn("[EG Constructor] Falta #api-status en el DOM (opcional).");
    }

    async generateExercises(text) {
        if (!this.container || !this.button) {
            console.error('[EG generateExercises] Contenedor o botón de ejercicios no encontrado. Abortando.');
            return;
        }
        console.log(`[EG generateExercises] Solicitando ejercicios para texto (primeros 50 chars): "${text.substring(0,50)}..."`);

        // Validación de longitud mínima
        if (!text || text.trim().length < this.minLength) {
            const userMessage = `Por favor, escribe al menos ${this.minLength} ${this.minLength === 1 ? 'carácter' : 'caracteres'} para crear ejercicios.`;
            console.warn('[EG generateExercises] Validación:', userMessage);
            this.container.innerHTML = `<div class="error-display" style="text-align:center; padding:10px; color: #721c24; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px;"><i class="fas fa-info-circle"></i> ${userMessage}</div>`;
            // No es necesario 'is-loading' o 'has-error' para esto, ya que es un mensaje de validación
            return; // Salir temprano, el 'finally' no se ejecutará
        }

        this.container.innerHTML = ''; // Limpiar previo
        this.container.classList.remove('has-error');
        this.container.classList.add('is-loading'); // Mostrar estado de carga
        this.button.disabled = true;
        this.button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando Ejercicios...';
        if (this.statusElement) {
            this.statusElement.textContent = 'Preparando tus ejercicios...';
            this.statusElement.classList.remove('error-message');
            this.statusElement.style.display = 'block';
        }

        // Usar window.appSocket si es la variable correcta para el socket post-login
        const socketId = window.appSocket && window.appSocket.id ? window.appSocket.id : null;
        console.log('[EG generateExercises] Usando socketId (para status backend):', socketId || "N/A");

        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text.substring(0, 1500), socketId: socketId }) // Enviar texto y socketId
            });

            console.log('[EG generateExercises] Respuesta HTTP del servidor:', response.status, response.statusText);

            // Clonar para leer texto crudo si es necesario (útil si response.json() falla)
            const responseClone = response.clone();

            if (!response.ok) {
                let errorData;
                try {
                    errorData = await response.json();
                } catch (jsonError) {
                    // Si no es JSON, intentar obtener texto
                    const errorText = await responseClone.text();
                    console.error('[EG generateExercises] Respuesta de error no es JSON:', errorText);
                    errorData = { error: `Error del servidor (${response.status}). Respuesta no fue JSON.` };
                }
                console.error('[EG generateExercises] Error en la respuesta del servidor:', errorData);
                if (this.statusElement) {
                    this.statusElement.textContent = `Error al crear ejercicios: ${errorData.error || response.statusText}`;
                    this.statusElement.classList.add('error-message');
                }
                throw new Error(errorData.error || `Error del servidor (${response.statusText})`);
            }

            const data = await response.json();
            console.log('[EG generateExercises] Datos JSON recibidos del servidor:', data);

            if (this.statusElement && data.success) {
                // El servidor podría enviar un status por socket, o podemos limpiar aquí
                 this.statusElement.textContent = '¡Ejercicios listos!'; // O simplemente '' para limpiar
                 setTimeout(() => { if(this.statusElement && this.statusElement.textContent === '¡Ejercicios listos!') this.statusElement.style.display = 'none'; }, 3000);
            }

            if (data.success && data.exercises) {
                this.container.innerHTML = data.exercises;
                console.log('[EG generateExercises] HTML de ejercicios establecido en el contenedor.');
            } else {
                console.error('[EG generateExercises] El servidor respondió con éxito pero sin datos de ejercicios, o data.success fue false.');
                throw new Error(data.error || 'No se recibieron ejercicios válidos del servidor.');
            }
        } catch (error) {
            console.error('[EG generateExercises] Excepción durante la generación de ejercicios:', error);
            this.container.innerHTML = `<div class="error-display"><i class="fas fa-exclamation-triangle"></i> ${error.message || 'Fallo al crear los ejercicios. Intenta de nuevo.'}</div>`;
            this.container.classList.add('has-error'); // Marcar que hubo un error
            if (this.statusElement && !this.statusElement.classList.contains('error-message')) {
                 this.statusElement.textContent = `Error al crear ejercicios: ${error.message}`;
                 this.statusElement.classList.add('error-message');
                 this.statusElement.style.display = 'block';
            }
        } finally {
             this.container.classList.remove('is-loading'); // Siempre quitar estado de carga
             this.button.disabled = false; // Siempre reactivar botón
             this.button.innerHTML = '<i class="fas fa-plus-circle"></i> Crear Nuevos Ejercicios';
             console.log('[EG generateExercises] Proceso de generación finalizado.');
        }
    }
}

// La instanciación (ej. window.exerciseGeneratorInstance = new ExerciseGenerator();)
// debería ocurrir DESPUÉS de que el DOM esté cargado y preferiblemente después
// de que el usuario se autentique, si depende de elementos que solo son visibles post-login.
// Podrías hacerlo en tu script.js dentro del listener de 'userAuthenticated'.