// server.js (Listo para Render con BD externa como Railway/PlanetScale)
require('dotenv').config(); // Para desarrollo local
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
console.log('[server STARTUP] Iniciando servidor...');
console.log('[server STARTUP] NODE_ENV:', process.env.NODE_ENV); // Útil para saber el entorno

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: process.env.CORS_ORIGIN || "*", // Configura CORS_ORIGIN en Render para tu frontend URL
        methods: ["GET", "POST"]
    }
});

// Middlewares Generales
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" })); // Aplicar CORS aquí también
app.use(express.static(path.join(__dirname, 'public')));
app.use(helmet({ 
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "script-src": ["'self'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "/socket.io/"],
            "connect-src": ["'self'", "https://api.languagetool.org", "https://openrouter.ai", process.env.APP_URL ? new URL(process.env.APP_URL).origin.replace(/^http/, 'ws') : `ws://localhost:${process.env.PORT || 3000}`, process.env.APP_URL ? new URL(process.env.APP_URL).origin.replace(/^http/, 'wss') : `wss://localhost:${process.env.PORT || 3000}`],
            "img-src": ["'self'", "data:", "http:", "https:"],
            "frame-src": ["'self'"],
            "worker-src": ["'self'", "blob:"]
        }
    } 
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Configuración de la Base de Datos MySQL
// Esta configuración leerá las variables de entorno que configures en Render
// En server.js
// En server.js
const dbPool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'proyecto_lectoescritura_db',
    port: parseInt(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '+00:00',
    // Para mysql2, simplemente NO incluir la opción 'ssl' o ponerla explícitamente en 'false'
    // debería ser suficiente para indicar que no se use SSL.
    // Si el driver intenta SSL por defecto, necesitas una forma de decirle que no.
    // Prueba primero sin ninguna opción 'ssl'. Si falla, entonces prueba:
    // ssl: null, // o
    // ssl: false, // o la opción de abajo que es más para cuando SÍ usas SSL pero con CAs específicas
    /*
    ssl: {
        // ca: fs.readFileSync(__dirname + '/mysql-ca.crt'), // Solo si tuvieras un CA específico
        rejectUnauthorized: false // Esto dice al cliente que no falle si el certificado del servidor no es de una CA conocida.
                                  // Para una conexión NO SSL, esto es menos relevante, pero a veces los drivers
                                  // tienen comportamientos por defecto que necesitan anularse.
    }
    */
});

async function testDbConnection() {
    try {
        const connection = await dbPool.getConnection();
        console.log('[DB] Conectado a MySQL exitosamente.');
        connection.release();
    } catch (err) {
        console.error('[DB] FATAL: Error al conectar con MySQL:', err.code, err.message);
        console.error('[DB] Verifica las variables de entorno DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT en tu plataforma de despliegue (Render).');
        process.exit(1);
    }
}
testDbConnection();

// Constantes de Autenticación
const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.includes('TEMPORAL_CAMBIAME') || JWT_SECRET.includes('ALEATORIA_PARA_PRODUCCION') || JWT_SECRET.length < 32) {
    console.warn("\n\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.warn("!!! ADVERTENCIA CRÍTICA: JWT_SECRET no está configurado de forma segura.       !!!");
    console.warn("!!! Por favor, genera una cadena aleatoria larga y segura para JWT_SECRET      !!!");
    console.warn("!!! en las variables de entorno de tu plataforma de despliegue (Render).       !!!");
    console.warn("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n\n");
    if (!JWT_SECRET && process.env.NODE_ENV === 'production') { // Solo salir si es producción y falta
        console.error("FATAL: JWT_SECRET es undefined en entorno de producción. La aplicación no puede iniciar de forma segura.");
        process.exit(1);
    } else if (!JWT_SECRET) {
        console.warn("JWT_SECRET es undefined, usando un valor inseguro por defecto para desarrollo (NO USAR EN PRODUCCIÓN).");
        // process.env.JWT_SECRET = "desarrollo_inseguro_jwt_secret_cambiar_esto"; // No es ideal ni siquiera para dev
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
    if (!errors.isEmpty()) { return res.status(400).json({ success: false, errors: errors.array().map(e => e.msg) }); }
    const { username, displayName, password } = req.body;
    try {
        const [existingUsers] = await dbPool.query('SELECT id FROM users WHERE username = ?', [username]);
        if (existingUsers.length > 0) { return res.status(409).json({ success: false, message: 'Este nombre de usuario ya está en uso. Prueba con otro.' });}
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const [result] = await dbPool.query('INSERT INTO users (username, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',[username, displayName || username, hashedPassword]);
        res.status(201).json({ success: true, message: '¡Cuenta creada! Ahora puedes iniciar sesión.', userId: result.insertId });
    } catch (error) { console.error('[AUTH /register] Error registrando:', error); res.status(500).json({ success: false, message: 'Hubo un problema al crear la cuenta.' }); }
});

authRouter.post('/login', [
    body('username').trim().notEmpty().escape().withMessage('Ingresa tu nombre de usuario.'),
    body('password').notEmpty().withMessage('Ingresa tu contraseña.')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { return res.status(400).json({ success: false, errors: errors.array().map(e => e.msg) });}
    const { username, password } = req.body;
    try {
        const [users] = await dbPool.query('SELECT id, username, display_name, password_hash FROM users WHERE username = ?', [username]);
        if (users.length === 0) { return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos.' }); }
        const user = users[0];
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) { return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos.' });}
        const tokenPayload = { userId: user.id, username: user.username, displayName: user.display_name || user.username };
        const token = jwt.sign(tokenPayload, JWT_SECRET || "fallback_secret_inseguro", { expiresIn: '1d' }); // Fallback por si JWT_SECRET es undefined
        res.json({ success: true, message: '¡Bienvenido/a!', token: token, user: { id: user.id, username: user.username, displayName: user.display_name || user.username }});
    } catch (error) { console.error('[AUTH /login] Error iniciando sesión:', error); res.status(500).json({ success: false, message: 'Hubo un problema al iniciar sesión.' }); }
});
app.use('/api/auth', authRouter);

// Middleware para proteger rutas (ejemplo)
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET || "fallback_secret_inseguro", (err, userPayload) => { // Fallback
        if (err) { console.log('[Auth Middleware] Token inválido:', err.message); return res.sendStatus(403); }
        req.user = userPayload; 
        next();
    });
}

// --- LÓGICA DE API EXISTENTE ---
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, message: 'Demasiadas solicitudes desde esta IP, por favor espera.' });
app.use('/api/', apiLimiter); // Aplicar a /api/auth y otras rutas /api/*

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe ? String(unsafe) : '';
     return unsafe.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, "'").replace(/'/g, "'");
}

async function callOpenRouter(modelIdentifier, prompt, maxTokens = 300, temperature = 0.6, systemPrompt = "Eres un asistente útil.") {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
    if (!OPENROUTER_API_KEY) { console.error("[OpenRouter] Clave API no configurada."); throw new Error("Servicio IA no disponible (sin clave).");}
    const messages = [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }];
    try {
        const response = await axios.post(OPENROUTER_API_URL, 
            { model: modelIdentifier, messages: messages, temperature: temperature, max_tokens: maxTokens, stream: false },
            { headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`, 'X-Title': 'ProyectoLectoescritura'}});
        const generatedText = response.data?.choices?.[0]?.message?.content;
        if (!generatedText) { console.warn(`[OpenRouter] No texto en respuesta ${modelIdentifier}.`); return null; }
        return generatedText.trim();
    } catch (error) { 
        let eMsg = 'Problema con IA (OpenRouter).'; if (error.response) {eMsg = `Error IA (${error.response.status})`;} console.error(eMsg, error.message); throw new Error(eMsg);
    }
}

app.post('/api/analyze-text', async (req, res) => {
    const socketId = req.body.socketId; const socket = socketId ? io.sockets.sockets.get(socketId) : null;
    const emitStatus = (message, isError = false) => { if (socket) socket.emit('ia_status_update', { message, isError });};
    emitStatus('Generando consejos...');
    try {
        const { text, errors } = req.body; if (!text || !Array.isArray(errors)) { emitStatus('Error: Datos inválidos.', true); return res.status(400).json({ success: false, error: 'Datos inválidos.' });}
        const errorsToExplain = errors.map((err) => {let extractedText = null; if (text && typeof err.offset === 'number' && typeof err.length === 'number' && err.offset >= 0 && err.length > 0 && (err.offset + err.length) <= text.length) { extractedText = text.substring(err.offset, err.offset + err.length); } else {console.warn(`[API analyze-text] No se pudo extraer texto para error: offset=${err.offset}, length=${err.length}`);} return { message: err.message, errorText: extractedText, suggestion: err.replacements?.[0]?.value || null };}).filter(e => !!e.errorText).slice(0, 5);
        let analysisHtml = `<div class="tutor-feedback"><h4>Consejos de Profe Amigo:</h4>`; if (errorsToExplain.length === 0) { analysisHtml += errors.length > 0 ? `<p>Detalles detectados, pero sin consejo específico ahora.</p>` : `<div class="no-errors-found"><p>¡Muy bien! 👍</p></div>`;} else { analysisHtml += errorsToExplain.map((errData) => { const errorTextHtml = errData.errorText ? escapeHtml(errData.errorText) : "[texto no disponible]"; let simpleExplanation = `Revisa: <span class="word-incorrect">"${errorTextHtml}"</span>.`; if (errData.message.toLowerCase().includes('concordancia')) simpleExplanation = `Asegúrate de la concordancia en <span class="word-incorrect">"${errorTextHtml}"</span>.`; else if (errData.message.toLowerCase().includes('ortográfi')) simpleExplanation = `Revisa la ortografía en <span class="word-incorrect">"${errorTextHtml}"</span>.`;  else if (errData.message.toLowerCase().includes('tilde') || errData.message.toLowerCase().includes('acento')) simpleExplanation = `Puede faltar un acento en <span class="word-incorrect">"${errorTextHtml}"</span>.`; else if (errData.message.toLowerCase().includes('mayúscula')) simpleExplanation = `Revisa las mayúsculas en <span class="word-incorrect">"${errorTextHtml}"</span>.`; else if (errData.message.toLowerCase().includes('puntuaci')) simpleExplanation = `Revisa la puntuación cerca de <span class="word-incorrect">"${errorTextHtml}"</span>.`; return `<div class="error-explanation"><p><strong>Error en:</strong> <span class="word-incorrect">"${errorTextHtml}"</span></p>${errData.suggestion ? `<p><strong>Sugerencia:</strong> <span class="word-correct">"${escapeHtml(errData.suggestion)}"</span></p>` : ''}<p><strong>Problema:</strong> ${escapeHtml(errData.message)}</p><p><strong>Consejo:</strong> ${simpleExplanation}</p></div>`;}).join('');}
        analysisHtml += `</div>`; emitStatus('Consejos listos.'); res.json({ success: true, analysis: analysisHtml });
    } catch (error) { console.error('[API analyze-text] Error:', error); emitStatus(`Error generando consejos: ${error.message}`, true); res.status(500).json({ success: false, error: 'Error interno generando consejos.' });}
});

app.post('/api/generate-exercises', async (req, res) => {
    const socketId = req.body.socketId; const socket = socketId ? io.sockets.sockets.get(socketId) : null;
    const emitStatus = (message, isError = false) => { if (socket) socket.emit('ia_status_update', { message, isError });};
    emitStatus('Generando ejercicios...');
    try {
        const { text } = req.body; if (!text || text.trim().length < 1) { emitStatus('Texto muy corto.', true); return res.status(400).json({ error: 'Escribe más para crear ejercicios.' });}
        let ex1={p:'c_sa',o:'casa'}, ex2={v:'a',f:'La casa es azul.',n:3}; const words = text.match(/\b[a-záéíóúñü]{3,7}\b/gi)||[]; if(words.length>0){const u=[...new Set(words.map(w=>w.toLowerCase()))];const w=u[Math.floor(Math.random()*u.length)];if(w.length > 2){const m=Math.floor(w.length/2);const i=m>0?m:1;if(i<w.length){const f=w.substring(0,i);const s=w.substring(i+1);ex1={p:`${f}_${s}`,o:w};}}} const lets="aeiou";const l=lets[Math.floor(Math.random()*lets.length)];let frag=text.substring(0,Math.min(text.length,80));const p=frag.lastIndexOf('.');if(p>10&&p<frag.length-1){frag=frag.substring(0,p+1).trim();}else{frag=text.substring(0,Math.min(text.length,60)).trim();if(text.length>60&&text[60]!==' '){const s=frag.lastIndexOf(' ');if(s>0)frag=frag.substring(0,s);}if(text.length>frag.length)frag+='...';} let count=0;const lf=frag.toLowerCase();const ll=l.toLowerCase();for(let k=0;k<lf.length;k++){let char=lf[k];if('áéíóúü'.includes(char)){const normChar=char.normalize("NFD").replace(/[\u0300-\u036f]/g,"");if(normChar===ll)count++;}else if(char===ll){count++;}} ex2={v:l,f:frag||"El sol brilla",n:count};
        const exercisesHtml = `<div class="exercises"><h3>¡A Practicar!</h3><div class="exercise"><h4>Completar:</h4><p>${escapeHtml(ex1.p)}</p><details><summary>R</summary><p>${escapeHtml(ex1.o)}</p></details></div><div class="exercise"><h4>Buscar:</h4><p>¿'${escapeHtml(ex2.v)}' en "${escapeHtml(ex2.f)}"?</p><details><summary>R</summary><p>${ex2.n}</p></details></div></div>`;
        await new Promise(resolve => setTimeout(resolve, 200)); emitStatus('Ejercicios listos.'); res.json({ success: true, exercises: exercisesHtml });
    } catch (error) { console.error('[API generate-exercises] Error:', error); emitStatus(`Error ejercicios: ${error.message}`, true); res.status(500).json({ success: false, error: 'Error creando ejercicios.' });}
});

// --- LÓGICA DE SOCKET.IO (CHAT) ---
io.on('connection', (socket) => {
    console.log('[Socket.IO] Cliente conectado:', socket.id);
    socket.emit('server_message', { message: `¡Hola! Soy Profe Amigo. 😊 ¿Dudas sobre letras o palabras?` });
    socket.on('chat_message_from_client', async (data) => { 
        const userMessage = (data.message || '').trim(); 
        if (!userMessage) return; 
        socket.emit('chat_message_from_server', { message: "Profe Amigo pensando...", senderType: 'bot_thinking' }); 
        try { 
            const CHAT_MODEL = "mistralai/mistral-7b-instruct:free"; 
            const chatSystemPrompt = `**ROL ESTRÍCTO:** Eres "Profe Amigo", asistente virtual AMABLE y PACIENTE para alfabetización básica y uso de esta app. Responde MUY BREVE, CLARA y SENCILLA. TEMAS PERMITIDOS: letras, sonidos, sílabas, palabras simples, frases cortas, puntuación básica, cómo usar la app, y dar ánimo. SI LA PREGUNTA NO ES SOBRE ESTOS TEMAS, RECHAZA AMABLEMENTE y reenfoca. EJEMPLO RECHAZO: "¡Hola! Te ayudo con letras/palabras. Sobre [tema] no sé. ¿Practicamos alguna letra?". USA emojis 😊👍. SÉ BREVE.`; 
            const botResponse = await callOpenRouter(CHAT_MODEL, userMessage, 150, 0.5, chatSystemPrompt); 
            if (botResponse) { socket.emit('chat_message_from_server', { message: botResponse, senderType: 'bot' }); } 
            else { socket.emit('chat_message_from_server', { message: "Hmm, no estoy seguro cómo responder.", senderType: 'bot_error' });}
        } catch (error) { 
            console.error("[Socket.IO Chat] Error:", error.message); 
            let displayError = `Lo siento, problema técnico.`; 
            if (error.message.toLowerCase().includes("clave api")) displayError = "Servicio IA no configurado."; 
            else if (error.message.toLowerCase().includes("fondos insuficientes")) displayError = "Servicio IA con problema de facturación."; 
            else if (error.message.toLowerCase().includes("modelo ia no encontrado")) displayError = "Modelo IA no disponible ahora."; 
            socket.emit('chat_message_from_server', { message: displayError, senderType: 'bot_error' });
        }
    });
    socket.on('disconnect', () => { console.log('[Socket.IO] Cliente desconectado:', socket.id); });
});

// --- MANEJO DE RUTAS GET PARA SPA Y 404 (AL FINAL) ---
app.get(/^\/(?!api).*/, (req, res, next) => { 
    console.log(`[Fallback GET] Sirviendo index.html para: ${req.path}`);
    if (req.accepts('html')) { res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => { if (err) { next(err); }});
    } else { next(); }
});
app.use((req, res, next) => {
    console.warn(`[404 Handler] Ruta no encontrada: ${req.method} ${req.originalUrl}`);
    res.status(404).format({ 'application/json': () => res.json({ error: 'No encontrado.' }), 'default': () => res.type('txt').send('No encontrado.')});
});
app.use((err, req, res, next) => {
    console.error("[Global Error Handler]", err.status || 500, err.message);
    res.status(err.status || 500).format({ 'application/json': () => res.json({ error: err.message || 'Error servidor.' }), 'default': () => res.type('txt').send(err.message || 'Error servidor.')});
});

// Iniciar el servidor
const PORT = parseInt(process.env.PORT) || 3000;
server.listen(PORT, () => {
    console.log(`\nServidor HTTP y WebSocket corriendo en http://localhost:${PORT}`);
    console.log("--------------------------------------------------------------------");
    console.log("Variables de entorno para la ejecución:");
    // No mostrar MYSQL_URL directamente si contiene la contraseña.
    // Las variables individuales DB_HOST, etc., son para local o si configuras Render así.
    if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL_RENDER) { // Asumiendo que Render podría usar DATABASE_URL_RENDER
         console.log(`  DATABASE_URL_RENDER:  Cargada (Render)`);
    } else if (process.env.MYSQL_URL) { // Para Railway
         console.log(`  MYSQL_URL:             Cargada (Railway)`);
    }
     else {
        console.log(`  DB_HOST:             ${process.env.DB_HOST || '(default localhost para desarrollo)'}`);
        console.log(`  DB_USER:             ${process.env.DB_USER || '(default root para desarrollo)'}`);
        console.log(`  DB_PASSWORD:         ${process.env.DB_PASSWORD ? '****** (cargada)' : '(no establecida para desarrollo)'}`);
        console.log(`  DB_NAME:             ${process.env.DB_NAME || '(default para desarrollo)'}`);
        console.log(`  DB_PORT:             ${process.env.DB_PORT || '(default 3306 para desarrollo)'}`);
    }
    console.log(`  OPENROUTER_API_KEY:  ${process.env.OPENROUTER_API_KEY ? 'Cargada' : 'NO CARGADA'}`);
    const jwtSecretToLog = JWT_SECRET ? (JWT_SECRET.length > 15 ? JWT_SECRET.substring(0,5) + '...' + JWT_SECRET.substring(JWT_SECRET.length - 5) + ` (longitud: ${JWT_SECRET.length})` : 'Cargado (longitud corta, ¡REVISAR!)') : 'NO ESTABLECIDO (¡CRÍTICO!)';
    console.log(`  JWT_SECRET:          ${jwtSecretToLog}`);
    console.log(`  APP_URL:             ${process.env.APP_URL || `(default http://localhost:${PORT})`}`);
    console.log(`  NODE_ENV:            ${process.env.NODE_ENV || '(no establecido, asumiendo desarrollo)'}`);
    console.log("--------------------------------------------------------------------");
    console.log("\nPara detener el servidor: CTRL+C");
});