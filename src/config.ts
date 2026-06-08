import * as dotenv from "dotenv";
dotenv.config();

export const config = {
    useMockGroq: false,
    useMockMongo: false,
    groqApiKey: "",
    groqApiKeys: [] as string[],
    geminiApiKey: process.env.GEMINI_API_KEY ?? "",
    zepApiKey: process.env.ZEP_API_KEY ?? "",
    mongodbUri: "",
    port: parseInt(process.env.PORT ?? "8000"),
    nodeEnv: process.env.NODE_ENV ?? "development",
    groqModel: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
    routerModel: process.env.ROUTER_MODEL ?? "llama-3.1-8b-instant",
    emoguardModel: process.env.EMOGUARD_MODEL ?? "llama-3.1-8b-instant",
};

function getOptionalOrMock(key: string, mockValue: string, fallbackFlag: "useMockGroq" | "useMockMongo"): string {
    const val = process.env[key];
    if (!val) {
        console.warn(`\n⚠️  Missing env var: ${key}. Using in-memory mock/fallback for this service.`);
        config[fallbackFlag] = true;
        return mockValue;
    }
    return val;
}

config.groqApiKey = getOptionalOrMock("GROQ_API_KEY", "mock-groq-key", "useMockGroq");
config.mongodbUri = getOptionalOrMock("MONGODB_URI", "mongodb://localhost:27017/wellness_db_mock", "useMockMongo");

// Add serverSelectionTimeoutMS parameter to local connections to ensure fast fallback if Mongo is offline
if (config.mongodbUri.includes("localhost") || config.mongodbUri.includes("127.0.0.1")) {
    if (!config.mongodbUri.includes("?")) {
        config.mongodbUri += "?serverSelectionTimeoutMS=2000";
    } else if (!config.mongodbUri.includes("serverSelectionTimeoutMS")) {
        config.mongodbUri += "&serverSelectionTimeoutMS=2000";
    }
}

config.groqApiKeys = (process.env.GROQ_API_KEYS || config.groqApiKey || "")
    .split(",")
    .map(k => k.trim())
    .filter(Boolean)
    .filter(k => k !== "your_groq_api_key_here");

if (config.groqApiKeys.length === 0 && config.groqApiKey) {
    config.groqApiKeys = [config.groqApiKey];
}
