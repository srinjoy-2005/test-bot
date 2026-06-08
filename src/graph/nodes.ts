import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { config } from "../config";
import { llmBalancer } from "../utils/llmBalancer";
import { runRouterLLM } from "../router/routerLlm";
import { CAMAMemory } from "../memory/cama";
import { ensureSession, getContext, getUserFacts, addTurn } from "../memory/hybridMemory";
import { getOldMemoryStore } from "../memory/oldMemory";
import { buildSystemPrompt } from "../prompts/systemPrompt";
import { runEmoGuard, CRISIS_RESPONSES } from "../safety/emoguard";
import { logFineTuneTurn } from "../finetune/logger";
import type { WellnessStateType } from "./state";

// Cache CAMA instances per user (in-memory within process lifetime)
const camaCache = new Map<string, CAMAMemory>();

function getCAMA(userId: string): CAMAMemory {
    if (!camaCache.has(userId)) {
        camaCache.set(userId, new CAMAMemory(userId));
    }
    return camaCache.get(userId)!;
}

// ─── Node: Intake ────────────────────────────────────────────────────────────
export async function intakeNode(
    state: WellnessStateType
): Promise<Partial<WellnessStateType>> {
    console.log(`\n📥 [Node: Intake] User ID: ${state.userId}, User Name: ${state.userName}`);
    console.log(`   Message: "${state.currentMessage}"`);
    // Ensure Zep session exists
    await ensureSession(state.userId);
    return {
        messages: [...state.messages, new HumanMessage(state.currentMessage)],
    };
}

// ─── Node: Router ─────────────────────────────────────────────────────────────
export async function routerNode(
    state: WellnessStateType
): Promise<Partial<WellnessStateType>> {
    console.log(`🧭 [Node: Router] Analysing message for emotions and crisis flags...`);
    const history = state.messages.slice(-6).map((m: BaseMessage) => ({
        role: m._getType() === "human" ? "user" : "assistant",
        content: typeof m.content === "string" ? m.content : "",
    }));

    const routerOutput = await runRouterLLM(state.currentMessage, history);
    const emoguardSensitivity =
        routerOutput.crisis_level >= 3
            ? "HIGH"
            : routerOutput.volatility_score > 0.6
                ? "HIGH"
                : "MEDIUM";

    console.log(`   Emotion Blend:`, routerOutput.emotion.emotions.map(e => `${e.label} (${e.percentage}%)`).join(", "));
    console.log(`   Crisis Level: ${routerOutput.crisis_level}, Volatility: ${routerOutput.volatility_score}`);
    console.log(`   Implicit Need: ${routerOutput.implicit_need}, Sarcasm: ${routerOutput.sarcasm_detected}`);

    return {
        routerOutput,
        emoguardSensitivity,
        isCrisis: routerOutput.crisis_level >= 4,
    };
}

// ─── Node: Crisis ─────────────────────────────────────────────────────────────
export async function crisisNode(
    state: WellnessStateType
): Promise<Partial<WellnessStateType>> {
    const level = state.routerOutput?.crisis_level ?? 5;
    console.log(`🚨 [Node: Crisis] CRITICAL: Crisis Level ${level} detected. Triggering safety response.`);
    const response = CRISIS_RESPONSES[level] ?? CRISIS_RESPONSES[5];
    return { finalResponse: response };
}

// ─── Node: Memory Fetch ───────────────────────────────────────────────────────
export async function memoryFetchNode(
    state: WellnessStateType
): Promise<Partial<WellnessStateType>> {
    console.log(`💾 [Node: Memory Fetch] Retrieving context from hybrid memory layers...`);
    const cama = getCAMA(state.userId);
    await cama.load();

    const emotionTags = [
        ...(state.routerOutput?.emotion.emotions.map(e => e.label) ?? []),
        ...(state.routerOutput?.semantic_memory_tags ?? []),
    ].filter(Boolean);

    const oldMemory = getOldMemoryStore(state.userId);

    const [camaNodes, zepContext, zepFacts, oldMemories] = await Promise.all([
        Promise.resolve(cama.recall(emotionTags, 5)),
        getContext(state.userId, state.currentMessage),
        getUserFacts(state.userId),
        emotionTags.length > 0 ? oldMemory.search(emotionTags, state.currentMessage, 3) : Promise.resolve([]),
    ]);

    console.log(`   Recalled CAMA: ${camaNodes.length} nodes`);
    console.log(`   Recalled Zep/Local: ${zepFacts.length} facts, Summary length: ${zepContext.summary.length} chars`);
    console.log(`   Recalled Old Memories: ${oldMemories.length} consolidated themes`);

    return {
        camaNodes,
        camaConsole: cama.getConsole(),
        zepFacts: [...zepContext.facts, ...zepFacts],
        zepSummary: zepContext.summary,
        oldMemories,
    };
}

// ─── Node: Generation ─────────────────────────────────────────────────────────
export async function generationNode(
    state: WellnessStateType
): Promise<Partial<WellnessStateType>> {
    console.log(`🤖 [Node: Generation] Generating response draft... (Mock Groq: ${config.useMockGroq})`);
    const systemPrompt = buildSystemPrompt({
        userName: state.userName,
        routerOutput: state.routerOutput!,
        camaNodes: state.camaNodes,
        camaConsole: state.camaConsole,
        zepFacts: state.zepFacts,
        zepSummary: state.zepSummary,
        oldMemories: state.oldMemories,
        emoguardInjection:
            state.emoguardReport?.should_refine
                ? state.emoguardReport.intervention_advice
                : undefined,
    });

    const history = state.messages.slice(-8).map((m: BaseMessage) => ({
        role: (m._getType() === "human" ? "user" : "assistant") as "user" | "assistant",
        content: typeof m.content === "string" ? m.content : "",
    }));

    const completion = await llmBalancer.createChatCompletion({
        model: config.groqModel,
        messages: [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: state.currentMessage },
        ],
        temperature: 0.8,
        max_tokens: 1024,
        presence_penalty: 0.6,  // reduces repetitive/generic phrasing
    });

    const draft = completion.choices[0]?.message?.content ?? "";
    console.log(`   Draft generated: "${draft.replace(/\n/g, " ").slice(0, 80)}..."`);
    return { responseDraft: draft };
}

// ─── Node: EmoGuard ───────────────────────────────────────────────────────────
export async function emoguardNode(
    state: WellnessStateType
): Promise<Partial<WellnessStateType>> {
    console.log(`🛡️ [Node: EmoGuard] Checking draft against therapeutic safety guidelines...`);
    const history = state.messages.slice(-6).map((m: BaseMessage) => ({
        role: m._getType() === "human" ? "user" : "assistant",
        content: typeof m.content === "string" ? m.content : "",
    }));

    const report = await runEmoGuard(
        state.currentMessage,
        state.responseDraft,
        history
    );
    
    console.log(`   Risk Score: ${report.risk_score.toFixed(2)}, Should Refine: ${report.should_refine}`);
    console.log(`   Flags: ${report.flags.join(", ") || "none"}`);
    if (report.should_refine) {
        console.log(`   Advice: ${report.intervention_advice}`);
    }

    // FIX: Actually increment the refineCount so the loop eventually breaks!
    return { 
        emoguardReport: report,
        refineCount: (state.refineCount ?? 0) + 1 
    };
}
// ─── Node: Output ─────────────────────────────────────────────────────────────
export async function outputNode(
    state: WellnessStateType
): Promise<Partial<WellnessStateType>> {
    console.log(`📤 [Node: Output] Final response accepted. Relaying to WebSocket.`);
    return {
        finalResponse: state.responseDraft,
        messages: [...state.messages, new AIMessage(state.responseDraft)],
        refineCount: 0 // FIX: Reset the counter for the next user message
    };
}

// ─── Node: Memory Update ──────────────────────────────────────────────────────
export async function memoryUpdateNode(
    state: WellnessStateType
): Promise<Partial<WellnessStateType>> {
    console.log(`📝 [Node: Memory Update] Ingesting turn into CAMA & hybrid memories...`);
    const cama = getCAMA(state.userId);
    const maxEmotionPercent = state.routerOutput?.emotion.emotions.reduce((max, e) => Math.max(max, e.percentage), 0) ?? 50;
    const salience = Math.max(
        maxEmotionPercent / 100.0,
        state.routerOutput?.volatility_score ?? 0.3
    );

    console.log(`   Ingesting episodic node with salience: ${salience.toFixed(2)}`);
    // Store the episode in CAMA
    await cama.ingest(
        state.currentMessage,
        [
            ...(state.routerOutput?.emotion.emotions.map(e => e.label) ?? []),
            ...(state.routerOutput?.semantic_memory_tags ?? []),
        ].filter(Boolean),
        salience
    );

    // Add to Zep long-term memory + local fallback (via hybridMemory)
    await addTurn(state.userId, state.currentMessage, state.finalResponse);

    // Log turn for future fine-tuning (fire-and-forget)
    const systemPromptSnapshot = buildSystemPrompt({
        userName: state.userName,
        routerOutput: state.routerOutput!,
        camaNodes: state.camaNodes,
        camaConsole: state.camaConsole,
        zepFacts: state.zepFacts,
        zepSummary: state.zepSummary,
    });
    logFineTuneTurn({
        systemPrompt: systemPromptSnapshot,
        userMessage: state.currentMessage,
        aiResponse: state.finalResponse,
        routerOutput: state.routerOutput,
        userId: state.userId,
    }).catch(() => { /* silent */ });

    console.log(`🏁 [Node: Memory Update] Ingest complete. Turn execution finished.\n`);
    return {};
}

// ─── Conditional Edges ────────────────────────────────────────────────────────
export function routeAfterRouter(state: WellnessStateType): string {
    const destination = state.isCrisis ? "crisis" : "memory_fetch";
    console.log(`🔀 [Router Route] Routing to "${destination}" (isCrisis: ${state.isCrisis})`);
    return destination;
}

export function routeAfterEmoguard(state: WellnessStateType): string {
    const shouldRefine = state.emoguardReport?.should_refine && (state.refineCount ?? 0) < 2;
    const destination = shouldRefine ? "refine" : "output";
    console.log(`🔀 [EmoGuard Route] Routing to "${destination}" (shouldRefine: ${shouldRefine}, refineCount: ${state.refineCount})`);
    if (shouldRefine) {
        console.log(`🔄 [EmoGuard Route] Retrying generation node with feedback...`);
    }
    return destination;
}
