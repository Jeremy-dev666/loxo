import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../db/schema'

interface RegisterBody {
    email: string
    userName: string
    password: string
}

interface LoginBody {
    email: string
    password: string
}

export async function authRoutes(app: FastifyInstance) {
    app.post<{ Body: RegisterBody }>('/register', async (req, reply) => {
        const { email, userName, password } = req.body

        const existing = await db.select().from(users).where(eq(users.email, email))
        if (existing.length > 0) {
            return reply.code(400).send({ error: 'Email already exists' })
        }

        const passwordHash = await bcrypt.hash(password, 10)

        const [user] = await db
            .insert(users)
            .values({ email, userName, passwordHash })
            .returning()

        const token = app.jwt.sign({ userId: user.id }, { expiresIn: '7d' })

        return reply.code(201).send({
            token,
            user: { id: user.id, email: user.email, userName: user.userName },
        })
    })

    app.post<{ Body: LoginBody }>('/login', async (req, reply) => {
        const { email, password } = req.body

        const [user] = await db.select().from(users).where(eq(users.email, email))
        if (!user) {
            return reply.code(401).send({ error: 'User does not exist' })
        }

        const valid = await bcrypt.compare(password, user.passwordHash)
        if (!valid) {
            return reply.code(401).send({ error: 'Invalid password' })
        }

        const token = app.jwt.sign({ userId: user.id }, { expiresIn: '7d' })

        return reply.send({
            token,
            user: { id: user.id, email: user.email, userName: user.userName },
        })
    })
}
