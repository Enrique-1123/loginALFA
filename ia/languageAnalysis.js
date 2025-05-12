// ia/languageAnalysis.js
console.log('[languageAnalysis] Script cargado.');

class LanguageAnalyzer {
    constructor() {
        this.endpoint = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? 'http://localhost:3000/api/analyze-text' : '/api/analyze-text';
        this.minLength = 1; 
        console.log('LanguageAnalyzer inicializado. Endpoint:', this.endpoint, 'MinLength:', this.minLength);
        this.feedbackElement = document.getElementById('ai-feedback');
        this.statusElement = document.getElementById('api-status');
    }

    async analyzeText(text, errors) {
        if (!this.feedbackElement) { 
            console.error('[LA analyzeText] #ai-feedback no encontrado en el DOM.'); 
            return; 
        }
        console.log(`[LA analyzeText] Iniciando análisis...`);
        console.log('[LA analyzeText] Texto a analizar (primeros 50 chars):', text.substring(0, 50) + "...");
        console.log('[LA analyzeText] Errores recibidos para analizar:', JSON.stringify(errors, null, 2));


        this.feedbackElement.innerHTML = ''; // Limpiar contenido previo
        this.feedbackElement.classList.remove('has-error');
        this.feedbackElement.classList.add('is-loading');
        if (this.statusElement) this.statusElement.textContent = 'Generando consejos...';
        if (this.statusElement) this.statusElement.classList.remove('error-message');

        const socketId = window.socket && window.socket.id ? window.socket.id : null;
        console.log('[LA analyzeText] Usando socketId para la petición:', socketId);

        try {
            if (!text || text.trim().length < this.minLength) {
                 console.warn(`[LA analyzeText] Texto demasiado corto ('${text}') para análisis. Longitud: ${text.trim().length}, Mínimo: ${this.minLength}`);
                 this.feedbackElement.innerHTML = "<p>Escribe un poco más para obtener consejos detallados.</p>";
                 this.feedbackElement.classList.remove('is-loading');
                 return;
            }
            if (!Array.isArray(errors)) {
                console.error('[LA analyzeText] El parámetro "errors" no es un array.');
                throw new Error(`No se recibieron errores válidos para el análisis.`);
            }
            // Aunque haya errores, si el array está vacío, el servidor podría no tener qué explicar.
            // La lógica del servidor se encargará de esto, pero es bueno notarlo.
            if (errors.length === 0) {
                console.log('[LA analyzeText] No hay errores específicos que enviar al servidor para explicación.');
                // El servidor probablemente responderá con "no hay errores" o similar.
            }


            const response = await fetch(this.endpoint, {
                method: 'POST', headers: { 'Content-Type': 'application/json', },
                body: JSON.stringify({ text: text, errors: errors, socketId: socketId })
            });
            
            console.log('[LA analyzeText] Respuesta HTTP del servidor:', response.status, response.statusText);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Error desconocido del servidor al intentar parsear JSON de error.' }));
                console.error('[LA analyzeText] Error en la respuesta del servidor:', errorData);
                 if (this.statusElement) { this.statusElement.textContent = `Error al generar consejos: ${errorData.error || response.status}`; this.statusElement.classList.add('error-message'); }
                throw new Error(errorData.error || `Error del servidor (${response.status}).`);
            }

            const data = await response.json();
            console.log('[LA analyzeText] Respuesta JSON del servidor /api/analyze-text:', JSON.stringify(data, null, 2));


            if (data.success && data.analysis) {
                 this.feedbackElement.innerHTML = data.analysis;
                 console.log('[LA analyzeText] Feedback HTML establecido en #ai-feedback.');
            } else if (data.success && !data.analysis) {
                 console.warn('[LA analyzeText] El servidor respondió con éxito pero sin contenido de análisis (data.analysis está vacío/nulo).');
                 this.feedbackElement.innerHTML = "<p>No se generaron consejos específicos esta vez.</p>"; // Mensaje genérico
            }
            else {
                 console.error('[LA analyzeText] La respuesta del servidor no fue exitosa o no contenía análisis:', data.error);
                 throw new Error(data.error || 'No se recibieron sugerencias válidas del servidor.');
            }
        } catch (error) {
            console.error('[LA analyzeText] Excepción durante analyzeText:', error);
            this.feedbackElement.innerHTML = `<div class="error-display"><i class="fas fa-exclamation-triangle"></i> ${error.message || 'Fallo al obtener consejos.'}</div>`;
            this.feedbackElement.classList.add('has-error');
             if (this.statusElement && !this.statusElement.classList.contains('error-message')) {
                  this.statusElement.textContent = `Error generando consejos: ${error.message}`;
                  this.statusElement.classList.add('error-message');
             }
        } finally {
             if (this.feedbackElement.classList.contains('is-loading')) {
                this.feedbackElement.classList.remove('is-loading');
             }
             console.log('[LA analyzeText] Proceso de analyzeText finalizado.');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('[LA EvtListener] DOM cargado. Inicializando LanguageAnalyzer.');
    const analyzer = new LanguageAnalyzer();

    document.addEventListener('textCorrected', async (e) => {
        console.log('[LA EvtListener] Evento "textCorrected" recibido. Detalle completo:', JSON.stringify(e.detail, null, 2));
        
        const suggestionsTab = document.getElementById('ai-suggestions');
        const suggestionsTabIsActive = suggestionsTab?.classList.contains('active');
        console.log('[LA EvtListener] Pestaña de sugerencias (#ai-suggestions) encontrada:', !!suggestionsTab);
        console.log('[LA EvtListener] Pestaña de sugerencias está activa:', suggestionsTabIsActive);
        
        if (e.detail && e.detail.success && suggestionsTabIsActive) {
             if (e.detail.text && Array.isArray(e.detail.errors)) { // No es necesario verificar e.detail.errors.length > 0 aquí, analyzeText lo puede manejar
                 console.log('[LA EvtListener] Condiciones cumplidas. Llamando a analyzer.analyzeText con el texto y los errores.');
                 await analyzer.analyzeText(e.detail.text, e.detail.errors);
             } else {
                 console.warn('[LA EvtListener] No se llamó a analyzeText. Falta texto o el array de errores no es válido. Texto:', e.detail.text, 'Errores:', e.detail.errors);
                 if(analyzer.feedbackElement) {
                    analyzer.feedbackElement.innerHTML = "<p>No hay suficiente información de errores para analizar.</p>";
                 }
             }
        } else if (e.detail && !e.detail.success && suggestionsTabIsActive) {
            console.error('[LA EvtListener] Evento textCorrected indicó fallo en la corrección previa. Error:', e.detail.error);
            if(analyzer.feedbackElement) {
                analyzer.feedbackElement.innerHTML = `<div class="error-display">Hubo un problema al revisar el texto (${e.detail.error || 'Error desconocido'}). No se pueden generar consejos.</div>`;
            }
        } else if (!suggestionsTabIsActive) {
            console.log('[LA EvtListener] Pestaña de sugerencias no activa. No se pedirán consejos ahora.');
        } else {
            console.log('[LA EvtListener] Evento textCorrected no contiene información suficiente o no fue exitoso, y la pestaña de sugerencias podría estar activa.');
             if(analyzer.feedbackElement && suggestionsTabIsActive) { // Si la pestaña está activa pero no hay datos válidos
                analyzer.feedbackElement.innerHTML = "<p>Esperando texto revisado para mostrar consejos.</p>";
             }
        }
    });
});