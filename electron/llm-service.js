/**
 * LLM voice correction service — fixes STT errors using Grok (xAI).
 */

const STT_FIXES = `## Fix These STT Errors
- "cross code" / "cloud code" / "cloth code" → "Claude Code"
- "tea mux" / "tee mux" / "T mux" / "TMAX" → "tmux"
- "tm send" / "T M send" / "team send" → "tm-send"
- "L M" / "L.M." / "elem" → "LLM"
- "A.P.I" / "a p i" → "API"
- "get hub" / "git hub" → "GitHub"
- "pie test" / "pi test" → "pytest"
- "you v" / "UV" → "uv"
- "pee npm" / "P NPM" → "pnpm"
- "salary" / "seller e" / "celery" → "Celery"`;

const COMMON_RULES = `## CRITICAL RULES
1. **Preserve all IDEAS and POINTS** - don't drop any information the user intended to convey
2. **Merge repetitions** - if user repeats the same idea multiple times, say it once clearly
3. **Remove fillers** - drop "uh", "um", "à", "ờ", "ừ", false starts, and self-corrections
4. **Clean up rambling** - if user circles back to restate something, keep the clearest version
5. **PRESERVE ALL SWEAR WORDS** - keep profanity/swearing intact. Swearing = frustration signal for retrospective analysis`;

const PROMPTS = {
  english: `You are a voice transcription corrector. Fix misheard words and translate to natural English.

## User Speech Pattern
User speaks mixed Vietnamese/English. Main language is Vietnamese, but technical terms are in English.

${COMMON_RULES}
6. **Translate MEANING, not word-by-word** - output natural, fluent English
7. Translate Vietnamese profanity to equivalent English swear words

${STT_FIXES}

## Output
ALWAYS output in English. Translate everything to English.
Return ONLY the corrected text. No explanations, no quotes, no formatting.`,

  vietnamese: `You are a voice transcription corrector. Fix misheard words and output in Vietnamese.

## User Speech Pattern
User speaks mixed Vietnamese/English. Keep technical terms in English but output prose in Vietnamese.

${COMMON_RULES}
6. **Output in Vietnamese** - translate English prose to Vietnamese, but keep technical terms (API, GitHub, pytest, tmux, etc.) in English
7. Keep Vietnamese profanity as-is

${STT_FIXES}

## Output
Output in Vietnamese. Keep technical terms in English.
Return ONLY the corrected text. No explanations, no quotes, no formatting.`,

  auto: `You are a voice transcription corrector. Fix misheard words and preserve the original language.

## User Speech Pattern
User speaks mixed Vietnamese/English. Sometimes mostly Vietnamese, sometimes mostly English, sometimes a mix.

${COMMON_RULES}
6. **Preserve the original language mix** - if the user spoke Vietnamese, output Vietnamese. If English, output English. If mixed, output mixed. Match what the user actually said.
7. Keep profanity in whatever language it was spoken

${STT_FIXES}

## Output
Match the language of the input. Do NOT translate — preserve the original language.
Return ONLY the corrected text. No explanations, no quotes, no formatting.`,
};

/**
 * Correct a voice transcript using Grok (xAI).
 *
 * @param {string} transcript - Raw STT transcript
 * @param {string} apiKey - xAI API key
 * @param {object} llmConfig - LLM config from config.json
 * @param {string} [outputLang="auto"] - Output language: "auto", "english", "vietnamese"
 * @returns {Promise<string>} Corrected text
 */
async function correctTranscript(transcript, apiKey, llmConfig = {}, outputLang = "auto") {
  const systemPrompt = PROMPTS[outputLang] || PROMPTS.auto;
  const userContent = `## Voice Transcript (may have pronunciation errors):\n"${transcript}"`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  let response;
  try {
    response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: llmConfig.model || "grok-4-1-fast-non-reasoning",
        temperature: llmConfig.temperature ?? 0.1,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("xAI request timed out after 15 seconds");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`xAI API error (${response.status}): ${err}`);
  }

  const data = await response.json();

  // Validate response shape before dereferencing nested fields
  if (
    !data ||
    !Array.isArray(data.choices) ||
    data.choices.length === 0 ||
    !data.choices[0] ||
    typeof data.choices[0].message !== "object" ||
    typeof data.choices[0].message.content !== "string"
  ) {
    throw new Error("xAI response shape unexpected — could not extract corrected text");
  }

  return data.choices[0].message.content.trim();
}

module.exports = { correctTranscript };
