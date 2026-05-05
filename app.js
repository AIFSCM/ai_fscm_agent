require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.send("Fusion AI Agent is running 🚀");
});

// Chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const message = req.body.message;

    // Validate input
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const response = await axios.post(
      `${process.env.FUSION_URL}/orchestrator/agent/v2/${process.env.AGENT_TEAM_ID}/invokeAsync`,
      {
        message: message   // ✅ fixed here
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json(response.data);

  } catch (error) {
    console.error("ERROR:", error.response?.data || error.message);

    res.status(500).json({
      error: error.response?.data || "Something went wrong"
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// JSON error handler
app.use((err, req, res, next) => {
  console.error("Invalid JSON:", err.message);
  res.status(400).json({ error: "Invalid JSON format" });
});