/**
 * oldMemory.ts
 * ----------
 * Handles archival and retrieval of consolidated long-term memories.
 *
 * Flow:
 *  - CAMA evicts low-salience items → pass to OldMemory.archive()
 *  - Archive summarizes the evicted item using LLM
 *  - Stores summarized chunk in MongoDB (wellness_db.old_memory)
 *  - On-demand retrieval via search() for context relevance
 *
 * Retention: Forever (or manual purge)
 */

import { MongoClient, Collection } from "mongodb";
import { config } from "../config";
import { llmBalancer } from "../utils/llmBalancer";
import type { MemoryNode, ArchivedMemory } from "../types";

const client = new MongoClient(config.mongodbUri);
let oldMemoryCollection: Collection<ArchivedMemory> | null = null;

async function getCollection(): Promise<Collection<ArchivedMemory>> {
    if (!oldMemoryCollection) {
        await client.connect();
        oldMemoryCollection = client.db("wellness_db").collection<ArchivedMemory>("old_memory");
        // Compound index for fast lookups by user + time
        await oldMemoryCollection.createIndex({ userId: 1, archivedAt: -1 });
        // Text index for semantic search
        await oldMemoryCollection.createIndex({ summary: "text", emotion_tags: "text" });
    }
    return oldMemoryCollection;
}

/**
 * Summarize a memory node using LLM
 * Extracts the most significant aspects into a concise summary
 */
async function summarizeMemoryNode(node: MemoryNode): Promise<string> {
    try {
        const prompt = `Summarize this user input into 1-2 sentences capturing the core emotion/issue. Be concise and preserve key insights:

User message: "${node.content}"
Emotion tags: ${node.emotion_tags.join(", ")}

Concise summary (max 50 words):`;

        const completion = await llmBalancer.createChatCompletion({
            model: config.groqModel,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
            max_tokens: 100,
        });

        return (completion.choices[0]?.message?.content ?? "").trim();
    } catch (err) {
        console.error("[OldMemory] Summarization failed:", err);
        // Fallback: first 100 chars
        return node.content.slice(0, 100);
    }
}

/**
 * Keyword overlap for relevance scoring
 */
function keywordOverlap(setA: string[], setB: string[]): number {
    if (setA.length === 0 || setB.length === 0) return 0;
    const a = new Set(setA.map((x) => x.toLowerCase()));
    const intersection = setB.filter((w) => a.has(w.toLowerCase())).length;
    const union = new Set([...setA.map((x) => x.toLowerCase()), ...setB.map((x) => x.toLowerCase())]).size;
    return intersection / union;
}

export class OldMemoryStore {
    private readonly userId: string;

    constructor(userId: string) {
        this.userId = userId;
    }

    /**
     * Archive a memory node: summarize + store
     * Called when CAMA evicts an item
     */
    async archive(node: MemoryNode, reason: string = "ring_evicted"): Promise<void> {
        try {
            const summary = await summarizeMemoryNode(node);
            const col = await getCollection();

            const archived: ArchivedMemory = {
                userId: this.userId,
                originalContent: node.content,
                summary,
                emotion_tags: node.emotion_tags,
                originalSalience: node.salience,
                archiveReason: reason,
                archivedAt: Date.now(),
                // Optional: set expiration (null = never expires)
                expiresAt: null,
            };

            await col.insertOne(archived);
            console.log(`[OldMemory] Archived memory for ${this.userId}: "${summary.slice(0, 40)}..."`);
        } catch (err) {
            console.error("[OldMemory] Archive failed:", err);
        }
    }

    /**
     * Search old memories by query (emotion tags + semantic relevance)
     * Called on-demand during memory fetch
     */
    async search(
        queryTags: string[],
        query?: string,
        limit: number = 5
    ): Promise<ArchivedMemory[]> {
        try {
            const col = await getCollection();

            // Fetch all old memories for this user
            const allMemories = await col
                .find({
                    userId: this.userId,
                    expiresAt: { $in: [null, { $gte: Date.now() }] } as any, // Not expired
                })
                .toArray() as ArchivedMemory[];

            if (allMemories.length === 0) return [];

            // Score by emotion tag overlap
            const scored = allMemories.map((mem) => {
                const tagScore = keywordOverlap(mem.emotion_tags, queryTags);
                // Recency decay: older memories scored lower
                const ageMs = Date.now() - mem.archivedAt;
                const recencyScore = Math.exp(-ageMs / (30 * 24 * 3600 * 1000)); // 30-day halflife
                const finalScore = 0.6 * tagScore + 0.4 * recencyScore;
                return { memory: mem, score: finalScore };
            });

            return scored
                .sort((a, b) => b.score - a.score)
                .slice(0, limit)
                .map((s) => s.memory);
        } catch (err) {
            console.error("[OldMemory] Search failed:", err);
            return [];
        }
    }

    /**
     * Get all old memories for this user (for analysis/debugging)
     */
    async getAllMemories(): Promise<ArchivedMemory[]> {
        try {
            const col = await getCollection();
            return (await col
                .find({ userId: this.userId })
                .sort({ archivedAt: -1 })
                .toArray()) as ArchivedMemory[];
        } catch (err) {
            console.error("[OldMemory] GetAll failed:", err);
            return [];
        }
    }

    /**
     * Manual purge: remove old memories older than N days
     */
    async purgeOlderThan(days: number): Promise<number> {
        try {
            const col = await getCollection();
            const cutoff = Date.now() - days * 24 * 3600 * 1000;
            const result = await col.deleteMany({
                userId: this.userId,
                archivedAt: { $lt: cutoff },
            });
            console.log(`[OldMemory] Purged ${result.deletedCount} old memories for ${this.userId}`);
            return result.deletedCount;
        } catch (err) {
            console.error("[OldMemory] Purge failed:", err);
            return 0;
        }
    }
}

// Optional: Singleton instance per user (similar to CAMA)
const oldMemoryCache = new Map<string, OldMemoryStore>();

export function getOldMemoryStore(userId: string): OldMemoryStore {
    if (!oldMemoryCache.has(userId)) {
        oldMemoryCache.set(userId, new OldMemoryStore(userId));
    }
    return oldMemoryCache.get(userId)!;
}
