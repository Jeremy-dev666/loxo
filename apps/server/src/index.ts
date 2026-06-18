import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { authRoutes } from './routes/auth'
import { goalRoutes } from './routes/goals'
import { projectRoutes } from './routes/projects'
import { issueRoutes } from './routes/issues'
import { agentRoutes } from './routes/agents'

const app = Fastify({ logger: true })

await app.register(cors, {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
})

await app.register(jwt, {
    secret: process.env.JWT_SECRET || 'swarmdev-dev-secret',
})

await app.register(authRoutes, { prefix: '/api/auth' })
await app.register(goalRoutes, { prefix: '/api/goals' })
await app.register(projectRoutes, { prefix: '/api/projects' })
await app.register(issueRoutes, { prefix: '/api/issues' })
await app.register(agentRoutes, { prefix: '/api/agents' })

app.get('/api/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
}))

const port = Number(process.env.PORT) || 4000

try {
    await app.listen({ port, host: '0.0.0.0' })
    app.log.info(`SwarmDev server running on http://localhost:${port}`)
} catch (err) {
    app.log.error(err)
    process.exit(1)
}
