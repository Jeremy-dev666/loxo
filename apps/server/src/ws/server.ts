import type { FastifyInstance } from 'fastify'
import { WebSocketServer, type WebSocket } from 'ws'
import { WS_EVENTS, type WsEnvelope } from '@swarmdev/shared'
import { connections } from './registry'

const HEARTBEAT_INTERVAL_MS = 30_000

// A socket carries the authenticated userId and a liveness flag the heartbeat
// uses to reap dead connections.
interface SocketState {
    userId: string
    isAlive: boolean
}

function send<T>(socket: WebSocket, envelope: WsEnvelope<T>) {
    if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(envelope))
    }
}

// Attaches a WebSocket server to Fastify's underlying HTTP server. Auth happens
// during the HTTP upgrade: the JWT is read from `?token=` and verified with the
// same secret as the REST API. Rejected upgrades never become WebSocket
// connections, so unauthenticated clients can't hold a socket open.
export function setupWebSocket(app: FastifyInstance) {
    const wss = new WebSocketServer({ noServer: true })
    const states = new WeakMap<WebSocket, SocketState>()

    app.server.on('upgrade', (req, socket, head) => {
        // Only handle our path; let other upgrade handlers (if any) pass.
        const url = new URL(req.url ?? '', 'http://localhost')
        if (url.pathname !== '/ws') return

        const token = url.searchParams.get('token')
        if (!token) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
            socket.destroy()
            return
        }

        let userId: string
        try {
            const decoded = app.jwt.verify<{ userId: string }>(token)
            userId = decoded.userId
        } catch {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
            socket.destroy()
            return
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, userId)
        })
    })

    wss.on('connection', (socket: WebSocket, userId: string) => {
        states.set(socket, { userId, isAlive: true })
        connections.add(userId, socket)
        send(socket, { type: WS_EVENTS.connectionAck, payload: { userId } })

        socket.on('pong', () => {
            const state = states.get(socket)
            if (state) state.isAlive = true
        })

        socket.on('message', (raw) => {
            let envelope: WsEnvelope
            try {
                envelope = JSON.parse(raw.toString())
            } catch {
                send(socket, { type: WS_EVENTS.error, payload: { message: 'Invalid JSON' } })
                return
            }

            // Connection-layer frames only for now; business events arrive with
            // the DM step. An application-level ping lets clients probe liveness.
            switch (envelope.type) {
                case WS_EVENTS.ping:
                    send(socket, { type: WS_EVENTS.pong })
                    break
                default:
                    send(socket, {
                        type: WS_EVENTS.error,
                        payload: { message: `Unknown event type: ${envelope.type}` },
                    })
            }
        })

        socket.on('close', () => {
            connections.remove(userId, socket)
            states.delete(socket)
        })

        socket.on('error', () => {
            connections.remove(userId, socket)
            states.delete(socket)
        })
    })

    // Heartbeat: ping every connection each interval. A socket that didn't pong
    // since the last tick is considered dead and terminated (its close handler
    // cleans up the registry).
    const heartbeat = setInterval(() => {
        for (const socket of wss.clients) {
            const state = states.get(socket)
            if (!state) continue
            if (!state.isAlive) {
                socket.terminate()
                continue
            }
            state.isAlive = false
            socket.ping()
        }
    }, HEARTBEAT_INTERVAL_MS)

    wss.on('close', () => clearInterval(heartbeat))
    app.addHook('onClose', async () => {
        clearInterval(heartbeat)
        wss.close()
    })

    app.log.info('WebSocket server listening on /ws')
}
