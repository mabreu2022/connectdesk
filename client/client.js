const { io } = require('socket.io-client');
const { spawn, exec } = require('child_process');
const readline = require('readline');
const os = require('os');
const fs = require('fs');
const path = require('path');

const isPkg = typeof process.pkg !== 'undefined';
const configDir = isPkg ? path.dirname(process.execPath) : __dirname;
const configPath = path.join(configDir, 'config.json');

// Default configuration
let config = {
    id: '',
    serverUrl: 'http://localhost:4500'
};

function loadAndSaveConfig() {
    if (fs.existsSync(configPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (data.id && /^\d{9}$/.test(data.id)) {
                config.id = data.id;
            }
            if (data.serverUrl) {
                config.serverUrl = data.serverUrl;
            }
        } catch (e) {}
    }

    // Generate new ID if not present
    if (!config.id) {
        config.id = Math.floor(100000000 + Math.random() * 900000000).toString();
    }

    // Allow overriding via command-line arguments or environment variables
    if (process.argv[2] && process.argv[2].startsWith('http')) {
        config.serverUrl = process.argv[2];
    } else if (process.env.SERVER_URL) {
        config.serverUrl = process.env.SERVER_URL;
    }

    // Save configuration to ensure it's written and up to date
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save config.json:', e.message);
    }
}

// ─── Embedded Controller Server ───────────────────────────
function startEmbeddedServer() {
    try {
        const express = require('express');
        const http = require('http');
        const { Server } = require('socket.io');

        const app = express();
        const server = http.createServer(app);
        const io = new Server(server, { 
            maxHttpBufferSize: 1e8,
            cors: {
                origin: '*',
                methods: ['GET', 'POST']
            }
        });

        // Serve the embedded static files
        // When packaged with pkg, we must use __dirname to access internal virtual assets
        app.use(express.static(path.join(__dirname, 'public')));

        // Explicit route for index.html to guarantee it loads under pkg on all platforms
        app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });

        // Store connected targets & viewers
        const targets = new Map();
        const viewers = new Map();

        io.on('connection', (socket) => {
            socket.on('register', (data) => {
                if (data.type === 'target') {
                    const targetData = {
                        socketId: socket.id,
                        id: data.id,
                        name: data.name || `Host-${data.id}`,
                        password: data.password,
                        resolution: data.resolution || { width: 1920, height: 1080 }
                    };
                    targets.set(data.id, targetData);
                    socket.clientId = data.id;
                    socket.join('targets');
                } else if (data.type === 'viewer') {
                    viewers.set(socket.id, { watchingTargetId: null });
                    socket.join('viewers');
                }
            });

            socket.on('request-connection', (data) => {
                const { targetId, password } = data;
                const cleanTargetId = targetId.replace(/\s+/g, '');
                const target = targets.get(cleanTargetId);
                
                if (!target) {
                    socket.emit('connection-error', { message: 'Dispositivo offline ou ID incorreto.' });
                    return;
                }
                
                if (target.password !== password) {
                    socket.emit('connection-error', { message: 'Senha incorreta.' });
                    return;
                }
                
                const viewer = viewers.get(socket.id);
                if (viewer) {
                    if (viewer.watchingTargetId) {
                        socket.leave(`watch-${viewer.watchingTargetId}`);
                    }
                    viewer.watchingTargetId = cleanTargetId;
                    socket.join(`watch-${cleanTargetId}`);
                    
                    socket.emit('connection-success', {
                        targetId: cleanTargetId,
                        name: target.name,
                        resolution: target.resolution
                    });
                    
                    io.to(target.socketId).emit('viewer-joined', { viewerId: socket.id });
                }
            });

            socket.on('screen', (base64Image) => {
                if (socket.clientId) {
                    io.to(`watch-${socket.clientId}`).emit('screen-frame', {
                        targetId: socket.clientId,
                        image: base64Image
                    });
                }
            });

            socket.on('screen-error', (data) => {
                if (socket.clientId) {
                    io.to(`watch-${socket.clientId}`).emit('screen-capture-error', {
                        targetId: socket.clientId,
                        message: data.message
                    });
                }
            });

            socket.on('mouse-move', (data) => {
                const viewer = viewers.get(socket.id);
                if (viewer && viewer.watchingTargetId) {
                    const target = targets.get(viewer.watchingTargetId);
                    if (target) io.to(target.socketId).emit('mouse-move', data);
                }
            });

            socket.on('mouse-click', (data) => {
                const viewer = viewers.get(socket.id);
                if (viewer && viewer.watchingTargetId) {
                    const target = targets.get(viewer.watchingTargetId);
                    if (target) io.to(target.socketId).emit('mouse-click', data);
                }
            });

            socket.on('mouse-right-click', (data) => {
                const viewer = viewers.get(socket.id);
                if (viewer && viewer.watchingTargetId) {
                    const target = targets.get(viewer.watchingTargetId);
                    if (target) io.to(target.socketId).emit('mouse-right-click', data);
                }
            });

            socket.on('scroll', (data) => {
                const viewer = viewers.get(socket.id);
                if (viewer && viewer.watchingTargetId) {
                    const target = targets.get(viewer.watchingTargetId);
                    if (target) io.to(target.socketId).emit('scroll', data);
                }
            });

            socket.on('key-press', (data) => {
                const viewer = viewers.get(socket.id);
                if (viewer && viewer.watchingTargetId) {
                    const target = targets.get(viewer.watchingTargetId);
                    if (target) io.to(target.socketId).emit('key-press', data);
                }
            });

            socket.on('disconnect', () => {
                if (socket.clientId) {
                    const target = targets.get(socket.clientId);
                    if (target) {
                        targets.delete(socket.clientId);
                        io.to(`watch-${socket.clientId}`).emit('target-disconnected');
                    }
                } else if (viewers.has(socket.id)) {
                    const viewer = viewers.get(socket.id);
                    if (viewer && viewer.watchingTargetId) {
                        const target = targets.get(viewer.watchingTargetId);
                        if (target) {
                            io.to(target.socketId).emit('viewer-left', { viewerId: socket.id });
                        }
                    }
                    viewers.delete(socket.id);
                }
            });
        });

        const PORT = 4500;
        server.listen(PORT, () => {
            console.log(`\x1b[32m[Server] Web Control Panel active at http://localhost:${PORT}\x1b[0m`);
            console.log('==================================================');
        }).on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`[Server] Port ${PORT} already in use. Running in client-only mode.`);
                console.log('==================================================');
            } else {
                console.error('[Server Error]', err.message);
            }
        });
    } catch (e) {
        console.error('Failed to start embedded server:', e.message);
    }
}

loadAndSaveConfig();
startEmbeddedServer();

const clientId = config.id;
const SERVER_URL = config.serverUrl;
const formattedId = clientId.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
const tempPassword = Math.floor(1000 + Math.random() * 9000).toString();

function openBrowser(url) {
    if (process.platform === 'win32') {
        // Try native Windows ShellExecute protocol handler first (sub-millisecond & bypasses restricted execution policies)
        exec(`rundll32 url.dll,FileProtocolHandler "${url}"`, (err) => {
            if (err) {
                console.error('[Browser Error] rundll32 failed, trying PowerShell fallback:', err.message);
                const cmd = `powershell -NoProfile -Command "Start-Process '${url}'"`;
                exec(cmd, (err2) => {
                    if (err2) {
                        console.error('[Browser Error] PowerShell fallback failed:', err2.message);
                    }
                });
            }
        });
    } else {
        const startCmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
        exec(`${startCmd} "${url}"`, (err) => {
            if (err) {
                console.error('[Browser Error] Failed to open browser:', err.message);
            }
        });
    }
}

// Robust readline interface to handle [Enter] across all shell/consoles on Windows without TTY issues
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.on('line', (line) => {
    console.log('\n\x1b[36m[Control] Opening Control Panel in your browser...\x1b[0m');
    const targetUrl = SERVER_URL.includes('localhost') ? 'http://localhost:4500' : SERVER_URL;
    openBrowser(targetUrl);
});

rl.on('SIGINT', () => {
    process.exit();
});

console.clear();
console.log('==================================================');
console.log('       ANYDESK REMOTE CONTROL CLIENT (PoC)        ');
console.log('==================================================');
console.log(`  Endereço Remoto:      \x1b[36m${formattedId}\x1b[0m`);
console.log(`  Senha Temporária:     \x1b[33m${tempPassword}\x1b[0m`);
console.log('==================================================');
console.log(`  Conectando ao Coordenador: ${SERVER_URL}`);
console.log('==================================================');
console.log('  ► SE DETECTAR TELA PRETA EM VPS WINDOWS:');
console.log('    Caso sua sessão RDP caia ou seja fechada, a GUI trava.');
console.log('    Para desconectar mantendo a tela ativa, rode no cmd:');
console.log('    \x1b[33mtscon 1 /dest:console\x1b[0m (troque 1 pelo ID da query session)');
console.log('==================================================');
console.log('  ► PARA CONTROLAR OUTRO COMPUTADOR:');
console.log('    Pressione [Enter] para abrir o Painel de Controle');
console.log('==================================================');

// ─── Persistent PowerShell Input & Capture Controller ──────────────────────────
// We load Win32 APIs and native GDI+ capturing in C# once inside PowerShell
const PS_INIT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Windows.Forms;

public class RC {
    [StructLayout(LayoutKind.Sequential)]
    public struct CURSORINFO {
        public Int32 cbSize;
        public Int32 flags;
        public IntPtr hCursor;
        public POINTAPI ptScreenPos;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINTAPI {
        public int x;
        public int y;
    }

    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, int d, IntPtr i);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint f, IntPtr i);
    [DllImport("user32.dll")] public static extern short VkKeyScan(char c);
    [DllImport("user32.dll")] public static extern bool GetCursorInfo(out CURSORINFO pci);
    [DllImport("user32.dll")] public static extern bool DrawIcon(IntPtr hDC, int x, int y, IntPtr hIcon);

    public const Int32 CURSOR_SHOWING = 0x00000001;

    public static void Move(int x, int y) { SetCursorPos(x, y); }
    
    public static void Click() {
        mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
        mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
    }
    
    public static void RightClick() {
        mouse_event(0x0008, 0, 0, 0, IntPtr.Zero);
        mouse_event(0x0010, 0, 0, 0, IntPtr.Zero);
    }
    
    public static void Scroll(int delta) {
        mouse_event(0x0800, 0, 0, delta, IntPtr.Zero);
    }
    
    public static void PressKey(byte vk) {
        keybd_event(vk, 0, 0, IntPtr.Zero);
        keybd_event(vk, 0, 0x0002, IntPtr.Zero);
    }
    
    public static void TypeChar(char c) {
        short vks = VkKeyScan(c);
        byte vk = (byte)(vks & 0xff);
        bool shift = (vks >> 8 & 1) == 1;
        if (shift) keybd_event(0x10, 0, 0, IntPtr.Zero);
        PressKey(vk);
        if (shift) keybd_event(0x10, 0, 0x0002, IntPtr.Zero);
    }

    public static string CaptureScreen(int quality) {
        try {
            Rectangle bounds = Screen.PrimaryScreen.Bounds;
            using (Bitmap bitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb)) {
                using (Graphics g = Graphics.FromImage(bitmap)) {
                    g.CopyFromScreen(bounds.X, bounds.Y, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
                    
                    CURSORINFO pci;
                    pci.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
                    if (GetCursorInfo(out pci)) {
                        if (pci.flags == CURSOR_SHOWING) {
                            IntPtr hdc = g.GetHdc();
                            DrawIcon(hdc, pci.ptScreenPos.x - bounds.X, pci.ptScreenPos.y - bounds.Y, pci.hCursor);
                            g.ReleaseHdc(hdc);
                        }
                    }
                }
                
                ImageCodecInfo jpegEncoder = null;
                ImageCodecInfo[] codecs = ImageCodecInfo.GetImageDecoders();
                foreach (ImageCodecInfo codec in codecs) {
                    if (codec.FormatID == ImageFormat.Jpeg.Guid) {
                        jpegEncoder = codec;
                        break;
                    }
                }

                if (jpegEncoder == null) return "ERROR: No JPEG Encoder";

                Encoder myEncoder = Encoder.Quality;
                EncoderParameters myEncoderParameters = new EncoderParameters(1);
                EncoderParameter myEncoderParameter = new EncoderParameter(myEncoder, (long)quality);
                myEncoderParameters.Param[0] = myEncoderParameter;

                using (MemoryStream ms = new MemoryStream()) {
                    bitmap.Save(ms, jpegEncoder, myEncoderParameters);
                    return Convert.ToBase64String(ms.ToArray());
                }
            }
        } catch (Exception ex) {
            return "ERROR: " + ex.Message;
        }
    }
}
"@ -ReferencedAssemblies "System.Drawing", "System.Windows.Forms"

# Fetch actual resolution of the primary screen
Add-Type -AssemblyName System.Windows.Forms
$w = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width
$h = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height
Write-Host "READY|$w|$h"

while ($true) {
    $line = [Console]::ReadLine()
    if ($null -eq $line) { break }
    $p = $line -split "\\|"
    switch ($p[0]) {
        "move"       { [RC]::Move([int]$p[1], [int]$p[2]) }
        "click"      { [RC]::Click() }
        "rightclick" { [RC]::RightClick() }
        "scroll"     { [RC]::Scroll([int]$p[1]) }
        "capture"    { 
            // Use Quality 85 for perfect text crispness and readability
            $base64 = [RC]::CaptureScreen(85)
            Write-Host "FRAME|$base64"
        }
        "key" {
            switch ($p[1]) {
                "Enter"     { [RC]::PressKey(0x0D) }
                "Backspace" { [RC]::PressKey(0x08) }
                "Tab"       { [RC]::PressKey(0x09) }
                "Escape"    { [RC]::PressKey(0x1B) }
                "Delete"    { [RC]::PressKey(0x2E) }
                "ArrowLeft" { [RC]::PressKey(0x25) }
                "ArrowUp"   { [RC]::PressKey(0x26) }
                "ArrowRight"{ [RC]::PressKey(0x27) }
                "ArrowDown" { [RC]::PressKey(0x28) }
                "Home"      { [RC]::PressKey(0x24) }
                "End"       { [RC]::PressKey(0x23) }
                default {
                    if ($p[1].Length -eq 1) { [RC]::TypeChar($p[1][0]) }
                }
            }
        }
    }
}
`;

let psReady = false;
let actualWidth = 1920;
let actualHeight = 1080;
let isSocketConnected = false;

const psProc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS_INIT], {
    stdio: ['pipe', 'pipe', 'pipe']
});

let isStreaming = false;
let lastFrameTime = 0;
const targetMinInterval = 33; // limit to ~30 FPS to avoid overloading network/browser

function tryRegister() {
    if (isSocketConnected && psReady) {
        socket.emit('register', {
            type: 'target',
            id: clientId,
            password: tempPassword,
            name: os.hostname(),
            resolution: { width: actualWidth, height: actualHeight }
        });
    }
}

// Line-buffered stdout parser to handle large base64 strings correctly
let stdoutBuffer = '';
psProc.stdout.on('data', (d) => {
    stdoutBuffer += d.toString();
    let index;
    while ((index = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.substring(0, index).trim();
        stdoutBuffer = stdoutBuffer.substring(index + 1);
        
        if (line.startsWith('READY')) {
            const parts = line.split('|');
            actualWidth = parts[1] ? parseInt(parts[1], 10) : 1920;
            actualHeight = parts[2] ? parseInt(parts[2], 10) : 1080;
            psReady = true;
            console.log(`\x1b[32m[Input] Input & Capture controller ready. Screen resolution: ${actualWidth}x${actualHeight}\x1b[0m`);
            tryRegister();
        } else if (line.startsWith('FRAME|')) {
            const base64Image = line.substring(6);
            if (base64Image.startsWith('ERROR')) {
                console.error(`\x1b[31m[Capture Error] Screen capture failed: ${base64Image}\x1b[0m`);
                socket.emit('screen-error', {
                    message: base64Image
                });
                
                // Retry after 2 seconds
                if (isStreaming) {
                    setTimeout(captureNextFrame, 2000);
                }
            } else if (isStreaming) {
                socket.emit('screen', base64Image);
                
                // Adaptive delay for next frame
                const now = Date.now();
                const elapsed = now - lastFrameTime;
                const delay = Math.max(0, targetMinInterval - elapsed);
                lastFrameTime = now;
                
                setTimeout(captureNextFrame, delay);
            }
        }
    }
});

psProc.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) console.error('[PS Error]', msg);
});

psProc.on('exit', (code) => {
    console.log(`[Input] PowerShell exited with code ${code}`);
    psReady = false;
});

function sendInput(cmd) {
    if (psReady) {
        psProc.stdin.write(cmd + '\n');
    }
}
// ─────────────────────────────────────────────────────────────────────────────

const socket = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    extraHeaders: { 'Bypass-Tunnel-Reminder': 'true' }
});

socket.on('connect', () => {
    console.log('\x1b[32m[Status] Connected to Controller Server\x1b[0m');
    isSocketConnected = true;
    tryRegister();
});

socket.on('connect_error', (err) => {
    console.log(`\x1b[31m[Error] Connection failed: ${err.message}\x1b[0m`);
});

function captureNextFrame() {
    if (!isStreaming) return;
    sendInput('capture');
}

socket.on('viewer-joined', () => {
    console.log('\x1b[36m[Status] Viewer connected. Starting high-performance stream...\x1b[0m');
    if (!isStreaming) {
        isStreaming = true;
        lastFrameTime = Date.now();
        captureNextFrame();
    }
});

socket.on('viewer-left', () => {
    console.log('\x1b[33m[Status] Viewer disconnected. Stopping stream.\x1b[0m');
    isStreaming = false;
});

// ── Input event handlers (all use the persistent PS process) ─────────────────
socket.on('mouse-move', (data) => {
    sendInput(`move|${data.x}|${data.y}`);
});

socket.on('mouse-click', () => {
    sendInput('click');
});

socket.on('mouse-right-click', () => {
    sendInput('rightclick');
});

socket.on('key-press', (data) => {
    sendInput(`key|${data.key}`);
});

socket.on('scroll', (data) => {
    const delta = data.delta > 0 ? 120 : -120;
    sendInput(`scroll|${delta}`);
});
// ─────────────────────────────────────────────────────────────────────────────

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    isSocketConnected = false;
    isStreaming = false;
});

process.on('exit', () => {
    psProc.kill();
});
