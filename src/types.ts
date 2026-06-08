// Router LLM output types
export interface EmotionDetail {
    label: string;
    percentage: number; // 0-100
}

export interface EmotionProfile {
    emotions: EmotionDetail[];
    trajectory: "escalating" | "stable" | "de-escalating";
}

export type ImplicitNeed =
    | "validation"
    | "advice"
    | "venting"
    | "problem_solving"
    | "connection"
    | "unknown";

export interface RouterOutput {
    crisis_level: 0 | 1 | 2 | 3 | 4 | 5;
    crisis_flags: string[];
    emotion: EmotionProfile;
    implicit_need: ImplicitNeed;
    sarcasm_detected: boolean;
    volatility_score: number; // 0.0 - 1.0
    semantic_memory_tags: string[];
    episodic_memory_extract: string;
}

// CAMA Memory types
export interface MemoryNode {
    content: string;
    emotion_tags: string[];
    timestamp: number;
    salience: number;
}

export interface CAMAConsole {
    core_beliefs: string[];
    recurring_patterns: string[];
    identity_facts: string[];
}

// EmoGuard types
export interface EmoGuardReport {
    risk_score: number; // 0.0 - 1.0
    flags: string[];
    intervention_advice: string;
    should_refine: boolean;
    refined_draft?: string;
}

// Conversation turn
export interface ConversationTurn {
    role: "user" | "assistant";
    content: string;
    timestamp: number;
    router_output?: RouterOutput;
    emoguard_report?: EmoGuardReport;
}

// Zep fact
export interface ZepFact {
    fact: string;
    entity?: string;
    valid_at?: string;
    invalid_at?: string;
}

// Old Memory (Consolidated archives) types
export interface ArchivedMemory {
    userId: string;
    originalContent: string;
    summary: string;
    emotion_tags: string[];
    originalSalience: number;
    archiveReason: string;
    archivedAt: number;
    expiresAt?: number | null;
}
