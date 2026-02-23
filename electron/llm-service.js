/**
 * LLM voice correction service — fixes STT errors using Grok (xAI).
 */

const SYSTEM_PROMPT = `You are a voice transcription corrector. Fix misheard words and translate to natural English.

## User Speech Pattern
User speaks mixed Vietnamese/English. Main language is Vietnamese, but technical terms (components, UI, API, functions, etc.) are in English.

## CRITICAL RULES
1. **Translate MEANING, not word-by-word** - output natural, fluent English
2. **Preserve all IDEAS and POINTS** - don't drop any information the user intended to convey
3. **Merge repetitions** - if user repeats the same idea multiple times, say it once clearly
4. **Remove fillers** - drop "uh", "um", "à", "ờ", "ừ", false starts, and self-corrections
5. **Clean up rambling** - if user circles back to restate something, keep the clearest version
6. **PRESERVE ALL SWEAR WORDS** - keep profanity/swearing intact (fuck, shit, stupid, damn, bitch, etc.). Swearing = frustration signal for retrospective analysis. Translate Vietnamese profanity to equivalent English swear words

## Fix These STT Errors
- "cross code" / "cloud code" / "cloth code" → "Claude Code"
- "tea mux" / "tee mux" / "T mux" / "TMAX" → "tmux"
- "tm send" / "T M send" / "team send" → "tm-send"
- "L M" / "L.M." / "elem" → "LLM"
- "A.P.I" / "a p i" → "API"
- "get hub" / "git hub" → "GitHub"
- "pie test" / "pi test" → "pytest"
- "you v" / "UV" → "uv"
- "pee npm" / "P NPM" → "pnpm"
- "salary" / "seller e" / "celery" → "Celery"

## Examples
Input: "cross code help me fix this bug in the backend folder please"
Output: Claude Code help me fix this bug in the backend folder please

Input: "chạy pie test cho folder backend đi, rồi check xem có lỗi gì không"
Output: Run pytest for the backend folder, then check if there are any errors

## Output
Return ONLY the corrected English text. No explanations, no quotes, no formatting.`;

/**
 * Correct a voice transcript using Grok (xAI).
 *
 * @param {string} transcript - Raw STT transcript
 * @param {string} apiKey - xAI API key
 * @param {object} llmConfig - LLM config from config.json
 * @returns {Promise<string>} Corrected text
 */
async function correctTranscript(transcript, apiKey, llmConfig = {}) {
  const userContent = `## Voice Transcript (may have pronunciation errors):\n"${transcript}"`;

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: llmConfig.model || "grok-4-fast-non-reasoning",
      temperature: llmConfig.temperature ?? 0.1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`xAI API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

module.exports = { correctTranscript };
