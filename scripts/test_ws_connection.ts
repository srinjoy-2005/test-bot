import WebSocket from "ws";

async function testWebSocket() {
    console.log("Connecting to ws://localhost:8001/chat...");
    const ws = new WebSocket("ws://localhost:8001/chat");

    ws.on("open", () => {
        console.log("Connected! Sending init message...");
        ws.send(JSON.stringify({
            type: "init",
            userId: "test-user-123",
            userName: "Srinjoy",
            sessionId: "test-session-123"
        }));
    });

    ws.on("message", (data) => {
        const parsed = JSON.parse(data.toString());
        console.log("\nReceived message:", JSON.stringify(parsed, null, 2));

        if (parsed.type === "ready") {
            console.log("Session is ready! Sending chat message: 'I feel stressed today'");
            ws.send(JSON.stringify({
                type: "chat",
                message: "I feel stressed today",
                sessionId: "test-session-123"
            }));
        } else if (parsed.type === "response") {
            console.log("\nSuccessfully received AI response! Chat flow is working perfectly!");
            ws.close();
            process.exit(0);
        } else if (parsed.type === "error") {
            console.error("Received error message from server!");
            ws.close();
            process.exit(1);
        }
    });

    ws.on("error", (err) => {
        console.error("WebSocket Error:", err);
    });

    // Timeout after 10s
    setTimeout(() => {
        console.error("Test timed out!");
        ws.close();
        process.exit(1);
    }, 10000);
}

testWebSocket();
