## [0.1.1] - 2026-06-01
- Versión mínima de Node.js bumpeada a 22.0.0 (fix fs.watch recursive en Linux)
- Agregado guard de versión en CLI con mensaje de error descriptivo
- Fix: path traversal bloqueado en servidor HTTP (respuesta 403)
- Fix: JSON.parse(null) en reloadServer() al releer pulsedev.json
- Fix: reload WebSocket cambia de onclose a mensaje explícito (evita falsos positivos)
- Fix: validación de tipo Array en watchPath antes de iterar
- Fix: styleText removido de Worker Thread (counterChar.js)
- Fix: tests de WebSocket reescritos con async/await (2 cancelled → 0 cancelled)

## [0.1.2] - 2026-06-01
- Refactor: core/run.js deja de ser re-export vacío, es el entry point real
- run.js: sistema de flags atado al schema del pulsedev.json
- run.js: --list-flags muestra los flags disponibles dinámicamente
- run.js: --persist opt-in para escribir el config mergeado al JSON
- serverManager.js: startServer acepta config pre-mergeado opcional
- cli.js: `pulsedev run` delega en runCommand, no startServer
- writter: nuevo helper writeFile() para sobrescritura completa

## [Unreleased] - aprox(2026-06-30)
- Comando: pulsedev view request — tabla de peticiones HTTP desde el log
- Comando: pulsedev view error — tabla de errores desde el log
- Streams para archivos binarios (imágenes, video, audio, fuentes)

## [0.1.0-hotfix] - 2026-05-29
- Refactorización: separación de responsabilidades en módulos
- Extraído serverManager.js con estado encapsulado en objeto
- Extraídos mimeTypes.js y resourceHasher.js
- Eliminada dependencia circular de bin/cli.js en core y helpers
- Unificado default de logLimit a 5
- Corregido __dirname en writter.js para compatibilidad Windows
- Agregado error handling en imports dinámicos del CLI
- Limpiadas variables muertas (spawn, nodeProcess, server)
- Corregida documentación: README y CHANGELOG
- Debounce en Worker de logs para reducir overhead
- Templates externalizados a web/templates/

## [0.1.0] - 2026-05-27
- Servidor HTTP nativo sin dependencias de producción
- File watcher con hash MD5 (solo recarga si el contenido cambió)
- Debounce configurable para evitar recargas repetidas
- Cache busting automático vía hash en src/href del HTML
- Logs de peticiones HTTP en terminal o archivo persistente
- Rotación automática de logs con Worker Thread nativo
- Tipos MIME extendidos: imágenes, video, audio, fuentes, documentos
- Página de bienvenida con demo interactiva y documentación embebida
- Sistema de recarga automática por WebSocket para que el navegador se actualice cuando el servidor se reinicia
- CLI con init, run, --help y --version
