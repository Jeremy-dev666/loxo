import type { WebSocket } from 'ws'
import type { WsEnvelope } from '@swarmdev/shared'

// Tracks live sockets per user. A user may hold several (multiple tabs), so each
// userId maps to a set. This is the hook the messaging layer uses to push frames
// to a specific user regardless of which connection is active.
class ConnectionRegistry {
    private byUser = new Map<string, Set<WebSocket>>()

    add(userId: string, socket: WebSocket) {
        let set = this.byUser.get(userId)
        if (!set) {
            set = new Set()
            this.byUser.set(userId, set)
        }
        set.add(socket)
    }

    remove(userId: string, socket: WebSocket) {
        const set = this.byUser.get(userId)
        if (!set) return
        set.delete(socket)
        if (set.size === 0) this.byUser.delete(userId)
    }

    // Send a frame to every connection owned by a user. No-op if the user has no
    // live sockets. Returns the number of sockets the frame was written to.
    sendToUser<T>(userId: string, envelope: WsEnvelope<T>): number {
        const set = this.byUser.get(userId)
        if (!set) return 0
        const data = JSON.stringify(envelope)
        let sent = 0
        for (const socket of set) {
            if (socket.readyState === socket.OPEN) {
                socket.send(data)
                sent++
            }
        }
        return sent
    }
}

export const connections = new ConnectionRegistry()
