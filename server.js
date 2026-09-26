/**
 * Portable — Context Extraction Server (Render version)
 *
 * Holds your Anthropic API key server-side and proxies extraction
 * requests from the frontend, so the key never appears in client code.
 *
 * DEPLOY ON RENDER:
 * 1. Push this folder (server.js + package.json) to a new GitHub repo.
 * 2. On render.com: New -> Web Service -> connect that repo.
 * 3. Build command: npm install   |   Start command: node server.js
 * 4. In the service's Environment tab, add GROQ_API_KEY as a secret.
 * 5. Deploy. Copy the given URL (e.g. https://xxx.onrender.com) into
 *    WORKER_URL near the top of index.html's <script>, then republish.
 */

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const SYSTEM_PROMPT = `You extract a structured "context package" from a pasted AI conversation transcript. The goal is to let someone continue the work in a different AI tool without re-reading the whole conversation.

Do not summarize the conversation chronologically. Extract these fields based on their MEANING, not on matching keywords or headers in the text — ignore section headers, numbered instructions, or meta-text that isn't actually part of the conversation's substance:

- goal: what the user is actually trying to accomplish (1-2 sentences)
- currentState: where the work stands right now (1-2 sentences)
- decisions: array of concrete decisions that were made (e.g. "use Redis for the token bucket")
- requirements: array of constraints or requirements stated by the user
- completed: array of things that were actually finished/built
- currentProblem: array of active blockers or open problems (empty array if none)
- nextSteps: array of concrete next actions
- technicalDetails: array of specific technical facts worth preserving (library names, config, versions, endpoints)
- relevantContext: one sentence of any other context worth keeping

Respond with ONLY a JSON object with exactly these keys (all arrays, except goal/currentState/relevantContext which are strings). No markdown fences, no preamble, no explanation. If a field has nothing to report, use an empty array (or a short "Not specified" string for the string fields).`;

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Portable extraction server is running." });
});

app.post("/", async (req, res) => {
  const { title, source, transcript } = req.body || {};

  if (!transcript || typeof transcript !== "string") {
    return res.status(400).json({ error: "Missing 'transcript' string" });
  }
  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "Server misconfigured: GROQ_API_KEY not set" });
  }

  const userMsg = `Title: ${title || "Untitled"}\nSource AI: ${source || "Unknown"}\n\nTranscript:\n${transcript.slice(0, 20000)}`;

  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(502).json({ error: "Upstream API error", detail: errText });
    }

    const data = await resp.json();
    const raw = (data.choices?.[0]?.message?.content || "").trim();
    const cleaned = raw.replace(/^```json\s*|```$/g, "").trim();

    let pkg;
    try {
      pkg = JSON.parse(cleaned);
    } catch (e) {
      return res.status(502).json({ error: "Model did not return valid JSON", raw: cleaned });
    }

    res.json({ pkg });
  } catch (e) {
    res.status(500).json({ error: "Extraction failed", detail: String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Portable extraction server listening on port ${PORT}`));
  
