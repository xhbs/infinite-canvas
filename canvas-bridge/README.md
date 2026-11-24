# Infinite Canvas Bridge

The bridge runs as a standalone local service. The project data directory stores its connection settings and media, and the desktop launcher starts the service alongside the application.

```powershell
node canvas-bridge/bridge-start.mjs
```

MCP clients can launch `canvas-bridge/mcp.js`. Both entry points read `data/storages/canvas-bridge/settings.json` and share the same running canvas session. The bridge listens on `127.0.0.1` and uses ports 3211–3220.

When the canvas opens, it discovers the local bridge and connects automatically. The bootstrap endpoint only returns connection credentials to the configured local canvas origin.
