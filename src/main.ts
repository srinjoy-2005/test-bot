import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import path from "path";
import { config } from "./config";
import "./utils/mockSetup";
import { chatHandler } from "./api/chat";
import { sessionRouter } from "./api/session";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/chat" });

// Middleware
app.use(cors());
app.use(express.json());

// REST routes
app.use("/session", sessionRouter);
app.get("/health", (_req, res) => {
    res.json({ status: "ok", model: config.groqModel, env: config.nodeEnv });
});

// Serve frontend
app.use(express.static(path.join(__dirname, "../frontend")));
app.get("*", (_req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// WebSocket chat
wss.on("connection", chatHandler);

server.listen(config.port, () => {
    console.log(`\n🧠 Wellness AI running at http://localhost:${config.port}`);
    console.log(`   WebSocket: ws://localhost:${config.port}/chat`);
    console.log(`   Model: ${config.groqModel} via Groq\n`);
});

// --- Graceful Shutdown Handler ---
const gracefulShutdown = () => {
    console.log("\n🛑 Shutting down server and releasing port...");
    
    // Close the WebSocket server
    wss.close();
    
    // Close the HTTP server
    server.close(() => {
        console.log("✅ Port released. Exiting.");
        process.exit(0); // Force exit (kills dangling MongoDB connections)
    });

    // Fallback: forcefully kill after 2 seconds if something hangs
    setTimeout(() => {
        console.log("⚠️ Forced exit.");
        process.exit(1);
    }, 2000);
};

// Catch Ctrl+C (SIGINT) and kill commands (SIGTERM)
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);