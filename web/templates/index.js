// Estado del toggle
let showingDocs = false;

document.addEventListener("DOMContentLoaded", () => {
    const toggleBtn = document.getElementById('toggleDocsBtn');
    const demoContainer = document.getElementById('demoContainer');
    const docsContainer = document.getElementById('docsContainer');

    // Cargar documentación HTML (inyectado por el servidor)
    const documentationHTML = __DOCUMENTATION_HTML__;
    docsContainer.innerHTML = documentationHTML;

    // Configurar demo interactivo
    let counter = 0;
    const counterValue = document.getElementById('counterValue');
    const incrementBtn = document.getElementById('incrementBtn');
    const decrementBtn = document.getElementById('decrementBtn');

    incrementBtn.addEventListener('click', () => {
        counter++;
        counterValue.textContent = counter;
    });

    decrementBtn.addEventListener('click', () => {
        counter--;
        counterValue.textContent = counter;
    });

    // Toggle fluido entre vista de demo y documentación
    toggleBtn.addEventListener('click', () => {
        showingDocs = !showingDocs;

        if (showingDocs) {
            demoContainer.style.display = 'none';
            docsContainer.style.display = 'block';
            toggleBtn.textContent = 'Ver Demo Interactivo';
        } else {
            demoContainer.style.display = 'block';
            docsContainer.style.display = 'none';
            toggleBtn.textContent = 'Ver Documentación';
        }
    });

    console.log('✅ PulseDev inicializado correctamente - Puerto 3003');
});
