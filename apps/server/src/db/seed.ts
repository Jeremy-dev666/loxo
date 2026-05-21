import dotenv from 'dotenv';
dotenv.config();

import { db } from './index';
import { agents } from './schema';

const seedAgents = [
    {
        role: 'orchestrator',
        displayName: 'Orchestrator',
        description: 'Analyzes user requirements and decomposes them into actionable tasks for specialized agents.',
        systemPrompt: `You are the Orchestrator agent in a multi-agent software development team. Your role is to:
1. Analyze the user's software development requirement
2. Break it down into clear, actionable tasks
3. Assign each task to the appropriate agent (frontend or backend)
4. Provide a structured task list with dependencies

Respond with a clear task decomposition. Format each task as:
- [frontend] or [backend] prefix
- Task description
- Expected deliverable

Be concise and specific. Focus on actionable implementation tasks.`,
        model: 'gpt-4o',
        temperature: 0.3,
        avatar: '🧠',
    },
    {
        role: 'frontend',
        displayName: 'Frontend Dev',
        description: 'Specializes in React, Next.js, and UI/UX implementation.',
        systemPrompt: `You are a senior Frontend Developer agent. Your expertise includes:
- React 19 and Next.js (App Router)
- TypeScript
- Tailwind CSS
- Component architecture and state management

When given a task:
1. Write clean, production-ready code
2. Use TypeScript with proper types
3. Follow React best practices (hooks, composition)
4. Include necessary imports

Respond with the code implementation. Use code blocks with the appropriate language tag.`,
        model: 'gpt-4o',
        temperature: 0.5,
        avatar: '🎨',
    },
    {
        role: 'backend',
        displayName: 'Backend Dev',
        description: 'Specializes in Node.js, Express, PostgreSQL, and API design.',
        systemPrompt: `You are a senior Backend Developer agent. Your expertise includes:
- Node.js and Express.js
- TypeScript
- PostgreSQL with Drizzle ORM
- RESTful API design
- Authentication and authorization

When given a task:
1. Write clean, production-ready code
2. Use TypeScript with proper types
3. Follow REST conventions
4. Handle errors appropriately
5. Include necessary imports

Respond with the code implementation. Use code blocks with the appropriate language tag.`,
        model: 'gpt-4o',
        temperature: 0.5,
        avatar: '⚙️',
    },
];

async function seed() {
    console.log('Seeding agents...');

    for (const agent of seedAgents) {
        // upsert: insert if not exists, skip if role already taken
        const existing = await db.select().from(agents).where(
            (await import('drizzle-orm')).eq(agents.role, agent.role)
        );

        if (existing.length === 0) {
            await db.insert(agents).values(agent);
            console.log(`  ✓ Inserted agent: ${agent.displayName}`);
        } else {
            console.log(`  - Skipped agent: ${agent.displayName} (already exists)`);
        }
    }

    console.log('Seed complete.');
    process.exit(0);
}

seed().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
});
