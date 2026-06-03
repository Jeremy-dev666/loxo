// SwarmDev shared types — populated incrementally as features are built.
//
// Naming convention: domain-prefixed (User*, Goal*, Project*, Issue*, Agent*, Run*, Skill*).
// All API response shapes that cross the server/web boundary live here.

export interface User {
    id: string
    email: string
    userName: string
}

export interface AuthResponse {
    token: string
    user: User
}
