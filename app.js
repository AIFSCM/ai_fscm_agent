require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// 🔐 Function to get OAuth token
async function getAccessToken() {
  const response = await axios.post(
    process.env.IDCS_TOKEN_URL,
    "grant_type=client_credentials",
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      auth: {
        username: process.env.CLIENT_ID,
        password: process.env.CLIENT_SECRET
      }
    }
  );

  return response.data.access_token;
}

// Test route
app.get("/", (req, res) => {
  res.send("Fusion AI Agent is running 🚀");
});

// Chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;

    const token = await getAccessToken();

    const response = await axios.post(
      `${process.env.FUSION_URL}/orchestrator/agent/v2/${process.env.AGENT_TEAM_ID}/invokeAsync`,
      {
        message: userMessage
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json(response.data);

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: "Error calling Fusion API" });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});