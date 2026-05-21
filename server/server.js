const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    maxHttpBufferSize: 1e8,
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// Store connected targets: Map<clientId, { socketId, id, name, password, resolution }>
const targets = new Map();
// Store connected viewers: Map<socketId, { watchingTargetId: string | null }>
const viewers = new Map();

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    // Initial identification
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
            socket.clientId = data.id; // Save client ID to socket session
            socket.join('targets');
            console.log(`Target registered: ${targetData.name} (${data.id})`);
        } else if (data.type === 'viewer') {
            viewers.set(socket.id, { watchingTargetId: null });
            socket.join('viewers');
            console.log(`Viewer registered: ${socket.id}`);
        }
    });

    // Viewer requests connection with ID and Password
    socket.on('request-connection', (data) => {
        const { targetId, password } = data;
        // Strip any spaces from targetId
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
        
        // Success
        const viewer = viewers.get(socket.id);
        if (viewer) {
            if (viewer.watchingTargetId) {
                socket.leave(`watch-${viewer.watchingTargetId}`);
            }
            viewer.watchingTargetId = cleanTargetId;
            socket.join(`watch-${cleanTargetId}`);
            console.log(`Viewer ${socket.id} is now watching target ${cleanTargetId}`);
            
            socket.emit('connection-success', {
                targetId: cleanTargetId,
                name: target.name,
                resolution: target.resolution
            });
            
            // Start stream on target
            io.to(target.socketId).emit('viewer-joined', { viewerId: socket.id });
        }
    });

    // Target sends screen data -> broadcast to all viewers watching this target
    socket.on('screen', (base64Image) => {
        if (socket.clientId) {
            // Emit to the room specifically for viewers watching THIS target ID
            io.to(`watch-${socket.clientId}`).emit('screen-frame', {
                targetId: socket.clientId,
                image: base64Image
            });
        }
    });

    // Target sends screen capture error -> broadcast to all viewers watching this target
    socket.on('screen-error', (data) => {
        if (socket.clientId) {
            io.to(`watch-${socket.clientId}`).emit('screen-capture-error', {
                targetId: socket.clientId,
                message: data.message
            });
        }
    });

    // Viewer sends input commands -> relay to the target being watched
    socket.on('mouse-move', (data) => {
        const viewer = viewers.get(socket.id);
        if (viewer && viewer.watchingTargetId) {
            const target = targets.get(viewer.watchingTargetId);
            if (target) {
                io.to(target.socketId).emit('mouse-move', data);
            }
        }
    });

    socket.on('mouse-click', (data) => {
        const viewer = viewers.get(socket.id);
        if (viewer && viewer.watchingTargetId) {
            const target = targets.get(viewer.watchingTargetId);
            if (target) {
                io.to(target.socketId).emit('mouse-click', data);
            }
        }
    });

    socket.on('mouse-right-click', (data) => {
        const viewer = viewers.get(socket.id);
        if (viewer && viewer.watchingTargetId) {
            const target = targets.get(viewer.watchingTargetId);
            if (target) {
                io.to(target.socketId).emit('mouse-right-click', data);
            }
        }
    });

    socket.on('scroll', (data) => {
        const viewer = viewers.get(socket.id);
        if (viewer && viewer.watchingTargetId) {
            const target = targets.get(viewer.watchingTargetId);
            if (target) {
                io.to(target.socketId).emit('scroll', data);
            }
        }
    });

    socket.on('key-press', (data) => {
        const viewer = viewers.get(socket.id);
        if (viewer && viewer.watchingTargetId) {
            const target = targets.get(viewer.watchingTargetId);
            if (target) {
                io.to(target.socketId).emit('key-press', data);
            }
        }
    });

    socket.on('disconnect', () => {
        if (socket.clientId) {
            const target = targets.get(socket.clientId);
            if (target) {
                console.log(`Target disconnected: ${target.name} (${socket.clientId})`);
                targets.delete(socket.clientId);
                // Tell viewers watching this target that it disconnected
                io.to(`watch-${socket.clientId}`).emit('target-disconnected');
            }
        } else if (viewers.has(socket.id)) {
            console.log(`Viewer disconnected: ${socket.id}`);
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

const PORT = process.env.PORT || 4500;
server.listen(PORT, () => {
    console.log(`Server (Controller) running at http://localhost:${PORT}`);
});
