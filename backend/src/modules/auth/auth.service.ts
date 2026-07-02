import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { users, type User } from '../../db/schema';
import { conflict, unauthorized } from '../../http/errors';

const BCRYPT_ROUNDS = 10;

export interface PublicUser {
  id: string;
  email: string;
  username: string;
}

function toPublic(user: User): PublicUser {
  return { id: user.id, email: user.email, username: user.username };
}

export async function registerUser(input: {
  email: string;
  username: string;
  password: string;
}): Promise<PublicUser> {
  const [byEmail] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (byEmail) throw conflict('email_taken', 'Email is already registered');

  const [byUsername] = await db
    .select()
    .from(users)
    .where(eq(users.username, input.username))
    .limit(1);
  if (byUsername) throw conflict('username_taken', 'Username is already taken');

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const [created] = await db
    .insert(users)
    .values({ email: input.email, username: input.username, passwordHash })
    .returning();
  return toPublic(created!);
}

export async function authenticateUser(input: {
  email: string;
  password: string;
}): Promise<PublicUser> {
  const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw unauthorized('Invalid email or password');
  }
  return toPublic(user);
}

export async function getUserById(id: string): Promise<PublicUser | null> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ? toPublic(user) : null;
}
