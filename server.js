// server.js (Versión final completa con todas las integraciones)
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

// Logs de inicio
console.log('[server STARTUP] OPENROUTER_API_KEY Check:', process.env.OPENROUTER_API_KEY ? 'CARGADA (oculta)' : '<<<< ¡¡¡ADVERTENCIA!!! OpenRouter Key UNDEFINED >>>>');
console.log('[server] Iniciando servidor...');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*", // AJUSTA ESTO EN PRODUCCIÓN
        methods: ["GET", "POST"]
    }
});

// Middlewares Generales
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(helmet({ 
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "script-src": ["'self'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "/socket.io/"],
            "connect-src": ["'self'", "https://api.languagetool.org", "https://openrouter.ai", `ws://localhost:${process.env.PORT || 3000}`, `wss://localhost:${process.env.PORT || 3000}`],
            "img-src": ["'self'", "data:", "http:", "https:"], // Permitir http y https para imágenes
            "frame-src": ["'self'"],
            "worker-src": ["'self'", "blob:"]
        }
    } 
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Configuración de la Base de Datos MySQL
const dbPool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'proyecto_lectoescritura_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '+00:00'
});

async function testDbConnection() {
    try {
        const connection = await dbPool.getConnection();
        console.log('[DB] Conectado a MySQL exitosamente. ID de conexión:', connection.threadId);
        connection.release();
    } catch (err) {
        console.error('[DB] FATAL: Error al conectar con MySQL:', err.code, err.message);
        console.error('[DB] Por favor, verifica que el servidor MySQL esté corriendo y las credenciales en .env son correctas.');
        process.exit(1);
    }
}
testDbConnection();

// Constantes de Autenticación
const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.includes('TEMPORAL_CAMBIAME') || JWT_SECRET.includes('ALEATORIA_PARA_PRODUCCION') || JWT_SECRET.length < 32) {
    console.warn("\n\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.warn("!!! ADVERTENCIA CRÍTICA: JWT_SECRET no está configurado de forma segura en .env !!!");
    console.warn("!!! Esto es un RIESGO DE SEGURIDAD. Genera una cadena aleatoria larga y       !!!");
    console.warn("!!! compleja para JWT_SECRET en tu archivo .env para un entorno de producción.!!!");
    console.warn("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n\n");
    if (!JWT_SECRET) {
        console.error("FATAL: JWT_SECRET es undefined. La aplicación no puede iniciar de forma segura.");
        process.exit(1);
    }
}

// --- RUTAS DE AUTENTICACIÓN ---
const authRouter = express.Router();

authRouter.post('/register', [
    body('username').trim().isLength({ min: 3, max: 50 }).escape().withMessage('El nombre de usuario debe tener entre 3 y 50 caracteres.'),
    body('displayName').trim().isLength({ min: 2, max: 100 }).escape().optional({ checkFalsy: true }).withMessage('El nombre para mostrar debe tener entre 2 y 100 caracteres.'),
    body('password').isLength({ min: 4 }).withMessage('La contraseña debe tener al menos 4 caracteres.')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array().map(e => e.msg) });
    }
    const { username, displayName, password } = req.body;
    try {
        const [existingUsers] = await dbPool.query('SELECT id FROM users WHERE username = ?', [username]);
        if (existingUsers.length > 0) {
            return res.status(409).json({ success: false, message: 'Este nombre de usuario ya está en uso. Prueba con otro.' });
        }
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const [result] = await dbPool.query(
            'INSERT INTO users (username, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
            [username, displayName || username, hashedPassword]
        );
        res.status(201).json({ success: true, message: '¡Cuenta creada! Ahora puedes iniciar sesión.', userId: result.insertId });
    } catch (error) {
        console.error('[AUTH /register] Error registrando:', error);
        res.status(500).json({ success: false, message: 'Hubo un problema al crear la cuenta.' });
    }
});

authRouter.post('/login', [
    body('username').trim().notEmpty().escape().withMessage('Ingresa tu nombre de usuario.'),
    body('password').notEmpty().withMessage('Ingresa tu contraseña.')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array().map(e => e.msg) });
    }
    const { username, password } = req.body;
    try {
        const [users] = await dbPool.query('SELECT id, username, display_name, password_hash FROM users WHERE username = ?', [username]);
        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos.' });
        }
        const user = users[0];
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos.' });
        }
        const tokenPayload = { userId: user.id, username: user.username, displayName: user.display_name || user.username };
        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '1d' });
        res.json({ success: true, message: '¡Bienvenido/a!', token: token, user: { id: user.id, username: user.username, displayName: user.display_name || user.username }});
    } catch (error) {
        console.error('[AUTH /login] Error iniciando sesión:', error);
        res.status(500).json({ success: false, message: 'Hubo un problema al iniciar sesión.' });
    }
});

app.use('/api/auth', authRouter);

// Middleware de ejemplo para proteger rutas
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    if (token == null) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, userPayload) => {
        if (err) {
            console.log('[Auth Middleware] Token inválido:', err.message);
            return res.sendStatus(403);
        }
        req.user = userPayload; // { userId, username, displayName }
        next();
    });
}

// --- TU LÓGICA DE API EXISTENTE ---
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: 'Demasiadas solicitudes desde esta IP, por favor espera un momento.' });
app.use('/api/', apiLimiter);

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe ? String(unsafe) : '';
     return unsafe.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, "'").replace(/'/g, "'");
}

async function callOpenRouter(modelIdentifier, prompt, maxTokens = 300, temperature = 0.6, systemPrompt = "Eres un asistente útil.") {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
    if (!OPENROUTER_API_KEY) { 
        console.error("[OpenRouter] Clave API OpenRouter no configurada en .env");
        throw new Error("Servicio de IA no disponible (sin clave).");
    }
    console.log(`[OpenRouter] Llamando API: ${modelIdentifier}, MaxTokens: ${maxTokens}`);
    const messages = [];
    if (systemPrompt) { messages.push({ role: "system", content: systemPrompt }); }
    messages.push({ role: "user", content: prompt });
    try {
        const response = await axios.post(OPENROUTER_API_URL, 
            { model: modelIdentifier, messages: messages, temperature: temperature, max_tokens: maxTokens, stream: false },
            { headers: { 
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
                'X-Title': 'ProyectoAyudanteLectoescritura'
            }}
        );
        const generatedText = response.data?.choices?.[0]?.message?.content;
        if (generatedText === undefined || generatedText === null) {
            console.warn(`[OpenRouter] No se encontró texto en respuesta de ${modelIdentifier}. Respuesta:`, JSON.stringify(response.data, null, 2));
            return null;
        }
        console.log(`[OpenRouter] Texto (${modelIdentifier}): ${generatedText.substring(0,50)}...`);
        return generatedText.trim();
    } catch (error) {
        let eMsg = 'Problema con el asistente IA (OpenRouter).';
        if (error.response) {
            console.error('[OpenRouter] Error API:', error.response.status, JSON.stringify(error.response.data, null, 2));
            const d = error.response.data?.error;
            if (d?.message) eMsg = `Error IA (${error.response.status}): ${d.message.substring(0,100)}`; else eMsg = `Error IA (${error.response.status})`;
            if (error.response.status === 401) eMsg = 'Clave API OpenRouter inválida.';
            if (error.response.status === 402) eMsg = 'Fondos insuficientes en OpenRouter.';
            if (error.response.status === 429) eMsg = 'Límite OpenRouter alcanzado.';
            if (d?.code === 'model_not_found') eMsg = `Modelo IA no encontrado: ${modelIdentifier}`;
        } else if (error.request) { console.error('[OpenRouter] No hubo respuesta API:', error.request); eMsg = 'No se pudo conectar con el servicio IA.';
        } else { console.error('[OpenRouter] Error en solicitud API:', error.message); eMsg = `Error en solicitud al servicio IA: ${error.message}`; }
        throw new Error(eMsg);
    }
}

app.post('/api/analyze-text', async (req, res) => {
    const socketId = req.body.socketId; 
    const socket = socketId ? io.sockets.sockets.get(socketId) : null;
    const emitStatus = (message, isError = false) => { 
        if (socket) socket.emit('ia_status_update', { message, isError });
        else console.log(`[API analyze-text] No socket para emitir status: ${message}`);
    };
    emitStatus('Generando consejos...');
    try {
        const { text, errors } = req.body;
        if (!text || !Array.isArray(errors)) {
            emitStatus('Error: Datos de entrada inválidos.', true);
            return res.status(400).json({ success: false, error: 'Datos inválidos para el análisis.' });
        }
        const errorsToExplain = errors.map((err) => {
            let extractedText = null;
            if (text && typeof err.offset === 'number' && typeof err.length === 'number' && err.offset >= 0 && err.length > 0 && (err.offset + err.length) <= text.length) {
                extractedText = text.substring(err.offset, err.offset + err.length);
            } else {
                 console.warn(`[API analyze-text] No se pudo extraer texto para error: offset=${err.offset}, length=${err.length}, textLength=${text.length}`);
            }
            return { message: err.message, errorText: extractedText, suggestion: err.replacements?.[0]?.value || null };
        }).filter(e => !!e.errorText).slice(0, 5); // Solo tomar errores donde se pudo extraer el texto

        let analysisHtml = `<div class="tutor-feedback"><h4>Consejos de Profe Amigo:</h4>`;
        if (errorsToExplain.length === 0) {
             analysisHtml += errors.length > 0 ? `<p>Se detectaron algunos detalles, pero no pude generar un consejo específico para ellos en este momento.</p>` : `<div class="no-errors-found"><p>¡Muy bien! No se encontraron errores claros para explicar. 👍</p></div>`;
        } else {
            analysisHtml += errorsToExplain.map((errData) => {
                // Asegurarse que errorText no sea null antes de usarlo en escapeHtml
                const errorTextHtml = errData.errorText ? escapeHtml(errData.errorText) : "[texto no disponible]";
                let simpleExplanation = `Revisa esta parte: <span class="word-incorrect">"${errorTextHtml}"</span>.`;
                if (errData.message.toLowerCase().includes('concordancia')) simpleExplanation = `Asegúrate que las palabras concuerden (ej. 'el perro', 'las casas'). Revisa: <span class="word-incorrect">"${errorTextHtml}"</span>.`;
                else if (errData.message.toLowerCase().includes('ortográfi')) simpleExplanation = `Revisa si usaste la letra correcta (b/v, c/s/z, h, etc.) en <span class="word-incorrect">"${errorTextHtml}"</span>.`;
                else if (errData.message.toLowerCase().includes('tilde') || errData.message.toLowerCase().includes('acento')) simpleExplanation = `Puede que falte un acento (tilde) en <span class="word-incorrect">"${errorTextHtml}"</span>.`;
                else if (errData.message.toLowerCase().includes('mayúscula')) simpleExplanation = `Recuerda usar mayúscula al empezar o en nombres. Fíjate en <span class="word-incorrect">"${errorTextHtml}"</span>.`;
                else if (errData.message.toLowerCase().includes('puntuaci')) simpleExplanation = `Revisa si falta un punto, coma o espacio cerca de <span class="word-incorrect">"${errorTextHtml}"</span>.`;
               
                return `<div class="error-explanation">
                       <p><strong>Error detectado en:</strong> <span class="word-incorrect">"${errorTextHtml}"</span></p>
                       ${errData.suggestion ? `<p><strong>Sugerencia:</strong> <span class="word-correct">"${escapeHtml(errData.suggestion)}"</span></p>` : ''}
                       <p><strong>Descripción del problema:</strong> ${escapeHtml(errData.message)}</p>
                       <p><strong>Consejo:</strong> ${simpleExplanation}</p>
                      </div>`;
            }).join('');
        }
        analysisHtml += `</div>`;
        emitStatus('Consejos listos.');
        res.json({ success: true, analysis: analysisHtml });
    } catch (error) {
        console.error('[API analyze-text] Error:', error);
        emitStatus(`Error generando consejos: ${error.message}`, true);
        res.status(500).json({ success: false, error: 'Error interno al generar consejos.' });
    }
});

app.post('/api/generate-exercises', async (req, res) => {
    const socketId = req.body.socketId; 
    const socket = socketId ? io.sockets.sockets.get(socketId) : null;
    const emitStatus = (message, isError = false) => { if (socket) socket.emit('ia_status_update', { message, isError });};
    emitStatus('Generando ejercicios...');
    try {
        const { text } = req.body; 
        if (!text || text.trim().length < 1) {
             emitStatus('Texto muy corto para generar ejercicios.', true);
            return res.status(400).json({ error: 'Escribe un poco más para crear ejercicios.' });
        }
        // Lógica de generación de ejercicios mejorada de la versión anterior
        let ex1={p:'c_sa',o:'casa'}, ex2={v:'a',f:'La casa es azul.',n:3}; 
        const words = text.match(/\b[a-záéíóúñü]{3,7}\b/gi)||[]; 
        if(words.length>0){
            const u=[...new Set(words.map(w => w.toLowerCase()))];
            const w=u[Math.floor(Math.random()*u.length)];
            if(w.length > 2){
                const m=Math.floor(w.length/2);
                const i= m > 0 ? m : 1; 
                if(i < w.length){
                    const f=w.substring(0,i);
                    const s=w.substring(i+1);
                    ex1={p:`${f}_${s}`,o:w};
                }
            }
        }
        const lets="aeiou";
        const l=lets[Math.floor(Math.random()*lets.length)];
        let frag=text.substring(0,Math.min(text.length, 80));
        const p=frag.lastIndexOf('.');
        if(p>10&&p<frag.length-1){
            frag=frag.substring(0,p+1).trim();
        } else {
            frag=text.substring(0,Math.min(text.length, 60)).trim();
            if(text.length>60 && text[60]!==' '){
                const s=frag.lastIndexOf(' ');
                if(s>0)frag=frag.substring(0,s);
            }
            if(text.length > frag.length) frag+='...';
        }
        let count=0;
        const lf=frag.toLowerCase();
        const ll=l.toLowerCase();
        for(let k=0;k<lf.length;k++){
            let char=lf[k];
            if('áéíóúü'.includes(char)){
                const normChar = char.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 
                if(normChar===ll)count++;
            } else if(char===ll){
                count++;
            }
        }
        ex2={v:l,f:frag || "El sol brilla",n:count}; // Fallback para ex2.f
        
        const exercisesHtml = `<div class="exercises"><h3>¡A Practicar!</h3><div class="exercise"><h4>Ejercicio 1: Completar Palabra</h4><p>Escribe la letra que falta:</p><div class="activity">${escapeHtml(ex1.p)}</div><details><summary>Ver Respuesta</summary><p>${escapeHtml(ex1.o)}</p></details></div><div class="exercise"><h4>Ejercicio 2: Buscar Letra</h4><p>¿Cuántas veces aparece la letra '${escapeHtml(ex2.v)}' en el siguiente texto?</p><div class="activity" style="font-style: italic;">"${escapeHtml(ex2.f)}"</div><details><summary>Ver Respuesta</summary><p>Aparece ${ex2.n} ${ex2.n === 1 ? 'vez' : 'veces'}.</p></details></div></div>`;
        await new Promise(resolve => setTimeout(resolve, 200)); // Simular pequeña demora
        emitStatus('Ejercicios listos.');
        res.json({ success: true, exercises: exercisesHtml });
    } catch (error) {
        console.error('[API generate-exercises] Error:', error);
        emitStatus(`Error al generar ejercicios: ${error.message}`, true);
        res.status(500).json({ success: false, error: 'Error interno al crear los ejercicios.' });
    }
});

// --- LÓGICA DE SOCKET.IO (CHAT) ---
io.on('connection', (socket) => {
    console.log('[Socket.IO] Cliente conectado:', socket.id);
    socket.emit('server_message', { message: `¡Hola! Soy Profe Amigo. 😊 Si tienes dudas sobre letras o palabras, ¡aquí estoy para ayudarte!` });

    socket.on('chat_message_from_client', async (data) => {
        const userMessage = (data.message || '').trim();
        console.log(`[Socket.IO Chat] (${socket.id}) Usuario: "${userMessage}"`);
        if (!userMessage) return;

        socket.emit('chat_message_from_server', { message: "Profe Amigo está pensando...", senderType: 'bot_thinking' });

        try {
            const CHAT_MODEL = "mistralai/mistral-7b-instruct:free";
            const chatSystemPrompt = `**ROL ESTRÍCTO:** Eres "Profe Amigo", un asistente virtual AMABLE y PACIENTE enfocado EXCLUSIVAMENTE en ayudar con la alfabetización básica (leer y escribir) y el uso de esta app. Responde de forma MUY BREVE, CLARA y SENCILLA. TEMAS PERMITIDOS: letras, sonidos, sílabas, palabras simples, frases cortas, puntuación básica, cómo usar la app (botones, cámara, micrófono, ejercicios), y dar ánimo. SI LA PREGUNTA NO ES SOBRE ESTOS TEMAS, RECHAZA AMABLEMENTE y reenfoca. EJEMPLO RECHAZO: "¡Hola! Yo te ayudo con letras y palabras. Sobre [tema no permitido] no sé mucho. ¿Quieres practicar alguna letra?". USA emojis como 😊👍. SÉ BREVE.`;
            
            const botResponse = await callOpenRouter(CHAT_MODEL, userMessage, 150, 0.5, chatSystemPrompt);

            if (botResponse) {
                console.log(`[Socket.IO Chat] (${socket.id}) Bot: "${botResponse.substring(0,60)}..."`);
                socket.emit('chat_message_from_server', { message: botResponse, senderType: 'bot' });
            } else {
                console.warn(`[Socket.IO Chat] (${socket.id}) Respuesta vacía del modelo de IA.`);
                socket.emit('chat_message_from_server', { message: "Hmm, no estoy seguro de cómo responder a eso. ¿Puedes preguntar de otra forma o ser más específico?", senderType: 'bot_error' });
            }
        } catch (error) {
            console.error("[Socket.IO Chat] Error en OpenRouter o procesando:", error.message);
            let displayError = `Lo siento, tuve un problema técnico. Intenta más tarde.`;
            if (error.message.toLowerCase().includes("clave api") || error.message.toLowerCase().includes("api key")) {
                displayError = "El servicio de IA no está configurado correctamente en el servidor en este momento.";
            } else if (error.message.toLowerCase().includes("fondos insuficientes") || error.message.toLowerCase().includes("insufficient funds")) {
                displayError = "El servicio de IA tiene un problema de facturación temporal. Intenta más tarde.";
            } else if (error.message.toLowerCase().includes("modelo ia no encontrado") || error.message.toLowerCase().includes("model_not_found")) {
                displayError = "El modelo de IA que usamos no está disponible ahora. Intenta en un momento.";
            }
            socket.emit('chat_message_from_server', { message: displayError, senderType: 'bot_error' });
        }
    });
    socket.on('disconnect', () => { console.log('[Socket.IO] Cliente desconectado:', socket.id); });
});


// --- MANEJO DE RUTAS GET PARA SPA Y 404 (AL FINAL DE TODAS LAS RUTAS ESPECÍFICAS) ---
app.get(/^\/(?!api).*/, (req, res, next) => { 
    console.log(`[Fallback GET] Intentando servir index.html para la ruta: ${req.path}`);
    if (req.accepts('html')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
            if (err) {
                console.error(`[Fallback GET] Error al enviar index.html para ${req.path}:`, err.status || err.message);
                next(err); // Pasa el error al siguiente manejador de errores de Express
            }
        });
    } else {
        // Si el cliente no acepta HTML (ej. una llamada API a una ruta no /api/ que no existe), 
        // es mejor que pase al manejador 404.
        console.log(`[Fallback GET] Cliente no acepta HTML para ${req.path}, procediendo a 404.`);
        next(); 
    }
});

// Middleware para manejar errores 404 (Rutas no encontradas)
// Esto se ejecutará si ninguna ruta anterior coincide O si la ruta comodín anterior llama a next().
app.use((req, res, next) => {
    console.warn(`[404 Handler] Ruta no encontrada: ${req.method} ${req.originalUrl}`);
    res.status(404).format({
        'application/json': () => res.json({ error: 'El recurso solicitado no fue encontrado en el servidor.' }),
        'default': () => res.type('txt').send('El recurso solicitado no fue encontrado.')
    });
});

// Middleware general de manejo de errores (para errores 500, etc.)
// Debe tener 4 argumentos para ser reconocido como manejador de errores por Express
app.use((err, req, res, next) => {
    console.error("[Global Error Handler] Sucedió un error no controlado:", err.status || 500, err.message);
    // En desarrollo, podrías querer loguear el stack completo:
    // if (process.env.NODE_ENV !== 'production' && err.stack) { console.error(err.stack); }
    res.status(err.status || 500).format({
        'application/json': () => res.json({ error: err.message || 'Ocurrió un error interno en el servidor.' }),
        'default': () => res.type('txt').send(err.message || 'Ocurrió un error interno en el servidor.')
    });
});

// Iniciar el servidor
const PORT = parseInt(process.env.PORT) || 3000;
server.listen(PORT, () => {
    console.log(`\nServidor HTTP y WebSocket corriendo en http://localhost:${PORT}`);
    console.log("--------------------------------------------------------------------");
    console.log("Variables de entorno relevantes para la ejecución:");
    console.log(`  DB_HOST:             ${process.env.DB_HOST || '(default localhost)'}`);
    console.log(`  DB_USER:             ${process.env.DB_USER || '(default root)'}`);
    console.log(`  DB_PASSWORD:         ${process.env.DB_PASSWORD ? '****** (cargada)' : '(default vacío o no establecida)'}`);
    console.log(`  DB_NAME:             ${process.env.DB_NAME || '(default proyecto_lectoescritura_db)'}`);
    console.log(`  OPENROUTER_API_KEY:  ${process.env.OPENROUTER_API_KEY ? 'Cargada y oculta' : 'NO CARGADA (Chat IA no funcionará correctamente)'}`);
    const jwtSecretStatus = JWT_SECRET === process.env.JWT_SECRET && JWT_SECRET.length > 31 && !['ESTE_ES_UN_SECRETO_TEMPORAL_CAMBIAME', 'CAMBIAME_POR_UNA_CADENA_SECRETA_MUY_LARGA_Y_ALEATORIA_PARA_PRODUCCION_123!@#'].includes(JWT_SECRET) ? 'Cargado y parece seguro' : 'NO SEGURO o usando default (¡REVISAR URGENTEMENTE EN .env!)';
    console.log(`  JWT_SECRET:          ${jwtSecretStatus}`);
    console.log(`  APP_URL (para CORS/Referer): ${process.env.APP_URL || `(default http://localhost:${PORT})`}`);
    console.log("--------------------------------------------------------------------");
    console.log("\nPara detener el servidor: CTRL+C");
});