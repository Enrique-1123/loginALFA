// ia/userProfile.js
console.log('[userProfile] Script cargado.');

class UserProfileManager {
    constructor(storageKey = 'literacyProfile') {
        this.storageKey = storageKey;
        try {
            this.profile = JSON.parse(localStorage.getItem(this.storageKey)) || this.getDefaultProfile();
            console.log('Perfil de usuario cargado/inicializado:', this.profile);
        } catch (e) {
            console.error("Error al cargar perfil:", e);
            this.profile = this.getDefaultProfile();
        }
        this.profile = { ...this.getDefaultProfile(), ...this.profile };
    }

    getDefaultProfile() {
        // console.log('Creando perfil por defecto.'); // Log menos verboso
        return { level: 'Inicial', streak: 0, lastActive: null, knownWords: [], practiceAreas: [] };
    }

    updateProfile(text, errors) {
        if (!text || !Array.isArray(errors)) { console.warn('[UP] No se actualiza perfil sin datos.'); return; }
        try {
            const today = new Date().toISOString().split('T')[0];
            // Actualizar Racha
            if (this.profile.lastActive && this.profile.lastActive !== today) {
                const lastDate = new Date(this.profile.lastActive); const todayDate = new Date(today);
                const diffTime = Math.abs(todayDate - lastDate); const diffDays = Math.ceil(diffTime / (1000*60*60*24));
                if (diffDays === 1) { this.profile.streak = (this.profile.streak || 0) + 1; } else if (diffDays > 1) { this.profile.streak = 1; }
            } else if (!this.profile.lastActive || this.profile.lastActive !== today) { this.profile.streak = 1; }
            this.profile.lastActive = today;
            // Actualizar Nivel
            const wordCount = text.split(/\s+/).filter(Boolean).length || 1; const errorRate = errors.length / wordCount;
            if (errorRate < 0.03 && wordCount > 5) { this.profile.level = 'Progresando'; }
            else if (errorRate < 0.10 && wordCount > 3) { this.profile.level = 'Emergente'; }
            else { this.profile.level = 'Inicial'; }
            console.log(`[UP] Nivel: ${this.profile.level}, Racha: ${this.profile.streak}`);
            // Actualizar Áreas Práctica
            const errorCategories = new Set(errors.map(e => e.rule?.category?.id || (e.rule?.issueType || 'unknown').toUpperCase() ));
            const simpleAreas = [...errorCategories].map(cat => { if(cat.includes('SPELL')||cat.includes('CONFUSED')) return 'Ortografía'; if(cat.includes('CASING')) return 'Mayúsculas'; if(cat.includes('WHITE')) return 'Espacios'; if(cat.includes('PUNCT')) return 'Puntuación'; if(cat.includes('GRAMMAR')||cat.includes('SYNTAX')) return 'Gramática'; return 'Otros'; });
            this.profile.practiceAreas = [...new Set(simpleAreas)].slice(0, 3);
            // Actualizar Palabras Conocidas
            if (errors.length === 0 && wordCount > 0) { const words = text.toLowerCase().match(/\b[a-záéíóúñü]{3,7}\b/g) || []; words.forEach(w => { if (!this.profile.knownWords.includes(w) && this.profile.knownWords.length < 50) { this.profile.knownWords.push(w); } }); }
            this.saveProfile();
        } catch (error) { console.error("[UP] Error actualizando perfil:", error); }
    }

    saveProfile() {
        try { localStorage.setItem(this.storageKey, JSON.stringify(this.profile)); console.log('[UP] Perfil guardado.'); this.updateUI(); }
        catch (e) { console.error("[UP] Error guardando perfil:", e); if (e.name === 'QuotaExceededError') { alert('No espacio para guardar progreso.'); } }
    }

    updateUI() {
        try {
            const levelElement = document.getElementById('user-level'); const streakElement = document.getElementById('streak-count');
            const practiceElement = document.getElementById('practice-areas-list'); const badgeElement = document.getElementById('achievements-badge');
            if (levelElement) { levelElement.textContent = this.profile.level || 'Inicial'; }
            if (streakElement) { streakElement.textContent = this.profile.streak || 0; }
            if (practiceElement) { if (this.profile.practiceAreas?.length > 0) { practiceElement.innerHTML = `<i class="fas fa-pencil-alt"></i> Practicar: <strong>${this.profile.practiceAreas.join(', ')}</strong>`; practiceElement.style.display = 'block'; } else { practiceElement.style.display = 'none'; } }
            if (badgeElement) { if (this.profile.streak >= 3) { badgeElement.innerHTML = `<span class="badge"><i class="fas fa-fire"></i> Racha: ${this.profile.streak} días!</span>`; badgeElement.style.display = 'block'; } else { badgeElement.style.display = 'none'; } }
            // console.log('[UP] UI actualizada.'); // Log menos verboso
        } catch (e) { console.error("[UP] Error actualizando UI:", e); }
    }
}

// --- Inicialización y Conexión con Eventos ---
document.addEventListener('DOMContentLoaded', () => {
    console.log('[userProfile] DOM cargado.');
    const profileManager = new UserProfileManager();
    profileManager.updateUI(); // Mostrar estado inicial
    document.addEventListener('textCorrected', (e) => {
        // console.log('[UP] Evento textCorrected recibido.'); // Log menos verboso
        if (e.detail && e.detail.success) {
            if (e.detail.text && Array.isArray(e.detail.errors)) { profileManager.updateProfile(e.detail.text, e.detail.errors); }
            else { console.warn('[UP] textCorrected sin datos para perfil.'); }
        }
    });
    // --- Manejo de Pestañas (Si se movió aquí) ---
    const tabButtons = document.querySelectorAll('.ai-tabs .ai-tab'); const tabContents = document.querySelectorAll('.ai-tabcontent');
    let activeTabFound = false; // Flag para asegurar que al menos una esté activa
    tabButtons.forEach(button => {
         if(button.classList.contains('active')) activeTabFound = true; // Verificar si ya hay una activa en el HTML
        button.addEventListener('click', (event) => {
            const clickedButton = event.currentTarget; const tabName = clickedButton.id.replace('-tab', ''); const targetContentId = `ai-${tabName}`;
            tabContents.forEach(content => content.classList.remove('active')); tabButtons.forEach(btn => btn.classList.remove('active'));
            const targetContent = document.getElementById(targetContentId);
            if (targetContent) { targetContent.classList.add('active'); clickedButton.classList.add('active'); console.log(`[Tabs] Pestaña: ${tabName}`); if (tabName === 'progress') { profileManager.updateUI(); } }
            else { console.error(`[Tabs] Contenido no encontrado: ${targetContentId}`); }
        });
    });
    // Activar la primera si ninguna está activa por defecto en el HTML
    if (!activeTabFound && tabButtons.length > 0 && tabContents.length > 0) {
         const firstTabButton = tabButtons[0];
         const firstTabContentId = `ai-${firstTabButton.id.replace('-tab', '')}`;
         const firstTabContent = document.getElementById(firstTabContentId);
         if (firstTabButton && firstTabContent) {
             firstTabButton.classList.add('active');
             firstTabContent.classList.add('active');
             console.log('[Tabs] Pestaña inicial activada por JS:', firstTabButton.id);
         }
    } else if (activeTabFound) {
         console.log('[Tabs] Una pestaña ya estaba activa al cargar HTML.');
    }
});