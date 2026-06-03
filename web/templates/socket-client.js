(function() {
    let ws = new WebSocket("ws://localhost:" + location.port);
    ws.onmessage = (e) => { if (e.data === "reload") location.reload(); };
    ws.onclose = () => setTimeout(() => location.reload(), 1000);
    ws.onerror = () => setTimeout(() => location.reload(), 1000);
})()