require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const fs = require("fs");
const OpenAI = require("openai");

const app = express();
const port = process.env.PORT || 3006;

// Initialize DeepSeek client
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com/v1",
});

// Store conversations in memory (you might want to use a database in production)
const conversations = new Map();

// Middleware to parse JSON payloads
app.use(bodyParser.json());

// Function to send message via WATI API
async function sendWhatsAppMessage(whatsappNumber, message) {
  try {
    const url = `${
      process.env.WATI_BASE_URL
    }/api/v1/sendSessionMessage/${whatsappNumber}?messageText=${encodeURIComponent(
      message
    )}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WATI_AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Message sent successfully:", data);
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
  }
}

// Handle function calls from the AI
async function handleFunctionCall(functionCall) {
  const functionName = functionCall.name;
  const args = JSON.parse(functionCall.arguments);

  switch (functionName) {
    case "get_zostel_locations":
      return await getZostelLocations(args.location);
    case "check_availability":
      return await checkAvailability(
        args.location,
        args.checkIn,
        args.checkOut
      );
    default:
      throw new Error(`Unknown function: ${functionName}`);
  }
}

// Webhook endpoint
app.post("/zostel-whatsapp/wati-webhook", async (req, res) => {
  // console.log("Message received:", req.body);

  const { waId, text, conversationId, type } = req.body;

  // Only respond to messages from the specified numbers
  if (!process.env.WHATSAPP_NUMBERS.includes(waId) || type !== "text") {
    return res.status(200).send("Message ignored");
  }

  try {
    const prompt = fs.readFileSync("./zostel-prompt.md", "utf-8");
    // Get or initialize conversation history
    if (!conversations.has(conversationId)) {
      conversations.set(conversationId, [{ role: "system", content: prompt }]);
    }
    const messages = conversations.get(conversationId);

    // Add user message to history
    messages.push({ role: "user", content: text });

    // Get response from DeepSeek with proper parameters
    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: messages,
      temperature: 0.7,
      max_tokens: 2000,
      top_p: 0.95,
      frequency_penalty: 0,
      presence_penalty: 0,
    });

    const assistantMessage = response.choices[0].message;

    messages.push(assistantMessage);

    // Limit conversation history to last 10 messages to prevent token limit issues
    if (messages.length > 11) {
      // 1 system message + 10 conversation messages
      messages.splice(1, messages.length - 11);
    }

    // Send response back to user via WATI
    await sendWhatsAppMessage(waId, assistantMessage.content);

    // Send response back to WATI webhook
    res.status(200).send("Message processed successfully");
  } catch (error) {
    console.error("Error processing message:", error);
    if (error.response) {
      console.error("API Error:", error.response.data);
    }
    res.status(500).send("Error processing message");
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
