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

export type GoalStatus = 'active' | 'completed' | 'archived'

export interface Goal {
    id: string
    userId: string
    title: string
    description: string | null
    status: GoalStatus
    createdAt: string
    updatedAt: string
}

export type ProjectStatus = 'active' | 'completed' | 'archived'

export interface Project {
    id: string
    userId: string
    goalId: string | null
    name: string
    description: string | null
    status: ProjectStatus
    createdAt: string
    updatedAt: string
}

export type AgentStatus = 'active' | 'inactive'

export interface Agent {
    id: string
    userId: string
    name: string
    role: string
    systemPrompt: string | null
    model: string
    status: AgentStatus
    createdAt: string
    updatedAt: string
}

export type IssueStatus = 'todo' | 'in_progress' | 'in_review' | 'done'

export type IssuePriority = 'low' | 'medium' | 'high'

export interface Issue {
    id: string
    projectId: string
    assigneeAgentId: string | null
    title: string
    description: string | null
    status: IssueStatus
    priority: IssuePriority
    createdAt: string
    updatedAt: string
}

export type SubmissionStatus = 'pending' | 'approved' | 'changes_requested'

export interface Submission {
    id: string
    issueId: string
    agentId: string | null
    content: string
    status: SubmissionStatus
    createdAt: string
    updatedAt: string
}

export type ReviewDecision = 'approve' | 'request_changes'

export interface Review {
    id: string
    submissionId: string
    userId: string
    decision: ReviewDecision
    comment: string | null
    createdAt: string
}

export interface Skill {
    id: string
    userId: string
    sourceReviewId: string | null
    title: string
    content: string
    createdAt: string
    updatedAt: string
}
