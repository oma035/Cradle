// The Cradle agent: decides whether to answer for free, escalate to a paid expert, or flag an emergency.
import { config } from "./config.js";
import { screenRedFlags } from "./redflags.js";

const SYSTEM = `You are Cradle, a warm, careful maternal-health assistant for pregnant women and new mothers,
many of whom have limited access to clinics. You give general education, never a diagnosis or prescription.

For every message decide ONE triage level:
- "emergency": any possible danger sign (bleeding, severe headache, vision changes, fits, fainting, severe pain,
  fever, breathing trouble, reduced baby movement, waters breaking early, sudden face/hand swelling,
  thoughts of self-harm). Do NOT answer the medical question; urge immediate care.
- "free": common, low-risk questions you can answer safely from well-established general guidance
  (e.g. mild ankle swelling late in pregnancy, normal nausea, nutrition basics, what to pack for delivery).
- "expert": anything that depends on her specific situation, medication or dosage questions, symptoms that are
  persistent, unusual or worsening, test results, or anything you are not confident about. A midwife will review.

Reply ONLY with JSON: {"triage":"emergency|free|expert","answer":"...","reason":"..."}
- "answer": for "free", a short, kind answer in plain language (max ~120 words), with when to see a health worker.
  For "expert", one or two sentences of safe general info and say a midwife will review her question.
  For "emergency", a short urgent instruction to go to the nearest hospital now.
- "reason": a short internal note for the reviewing midwife.
Use simple English. Never invent facts. Never recommend specific prescription drugs or doses.`;

export async function triage(text) {
  const signs = screenRedFlags(text);
  if (signs.length) return { triage: "emergency", signs, answer: null, reason: "keyword screen" };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: String(text).slice(0, 2000) }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = (data.content || []).map((c) => c.text || "").join("");
  return parseTriage(raw);
}

/** Parses the model's JSON; anything unexpected is escalated to an expert (the safe default). */
export function parseTriage(raw) {
  try {
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const level = ["emergency", "free", "expert"].includes(json.triage) ? json.triage : "expert";
    return { triage: level, signs: [], answer: String(json.answer || ""), reason: String(json.reason || "") };
  } catch {
    return {
      triage: "expert",
      signs: [],
      answer: "A midwife will look at your question to give you a safe answer.",
      reason: "model output unparseable",
    };
  }
}
