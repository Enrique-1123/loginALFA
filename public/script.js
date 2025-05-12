// public/script.js (Integrado con el sistema de autenticación)

console.log('[script.js] Script principal cargado. Esperando autenticación del usuario...');

let isAppFunctionalityInitialized = false;
let currentUserData = null; // Para guardar datos del usuario logueado si se necesitan globalmente en este script

// Variables de estado que podrían necesitar ser accesibles por funciones de limpieza o entre funciones
window.appStream = null; // Para el stream de la cámara
document.appFacingMode = 'environment'; // Modo de cámara por defecto
window.isCapturingOCR = false; // Estado de captura OCR
window.appSocket = null; // Referencia al socket de la aplicación

// --- FUNCIÓN PRINCIPAL DE INICIALIZACIÓN DE LA APP (SE LLAMA DESPUÉS DEL LOGIN) ---
function initializeMainAppFunctionality(userData) {
    if (isAppFunctionalityInitialized) {
        console.log('[script.js] La funcionalidad principal de la app ya está inicializada.');
        // Podrías querer actualizar currentUserData aquí si el login refresca datos
        currentUserData = userData;
        // Y quizás refrescar partes específicas de la UI que dependen del usuario
        // como el saludo, si ya fue inicializada previamente en la misma sesión de página.
        const userGreetingSpan = document.getElementById('user-greeting');
        if (userGreetingSpan && currentUserData) {
            userGreetingSpan.textContent = `¡Hola, ${currentUserData.displayName || currentUserData.username}!`;
        }
        return;
    }
    currentUserData = userData;
    console.log('[script.js] Usuario autenticado:', currentUserData, '. Inicializando funcionalidad principal de la aplicación...');

    // --- OBTENER ELEMENTOS DEL DOM DE LA APP PRINCIPAL ---
    const inputText = document.getElementById('input-text');
    const outputText = document.getElementById('output-text');
    const errorCount = document.getElementById('error-count');
    const openCameraBtn = document.getElementById('open-camera');
    const captureBtn = document.getElementById('capture-btn');
    const flipCameraBtn = document.getElementById('flip-camera'); // Asegúrate que este ID exista si lo usas
    const cameraView = document.getElementById('camera-view');
    // const cameraCanvas = document.getElementById('camera-canvas'); // Se obtiene en captureText
    // const flashElement = document.getElementById('capture-flash'); // Se obtiene en captureText
    // const ocrStatus = document.getElementById('ocr-status'); // Se obtiene en captureText
    const checkTextBtn = document.getElementById('check-text-btn');
    const statusElement = document.getElementById('api-status'); // Para mensajes de estado generales
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const chatSendBtn = document.getElementById('chat-send-btn');
    const talkButtonChat = document.getElementById('talk-button'); // Micrófono del chat
    const dictateButton = document.getElementById('dictate-button'); // Micrófono principal de la app

    // Verificar elementos cruciales para la app (no los de auth)
    if (!inputText || !outputText || !errorCount || !openCameraBtn || !captureBtn || !cameraView ) {
         console.error("¡ERROR SCRIPT.JS! Faltan elementos esenciales de la UI de la app principal. Revisa los IDs.");
         alert("Error crítico: Algunos componentes de la aplicación no se cargaron correctamente.");
         return;
    }

    // --- VARIABLES DE ESTADO ESPECÍFICAS DE LA APP (SI NO SON YA GLOBALES) ---
    let debounceTimer;
    const debounceDelay = 750;
    let isCheckingSpelling = false;
    // window.isCapturingOCR ya es global

    // --- CONFIGURACIÓN DE VOZ (SPEECH RECOGNITION & SYNTHESIS) ---
    const synth = window.speechSynthesis;
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let currentMicButtonActive = null; // Para saber qué botón de mic está 'escuchando'

    if (SpeechRecognitionAPI) {
        try {
            recognition = new SpeechRecognitionAPI();
            recognition.lang = "es-ES";
            recognition.continuous = false;
            recognition.interimResults = false;

            recognition.onstart = () => {
                console.log("[SR] Escuchando...");
                updateStatusUI("Escuchando atentamente...", false); // Usar nuestra función de UI
                if (currentMicButtonActive) currentMicButtonActive.classList.add('is-listening');
            };
            recognition.onresult = (event) => {
                const transcript = event.results[event.results.length - 1][0].transcript;
                console.log("[SR] Texto reconocido:", transcript);
                if (currentMicButtonActive === talkButtonChat && chatInput) { // Si el mic del chat está activo
                    chatInput.value = transcript;
                    // Opcional: si quieres enviar al presionar Enter o algo así
                    // sendChatMessageFromApp(transcript); 
                } else if (currentMicButtonActive === dictateButton && inputText) { // Si el mic de la app está activo
                    inputText.value += (inputText.value ? ' ' : '') + transcript;
                    inputText.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                }
            };
            recognition.onerror = (event) => {
                console.error("[SR] Error de reconocimiento:", event.error);
                let e = "Error al reconocer voz.";
                if(event.error === 'no-speech') e = "No detecté que hablaras. Intenta de nuevo.";
                else if(event.error === 'audio-capture') e = "Hubo un problema con tu micrófono.";
                else if(event.error === 'not-allowed') e = "No diste permiso para usar el micrófono.";
                else if(event.error === 'network') e = "Problema de red al reconocer voz.";
                updateStatusUI(e, true);
            };
            recognition.onend = () => {
                console.log("[SR] Escucha terminada.");
                updateStatusUI("", false); // Limpiar mensaje de estado
                if (currentMicButtonActive) currentMicButtonActive.classList.remove('is-listening');
                currentMicButtonActive = null;
            };

            if (dictateButton) {
                dictateButton.addEventListener("click", () => {
                    if (!recognition) return alert("El reconocimiento de voz no está disponible en tu navegador.");
                    try {
                        if (synth?.speaking) synth.cancel();
                        currentMicButtonActive = dictateButton;
                        console.log("[SR] Iniciando escucha para dictado principal...");
                        recognition.start();
                    } catch (e) {
                        console.error("Error al iniciar dictado principal:", e);
                        updateStatusUI("No se pudo iniciar la escucha.", true);
                        if (currentMicButtonActive) currentMicButtonActive.classList.remove('is-listening');
                    }
                });
            }
            if (talkButtonChat) {
                talkButtonChat.addEventListener("click", () => {
                    if (!recognition) return alert("El reconocimiento de voz no está disponible en tu navegador.");
                    try {
                        if (synth?.speaking) synth.cancel();
                        currentMicButtonActive = talkButtonChat;
                        console.log("[SR] Iniciando escucha para chat...");
                        recognition.start();
                    } catch (e) {
                        console.error("Error al iniciar escucha del chat:", e);
                        updateStatusUI("No se pudo iniciar la escucha del chat.", true);
                        if (currentMicButtonActive) currentMicButtonActive.classList.remove('is-listening');
                    }
                });
            }
        } catch (e) {
            console.error("Error crítico inicializando SpeechRecognition:", e);
            if (dictateButton) dictateButton.disabled = true;
            if (talkButtonChat) talkButtonChat.disabled = true;
            alert("El reconocimiento de voz no se pudo iniciar.");
        }
    } else {
        console.warn("API de Reconocimiento de Voz no soportada.");
        if (dictateButton) dictateButton.disabled = true;
        if (talkButtonChat) talkButtonChat.disabled = true;
    }
    if (!synth) {
        console.warn("API de Síntesis de Voz no soportada.");
    } else {
        if (synth.getVoices().length === 0) { // Intentar cargar voces si no están listas
            synth.onvoiceschanged = () => {
                console.log(`[SS] Voces de síntesis cargadas: ${synth.getVoices().length}`);
                synth.onvoiceschanged = null; // Remover listener para evitar múltiples logs
            };
            synth.getVoices(); // Disparar carga
        } else {
             console.log(`[SS] Voces de síntesis ya disponibles: ${synth.getVoices().length}`);
        }
    }


    // --- CONFIGURACIÓN DE SOCKET.IO (CHAT) ---
    if (typeof io !== 'undefined') {
        if (!window.appSocket || !window.appSocket.connected) {
            console.log('[script.js] Conectando a Socket.IO para el chat...');
            window.appSocket = io(); // Asume que el servidor Socket.IO está en el mismo host/puerto

            window.appSocket.on('connect', () => {
                console.log('[Socket.IO] Conectado al servidor de chat con ID:', window.appSocket.id);
                // El mensaje de bienvenida del servidor se manejará con el listener 'server_message' o 'chat_message_from_server'
            });
            window.appSocket.on('disconnect', () => {
                console.log('[Socket.IO] Desconectado del servidor de chat.');
                displayChatMessageInApp('Desconectado del chat. Intentando reconectar...', 'system', 'error');
            });
            window.appSocket.on('server_message', (data) => {
                displayChatMessageInApp(data.message, 'server');
            });
            window.appSocket.on('ia_status_update', (data) => { // Para mensajes de estado de IA del servidor
                updateStatusUI(data.message, data.isError);
            });
            window.appSocket.on('chat_message_from_server', (data) => {
                const thinkingMessage = chatMessages?.querySelector('.message-thinking');
                if (thinkingMessage) thinkingMessage.remove();
                displayChatMessageInApp(data.message, 'server', data.senderType);
                if (data.senderType === 'bot' && data.message && typeof speakText === 'function') {
                    speakText(data.message);
                }
            });
        }
        if (chatSendBtn && chatInput) {
            chatSendBtn.addEventListener('click', () => sendChatMessageFromApp(chatInput.value));
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && chatInput.value.trim()) {
                    e.preventDefault();
                    sendChatMessageFromApp(chatInput.value);
                }
            });
        }
    } else {
        console.warn("Socket.IO client no está cargado. El chat no funcionará.");
        if(chatSendBtn) chatSendBtn.disabled = true;
        if(talkButtonChat) talkButtonChat.disabled = true;
    }

    // --- LISTENERS DE UI PRINCIPAL (CÁMARA, OCR, TEXTO) ---
    if (openCameraBtn) openCameraBtn.addEventListener('click', toggleCamera);
    if (flipCameraBtn) flipCameraBtn.addEventListener('click', flipCamera);
    if (captureBtn) captureBtn.addEventListener('click', captureText);

    if (inputText) {
        inputText.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            const currentText = inputText.value;
            if (currentText.trim().length >= 1) {
                if (checkTextBtn) checkTextBtn.style.display = 'inline-block';
                debounceTimer = setTimeout(() => checkSpelling(currentText), debounceDelay);
            } else {
                if (checkTextBtn) checkTextBtn.style.display = 'none';
                if (outputText) outputText.innerHTML = '';
                if (errorCount) errorCount.textContent = '0 errores';
                const aiFeedbackDiv = document.getElementById('ai-feedback');
                if (aiFeedbackDiv) aiFeedbackDiv.innerHTML = '<p>Revisa tu texto y aquí aparecerán explicaciones.</p>';
            }
        });
    }
    if (checkTextBtn) {
        checkTextBtn.addEventListener('click', () => {
            if (inputText && inputText.value.trim().length >= 1) {
                clearTimeout(debounceTimer);
                checkSpelling(inputText.value);
            } else {
                alert("Por favor, escribe algo en el área de texto antes de revisar.");
            }
        });
    }

    // --- LÓGICA DE PESTAÑAS DE LA ZONA DE APRENDIZAJE ---
    const tabButtons = document.querySelectorAll('.ai-tabs .ai-tab');
    const tabContents = document.querySelectorAll('.ai-tabcontent');
    let activeTabFound = false;
    tabButtons.forEach(button => {
        if (button.classList.contains('active')) activeTabFound = true;
        button.addEventListener('click', (event) => {
            const clickedButton = event.currentTarget;
            const tabName = clickedButton.id.replace('-tab', '');
            const targetContentId = `ai-${tabName}`;
            tabContents.forEach(content => content.classList.remove('active'));
            tabButtons.forEach(btn => btn.classList.remove('active'));
            const targetContent = document.getElementById(targetContentId);
            if (targetContent) {
                targetContent.classList.add('active');
                clickedButton.classList.add('active');
                console.log(`[Tabs] Pestaña activada: ${tabName}`);
                // Lógica específica si el UserProfileManager está cargado/instanciado
                if (tabName === 'progress' && typeof UserProfileManager !== 'undefined' && window.userProfileManagerInstance) {
                    window.userProfileManagerInstance.updateUI();
                }
            } else {
                console.error(`[Tabs] Contenido no encontrado para: ${targetContentId}`);
            }
        });
    });
    if (!activeTabFound && tabButtons.length > 0 && tabContents.length > 0) {
        const firstTabButton = tabButtons[0];
        const firstTabContentId = `ai-${firstTabButton.id.replace('-tab', '')}`;
        const firstTabContent = document.getElementById(firstTabContentId);
        if (firstTabButton && firstTabContent) {
            firstTabButton.classList.add('active');
            firstTabContent.classList.add('active');
        }
    }
    
    // Si tus scripts de IA (userProfile.js, languageAnalysis.js, exercisesGenerator.js)
    // se cargan en index.html y necesitan inicializarse o acceder a `currentUserData`,
    // podrías disparar otro evento aquí o llamarlos directamente.
    // Ejemplo:
    if (typeof UserProfileManager !== 'undefined') {
        window.userProfileManagerInstance = new UserProfileManager(); // Asumiendo que la clase está disponible
        window.userProfileManagerInstance.updateUI(); // Actualizar UI de perfil al inicio
    }
    if (typeof LanguageAnalyzer !== 'undefined' && !window.languageAnalyzerInstance) { // Evitar múltiples instancias si se recarga
        window.languageAnalyzerInstance = new LanguageAnalyzer();
    }
     // El listener para 'generate-exercises-btn' suele estar en el script de index.html o en exercisesGenerator.js

    console.log('[script.js] Funcionalidad principal de la aplicación completamente inicializada.');
    isAppFunctionalityInitialized = true;
}


// --- FUNCIÓN DE DESINICIALIZACIÓN (CUANDO EL USUARIO CIERRA SESIÓN) ---
function deinitializeAppFunctionality() {
    console.log('[script.js] Desinicializando funcionalidad principal de la app...');
    if (typeof stopCamera === "function" && window.appStream) {
        stopCamera();
    }
    if (window.appSocket && window.appSocket.connected) {
        console.log('[script.js] Desconectando Socket.IO...');
        window.appSocket.disconnect();
    }
    window.appSocket = null;

    // Limpiar elementos de la UI principal
    const UIElementsToClear = [
        { id: 'input-text', type: 'value' }, { id: 'output-text', type: 'html' },
        { id: 'error-count', type: 'text', default: '0 errores' },
        { id: 'ocr-status', type: 'html', styleDisplay: 'none' },
        { id: 'api-status', type: 'html', styleDisplay: 'none' },
        { id: 'ai-feedback', type: 'html', default: '<p>Revisa tu texto y aquí aparecerán explicaciones.</p>' },
        { id: 'exercises-container', type: 'html' },
        { id: 'chat-messages', type: 'html'} // Limpiar mensajes del chat
    ];
    UIElementsToClear.forEach(item => {
        const el = document.getElementById(item.id);
        if (el) {
            if (item.type === 'value') el.value = '';
            else if (item.type === 'html') el.innerHTML = item.default || '';
            else if (item.type === 'text') el.textContent = item.default || '';
            if (item.styleDisplay) el.style.display = item.styleDisplay;
        }
    });
    const checkTextBtn = document.getElementById('check-text-btn');
    if (checkTextBtn) checkTextBtn.style.display = 'none';
    
    // Desactivar botones de cámara
    const openCameraBtn = document.getElementById('open-camera');
    const captureBtn = document.getElementById('capture-btn');
    const flipCameraBtn = document.getElementById('flip-camera');
    if(openCameraBtn) { openCameraBtn.innerHTML = '<i class="fas fa-camera"></i> Activar Cámara'; openCameraBtn.disabled = false; }
    if(captureBtn) captureBtn.disabled = true;
    if(flipCameraBtn) flipCameraBtn.disabled = true;


    // Detener reconocimiento de voz si está activo
    const speechRecognition = window.appRecognition; // Si guardaste la instancia globalmente
    if (speechRecognition) {
        try { speechRecognition.stop(); } catch(e) { /* ignorar si ya está parado */ }
    }
    // Detener síntesis de voz
    const synth = window.speechSynthesis;
    if (synth && synth.speaking) synth.cancel();


    isAppFunctionalityInitialized = false;
    currentUserData = null;
    console.log('[script.js] Funcionalidad principal desinicializada.');
}

// --- LISTENERS PARA EVENTOS DE AUTENTICACIÓN ---
document.addEventListener('userAuthenticated', (event) => {
    if (!isAppFunctionalityInitialized) {
        initializeMainAppFunctionality(event.detail.user);
    } else { // Si la app ya estaba inicializada (ej. por un refresh con token válido)
        console.log("[script.js] App ya estaba inicializada, actualizando datos de usuario.");
        currentUserData = event.detail.user;
        const userGreetingSpan = document.getElementById('user-greeting');
        if (userGreetingSpan && currentUserData) { // Refrescar saludo
            userGreetingSpan.textContent = `¡Hola, ${currentUserData.displayName || currentUserData.username}!`;
        }
        // Aquí podrías reconectar el socket si es necesario o refrescar otros datos de UI
        if (typeof io !== 'undefined' && (!window.appSocket || !window.appSocket.connected)) {
            console.log("Intentando reconectar socket tras autenticación en app ya inicializada.");
            // Lógica de (re)conexión de socket aquí si es necesario.
            // Esto es complejo, idealmente la inicialización del socket ocurre una vez.
        }
    }
});

document.addEventListener('userLoggedOut', () => {
    deinitializeAppFunctionality();
});


// --- DEFINICIONES DE FUNCIONES AUXILIARES Y PRINCIPALES DE LA APP ---
// (Deben estar aquí para que initializeMainAppFunctionality pueda usarlas)

function updateStatusUI(message, isError = false) {
    const statusElement = document.getElementById('api-status');
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.style.display = message ? 'block' : 'none';
    if (isError) statusElement.classList.add('error-message');
    else statusElement.classList.remove('error-message');
    
    if (message) { // Autoclear solo si hay mensaje
        setTimeout(() => {
            if (statusElement.textContent === message) { // Solo limpiar si es el mismo mensaje
                statusElement.textContent = '';
                statusElement.style.display = 'none';
                statusElement.classList.remove('error-message');
            }
        }, 5000);
    }
}

function displayChatMessageInApp(message, sender = 'server', senderType = '') {
    const chatMessagesContainer = document.getElementById('chat-messages');
    if (!chatMessagesContainer) { console.warn("Contenedor de chat no encontrado"); return; }
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message');

    if (senderType === 'bot_thinking') messageElement.classList.add('message-thinking');
    else if (senderType === 'bot_error' || (sender === 'system' && senderType === 'error')) {
        messageElement.classList.add('message-server', 'message-error');
        if (sender === 'system') messageElement.classList.add('message-system');
    }
    else if (sender === 'user') messageElement.classList.add('message-user');
    else if (sender === 'system') messageElement.classList.add('message-system');
    else messageElement.classList.add('message-server');
    
    messageElement.textContent = message; // Usar textContent para seguridad por defecto
    chatMessagesContainer.appendChild(messageElement);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

function sendChatMessageFromApp(messageContent) {
    const trimmedMessage = messageContent.trim();
    if (trimmedMessage && window.appSocket && window.appSocket.connected) {
        displayChatMessageInApp(trimmedMessage, 'user');
        window.appSocket.emit('chat_message_from_client', { message: trimmedMessage });
        const chatInputElement = document.getElementById('chat-input');
        if (chatInputElement) chatInputElement.value = '';
    } else if (!window.appSocket || !window.appSocket.connected) {
        displayChatMessageInApp('No estás conectado al chat.', 'system', 'error');
    } else if (!trimmedMessage) {
        // No hacer nada si el mensaje está vacío después de trim
    }
}

async function toggleCamera() {
    const openCameraBtn = document.getElementById('open-camera');
    const captureBtn = document.getElementById('capture-btn');
    const flipCameraBtn = document.getElementById('flip-camera');
    const cameraView = document.getElementById('camera-view');
    const cameraCanvas = document.getElementById('camera-canvas');

    if (!openCameraBtn || !captureBtn || !flipCameraBtn || !cameraView) {
        console.error("Elementos de cámara no encontrados en toggleCamera");
        return;
    }

    if (window.appStream) {
        stopCamera();
    } else {
        try {
            openCameraBtn.disabled = true; openCameraBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Abriendo...';
            window.appStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: document.appFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            });
            cameraView.srcObject = window.appStream;
            await new Promise((resolve, reject) => {
                cameraView.onloadedmetadata = resolve;
                cameraView.onerror = (e) => { console.error("Error en onloadedmetadata de video", e); reject(e); };
            });
            await cameraView.play();
            openCameraBtn.innerHTML = '<i class="fas fa-video-slash"></i> Desactivar Cámara';
            captureBtn.disabled = false;
            flipCameraBtn.disabled = false;
            cameraView.style.display = 'block';
            if (cameraCanvas) cameraCanvas.style.display = 'none';
        } catch (e) {
            console.error('Error al activar la cámara:', e.name, e.message);
            let alertMsg = 'No se pudo activar la cámara.';
            if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
                alertMsg = 'No diste permiso para usar la cámara.';
            } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
                alertMsg = 'No se encontró una cámara conectada.';
            } else if (e.name === 'NotReadableError' || e.name === 'TrackStartError') {
                alertMsg = 'La cámara ya está en uso o no se puede acceder.';
            }
            alert(alertMsg);
            openCameraBtn.innerHTML = '<i class="fas fa-camera"></i> Activar Cámara';
            stopCamera(); // Asegurarse de que todo esté limpio
        } finally {
            openCameraBtn.disabled = false;
        }
    }
}

async function flipCamera() {
    if (!window.appStream) return; // Solo si la cámara está activa
    document.appFacingMode = document.appFacingMode === 'user' ? 'environment' : 'user';
    console.log('Cambiando cámara a:', document.appFacingMode);
    await stopCamera(); // Detener la cámara actual
    await toggleCamera(); // Iniciar con el nuevo modo
}

function stopCamera() {
    if (window.appStream) {
        window.appStream.getTracks().forEach(track => track.stop());
        window.appStream = null;
        console.log('Cámara detenida.');
    }
    const cameraView = document.getElementById('camera-view');
    const cameraCanvas = document.getElementById('camera-canvas');
    const openCameraBtn = document.getElementById('open-camera');
    const captureBtn = document.getElementById('capture-btn');
    const flipCameraBtn = document.getElementById('flip-camera');
    const ocrStatusDiv = document.getElementById('ocr-status');

    if (cameraView) { cameraView.srcObject = null; cameraView.style.display = 'none'; }
    if (cameraCanvas) cameraCanvas.style.display = 'none';
    if (openCameraBtn) openCameraBtn.innerHTML = '<i class="fas fa-camera"></i> Activar Cámara';
    if (captureBtn) captureBtn.disabled = true;
    if (flipCameraBtn) flipCameraBtn.disabled = true;
    if (ocrStatusDiv) ocrStatusDiv.style.display = 'none';
}

async function captureText() {
    const outputText = document.getElementById('output-text');
    const inputText = document.getElementById('input-text');
    const errorCount = document.getElementById('error-count');
    const cameraCanvas = document.getElementById('camera-canvas');
    const cameraView = document.getElementById('camera-view');
    const ocrStatus = document.getElementById('ocr-status');
    const captureBtn = document.getElementById('capture-btn');
    const flashElement = document.getElementById('capture-flash');

    if (typeof Tesseract === 'undefined') {
        console.error("OCR Error: Tesseract.js no está cargado.");
        if (outputText) outputText.innerHTML = `<div class="error">Error: Herramienta de lectura no lista.</div>`;
        return;
    }
    if (!window.appStream || window.isCapturingOCR || !cameraCanvas || !inputText || !outputText || !errorCount || !captureBtn || !ocrStatus) {
        console.warn('OCR: No se puede iniciar la captura (stream, !isCapturing, elementos DOM).');
        return;
    }

    console.log('OCR Iniciando...');
    window.isCapturingOCR = true;
    captureBtn.disabled = true;
    captureBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Leyendo...';
    ocrStatus.style.display = 'block';
    ocrStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparando imagen...';
    inputText.value = "";
    outputText.innerHTML = "";
    if (errorCount) errorCount.textContent = '0 errores';

    if (flashElement) {
        flashElement.classList.add('flashing');
        setTimeout(() => flashElement.classList.remove('flashing'), 300);
    }

    const ctx = cameraCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !cameraView.videoWidth || !cameraView.videoHeight) {
        console.error('OCR Error: Contexto de canvas o dimensiones de video no disponibles.');
        window.isCapturingOCR = false; captureBtn.disabled = false; captureBtn.innerHTML = '<i class="fas fa-magic"></i> Capturar Texto'; ocrStatus.style.display = 'none';
        if (outputText) outputText.innerHTML = `<div class="error">Problema al preparar la cámara para captura.</div>`;
        return;
    }

    cameraCanvas.width = cameraView.videoWidth;
    cameraCanvas.height = cameraView.videoHeight;

    if (document.appFacingMode === 'user') {
        ctx.save(); ctx.scale(-1, 1);
        ctx.drawImage(cameraView, -cameraCanvas.width, 0, cameraCanvas.width, cameraCanvas.height);
        ctx.restore();
    } else {
        ctx.drawImage(cameraView, 0, 0, cameraCanvas.width, cameraCanvas.height);
    }

    try {
        const imageData = ctx.getImageData(0, 0, cameraCanvas.width, cameraCanvas.height);
        const data = imageData.data;
        const threshold = 120; // Umbral para binarización. ¡EXPERIMENTA con este valor (90-150)!

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const grayscale = 0.299 * r + 0.587 * g + 0.114 * b;
            data[i] = data[i + 1] = data[i + 2] = (grayscale > threshold ? 255 : 0); // Blanco o Negro
        }
        ctx.putImageData(imageData, 0, 0);
    } catch (preprocError) {
        console.error("Error durante el preprocesamiento de imagen para OCR:", preprocError);
    }

    try {
        ocrStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analizando la imagen...';
        const imgUrl = cameraCanvas.toDataURL('image/png');
        if (!imgUrl || imgUrl === 'data:,') throw new Error("No se pudo generar la URL de la imagen del canvas.");

        const worker = await Tesseract.createWorker('spa', 1, { // 'spa' para español
            logger: m => {
                if (ocrStatus) {
                    if (m.status === 'recognizing text') {
                        const p = (m.progress * 100).toFixed(0);
                        ocrStatus.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Leyendo texto: ${p}%`;
                    } else if (m.status && !m.status.startsWith('terminate')) { // Evitar mostrar "terminate"
                        ocrStatus.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${m.status}...`;
                    }
                }
            }
        });
        // Page Segmentation Mode (PSM): ¡EXPERIMENTA con estos!
        // '11': Asume una sola palabra bien espaciada. Bueno para palabras sueltas.
        // '8': Asume una sola palabra.
        // '10': Asume un solo carácter.
        // '7': Trata la imagen como una sola línea de texto.
        // '6': Asume un bloque uniforme de texto (default de Tesseract CLI, a veces bueno).
        // '13': Modo crudo, trata la imagen como una línea sin análisis de OSD o segmentación.
        await worker.setParameters({ tessedit_pageseg_mode: '11' });
        // Opcional: Lista blanca de caracteres si esperas un conjunto limitado
        // await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZabcdefghijklmnñopqrstuvwxyz0123456789áéíóúüÁÉÍÓÚÜ' });
        
        const { data: { text: recText } } = await worker.recognize(imgUrl);
        await worker.terminate();
        console.log('OCR Texto Reconocido Directo:', recText);

        let processedText = recText.trim();
        // Aplicar cleanText solo si hay algo de texto y es más que unos pocos caracteres,
        // ya que cleanText puede ser agresivo con símbolos o letras sueltas.
        if (processedText.length > 2 && typeof cleanText === 'function') {
            processedText = cleanText(processedText);
        }
        console.log('OCR Texto Procesado Final:', processedText);

        if (processedText) {
            inputText.value = processedText;
            if (typeof checkSpelling === 'function') checkSpelling(processedText);
        } else {
            console.log('Tesseract no devolvió texto útil tras el procesamiento.');
            if (outputText) outputText.innerHTML = `<div style="text-align: center; padding: 10px;">No pude leer nada esta vez. ¿Intentamos de nuevo con más luz o escribiendo más grande? 😊</div>`;
        }
    } catch (err) {
        console.error("Error durante el reconocimiento OCR con Tesseract:", err);
        inputText.value = ""; // Limpiar en caso de error
        let eMsg = 'Hubo un problema al intentar leer el texto de la imagen.';
        if (err && err.message) {
            if (err.message.includes('NetworkError') || err.message.includes('Failed to fetch')) eMsg = "Error de red al cargar la herramienta de lectura.";
            else if (err.message.includes('load_lang_model') || err.message.includes('.traineddata')) eMsg = "Error al cargar el modelo de lenguaje para leer.";
            else if (err.message.includes('SetImage') || err.message.includes('image') || err.message.includes('pixReadMemPng')) eMsg = "Error al procesar la imagen para leerla.";
        }
        if (outputText) outputText.innerHTML = `<div class="error"><i class="fas fa-exclamation-triangle"></i> ${eMsg}</div>`;
    } finally {
        if (ocrStatus) ocrStatus.style.display = 'none';
        if (captureBtn) { captureBtn.disabled = false; captureBtn.innerHTML = '<i class="fas fa-magic"></i> Capturar Texto'; }
        window.isCapturingOCR = false;
        console.log('Proceso de captura OCR finalizado.');
    }
}

function cleanText(text) {
    if (!text) return '';
    let cleaned = text.replace(/\s+/g, ' ').trim();
    // Regex menos agresiva, permite más símbolos que podrían ser parte de la escritura inicial.
    // Ajusta según sea necesario. Esta permite letras, números y puntuación muy común.
    cleaned = cleaned.replace(/[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜ .,¿?¡!]/g, '');
    return cleaned;
}

async function checkSpelling(textToCheck) {
    const outputText = document.getElementById('output-text');
    const errorCount = document.getElementById('error-count');
    const checkTextButton = document.getElementById('check-text-btn'); // Para deshabilitar
    let isCheckingSpellingInternal = false; // Variable local para esta función

    if (!outputText || !errorCount) { console.error("Elementos outputText o errorCount no encontrados en checkSpelling."); return; }
    
    if (!textToCheck.trim() || isCheckingSpellingInternal) {
        if (!textToCheck.trim()) { 
            outputText.innerHTML = '';
            if (errorCount) errorCount.textContent = '0 errores';
        }
        return;
    }

    isCheckingSpellingInternal = true;
    if(checkTextButton) checkTextButton.disabled = true; checkTextButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Revisando...';
    outputText.innerHTML = '<div class="loading">Revisando tu escritura...</div>';
    if (errorCount) errorCount.textContent = '';

    try {
        const response = await fetch('https://api.languagetool.org/v2/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
            body: new URLSearchParams({ text: textToCheck, language: 'es', enabledOnly: 'false' }) // enabledOnly:false para más reglas
        });
        
        if (!response.ok) {
            let errorDetail = `Error HTTP ${response.status}`;
            try { 
                const errorData = await response.json(); 
                errorDetail = `(${response.status}) ${errorData.message || errorDetail}`;
            } catch (e) { /* Mantener errorDetail original si el JSON falla */ }
            throw new Error(errorDetail);
        }
        const data = await response.json();
        console.log('LanguageTool - Errores detectados:', data.matches.length);
        displayCorrectedText(textToCheck, data.matches); // Asume que displayCorrectedText está definida
        const numErrors = data.matches.length;
        if (errorCount) errorCount.textContent = `${numErrors} ${numErrors === 1 ? 'error' : 'errores'} detectado${numErrors === 1 ? '' : 's'}`;
        
        document.dispatchEvent(new CustomEvent('textCorrected', { 
            detail: { text: textToCheck, errors: data.matches, success: true, userId: currentUserData ? currentUserData.id : null } 
        }));
    } catch (e) {
        console.error('Error en checkSpelling (LanguageTool):', e);
        outputText.innerHTML = `<div class="error">No se pudo revisar el texto.<br>(${e.message || 'Error de conexión o del servicio.'})</div>`;
        if (errorCount) errorCount.textContent = 'Error';
        document.dispatchEvent(new CustomEvent('textCorrected', { 
            detail: { text: textToCheck, errors: [], success: false, error: e.message || 'Fallo LanguageTool.', userId: currentUserData ? currentUserData.id : null } 
        }));
    } finally {
        isCheckingSpellingInternal = false;
        if(checkTextButton) {
            checkTextButton.disabled = false;
            checkTextButton.innerHTML = '<i class="fas fa-check"></i> Revisar Texto';
        }
        console.log('Revisión ortográfica finalizada.');
    }
}

function displayCorrectedText(originalText, matches) {
    const outputText = document.getElementById('output-text');
    if (!outputText) return;
    let htmlResult = '';
    let lastIndex = 0;
    matches.sort((a, b) => a.offset - b.offset); // Asegurar orden
    matches.forEach(match => {
        if (match.offset > lastIndex) {
            htmlResult += escapeHtml(originalText.substring(lastIndex, match.offset));
        }
        const incorrectText = originalText.substring(match.offset, match.offset + match.length);
        const suggestion = match.replacements && match.replacements.length > 0 ? match.replacements[0].value : match.shortMessage || match.message;
        htmlResult += `<span class="incorrect" title="Sugerencia: ${escapeHtml(suggestion)}">${escapeHtml(incorrectText)}</span>`;
        lastIndex = match.offset + match.length;
    });
    if (lastIndex < originalText.length) {
        htmlResult += escapeHtml(originalText.substring(lastIndex));
    }
    outputText.innerHTML = htmlResult || '<span class="correct">¡Muy bien! No encontré errores. 👍</span>';
}

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe ? String(unsafe) : '';
     return unsafe.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, "'").replace(/'/g, "'");
}

function speakText(textToSpeak) {
    const synth = window.speechSynthesis;
    if (!synth || !textToSpeak) {
        console.log("Síntesis de voz no disponible o no hay texto para hablar.");
        return;
    }
    if (synth.speaking) { // Si ya está hablando, cancelar y luego hablar lo nuevo
        console.log("[SS] Cancelando habla anterior para nuevo mensaje...");
        synth.cancel();
        // Pequeña demora para asegurar que cancel() complete antes de speak()
        setTimeout(() => startSpeakingInternal(textToSpeak, synth), 100);
    } else {
        startSpeakingInternal(textToSpeak, synth);
    }
}

function startSpeakingInternal(text, synthInstance) { // Función interna para manejar la lógica de hablar
    console.log("[SS] Intentando hablar:", text.substring(0, 50) + "...");
    // Dividir por frases para una mejor cadencia si el texto es largo
    const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [text];
    let sentenceIndex = 0;

    function speakNextSentence() {
        if (sentenceIndex >= sentences.length) {
            console.log("[SS] Todas las oraciones han sido habladas.");
            return;
        }
        const currentSentence = sentences[sentenceIndex].trim();
        if (!currentSentence) { // Saltar oraciones vacías
            sentenceIndex++;
            speakNextSentence();
            return;
        }

        const utterance = new SpeechSynthesisUtterance(currentSentence);
        utterance.lang = "es-ES"; // Forzar español
        
        const voices = synthInstance.getVoices();
        let spanishVoice = voices.find(v => v.lang === "es-ES" && /Google|Microsoft|Helena|Laura|Marisol/i.test(v.name)) || // Nombres comunes de voces en español
                           voices.find(v => v.lang === "es-MX" && /Google|Microsoft|Paulina|Dalia/i.test(v.name)) ||
                           voices.find(v => v.lang.startsWith("es-")) || // Cualquier voz en español
                           voices.find(v => v.default && v.lang.startsWith("es")); // Voz por defecto si es en español
        
        if (spanishVoice) {
            utterance.voice = spanishVoice;
            console.log("[SS] Usando voz:", spanishVoice.name);
        } else if (voices.length > 0) {
            console.warn("[SS] No se encontró voz preferida en español. Usando la primera voz disponible o la por defecto del navegador.");
            // utterance.voice = voices.find(v => v.default) || voices[0]; // Fallback
        } else {
            console.warn("[SS] No hay voces de síntesis disponibles en este momento.");
        }

        utterance.onend = () => {
            console.log("[SS] Oración terminada.");
            sentenceIndex++;
            speakNextSentence();
        };
        utterance.onerror = (e) => {
            console.error("[SS] Error al intentar hablar la oración:", e);
            sentenceIndex++; // Intentar la siguiente oración
            speakNextSentence();
        };
        synthInstance.speak(utterance);
    }
    speakNextSentence();
}


console.log('[script.js] Funciones de la app definidas. Esperando evento de autenticación para inicializar completamente.');