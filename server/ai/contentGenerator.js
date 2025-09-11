const { Groq } = require("groq-sdk");
const { contentGeneratorPrompt } = require("./prompts");

// Configurable model
const MODEL_NAME = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

/**
 * baseAi
 * @param {Object} inputs
 * @param {string} inputs.chosen_topic - e.g., "Branding"
 * @param {string} inputs.chosen_color_scheme - e.g., "Complementary"
 * @returns {Promise<Object>} Parsed JSON object from Groq
 */

// content generator
const contentGenerator = async (inputs = {}) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY environment variable");
  }

  const groq = new Groq({ apiKey });

  const chosen_topic = inputs.chosen_topic || "Branding";
  const chosen_color_scheme = inputs.chosen_color_scheme || "Complementary";

  const finalPrompt = `${contentGeneratorPrompt}

chosen_topic: ${chosen_topic}
chosen_color_scheme: ${chosen_color_scheme}
`;

  try {
    const response = await groq.chat.completions.create({
      model: MODEL_NAME,
      messages: [{ role: "user", content: finalPrompt }],
      temperature: 0.4,
      max_tokens: 2048,
      top_p: 1,
      stream: false,
    });

    let raw = response?.choices?.[0]?.message?.content ?? "";

    raw = raw.trim();
    if (raw.startsWith("```")) {
      raw = raw
        .replace(/^```[\s\S]*?\n/, "")
        .replace(/```$/, "")
        .trim();
    }

    const jsonBlockMatch = raw.match(/{[\s\S]*}/);
    const jsonText = jsonBlockMatch ? jsonBlockMatch[0] : raw;

    try {
      const parsed = JSON.parse(jsonText);

      if (
        parsed?.slides?.palettes &&
        Array.isArray(parsed.slides.palettes) &&
        parsed.slides.palettes.length > 5
      ) {
        parsed.slides.palettes = parsed.slides.palettes.slice(0, 5);
      }

      return parsed;
    } catch (parseErr) {
      return {
        ok: false,
        reason: "invalid_json_from_model",
        message: "Failed to parse model output as JSON.",
        raw: raw.slice(0, 5000),
      };
    }
  } catch (err) {
    console.error("Groq API Error:", err.response?.data || err);
    throw new Error(`callGroqAPI failed: ${err.message}`);
  }
};

module.exports = contentGenerator;
