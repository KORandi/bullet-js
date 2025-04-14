/* eslint-disable @typescript-eslint/no-require-imports */
require("dotenv").config();
const { P2PServer } = require("p2p-server-sync");
const cors = require("cors");

const port = parseInt(process.env.PORT, 10) || 3000;
const dbPath = process.env.DB_PATH || "./radata";
const peers = process.env.PEERS ? process.env.PEERS.split(",") : [];

const p2p = new P2PServer({
  port,
  dbPath,
  peers,
  sync: {
    antiEntropyInterval: null, // Disabling auto antiEntropy
  },
});

const app = p2p.app;
app.use(cors());

// Create a card
app.post("/api/card", async (req, res) => {
  try {
    const { uid, balance } = req.body;

    if (!uid) {
      return res.status(400).json({ error: "UID is required" });
    }

    const existingCard = await p2p.get(`cards/${uid}`);
    if (existingCard) {
      return res
        .status(409)
        .json({ error: "Card with this UID already exists" });
    }

    const newCard = {
      uid,
      balance: balance || 0, // Default balance to 0 if not provided
      createdAt: Date.now(),
    };

    await p2p.put(`cards/${uid}`, newCard);
    res.status(201).json(newCard);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all cards
app.get("/api/card", async (req, res) => {
  try {
    const cards = await p2p.scan("cards");
    res.json(cards);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a card by UID
app.get("/api/card/:uid", async (req, res) => {
  const uid = req.params.uid;

  if (!uid) {
    return res.status(400).json({ error: "UID is required" });
  }

  try {
    const card = await p2p.get(`cards/${uid}`);
    if (!card) {
      return res.status(404).json({ error: "Card not found" });
    }
    res.json(card);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a card
app.put("/api/card/:uid", async (req, res) => {
  try {
    const { balance } = req.body;
    const uid = req.params.uid;

    if (!uid || (!Number.isInteger(balance) && !isNaN(balance))) {
      return res.status(400).json({ error: "UID and balance is required" });
    }

    // Check if card exists
    let card;
    try {
      card = await p2p.get(`cards/${uid}`);
      if (!card) {
        return res.status(404).json({ error: "Card not found" });
      }
    } catch (error) {
      return res.status(404).json({ message: "Card not found", error });
    }

    // Update card
    const updatedCard = {
      ...card,
      balance: balance !== undefined ? balance : card.balance,
      updatedAt: Date.now(),
    };

    await p2p.put(`cards/${uid}`, updatedCard);
    res.json(updatedCard);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a card
app.delete("/api/card/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;

    if (!uid) {
      return res.status(400).json({ error: "UID is required" });
    }

    // Check if card exists
    try {
      const card = await p2p.get(`cards/${uid}`);
      if (!card) {
        return res.status(404).json({ error: "Card not found" });
      }
    } catch (error) {
      return res.status(404).json({ message: "Card not found", error });
    }

    await p2p.del(uid);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// After load we listen to socket to "identify" and then we synch our data
(async () => {
  await p2p.start();
  p2p.socketManager.io.on("connection", (socket) => {
    socket.on("identify", () => {
      p2p.runAntiEntropy();
    });
  });
})();
