// Deterministic danger-sign screen that runs BEFORE the AI. If anything matches,
// Cradle does not try to answer; it tells her to get care immediately.
// Based on widely used pregnancy danger signs (e.g. WHO/ANC guidance). Extend with local terms.

const RULES = [
  { sign: "vaginal bleeding", re: /\b(bleed(ing)?|bloody|blood(?!\s*(pressure|test|tests|sugar|group|type|count|work|level|levels|tonic))|spotting heavily|haemorrhag\w*|hemorrhag\w*)\b/i },
  { sign: "severe headache or vision problems", re: /\b(severe|bad|terrible|worst|pounding)\s+(head\s?ache|migraine)|blur(red|ry)?\s+vision|seeing (spots|stars|flashes)|can'?t see/i },
  { sign: "fits or convulsions", re: /\b(convuls\w*|seizures?|having (a )?fits?|had (a )?fits?|fitting|uncontrolled jerking)\b/i },
  { sign: "fainting or loss of consciousness", re: /\b(faint(ed|ing)?|passed out|unconscious|collapse)/i },
  { sign: "severe abdominal pain", re: /\b(severe|sharp|terrible|unbearable|intense)\s+(abdominal |belly |stomach |tummy )?(pain|cramp)/i },
  { sign: "high fever", re: /\b(high fever|fever|very hot body|chills and shiver)/i },
  { sign: "difficulty breathing or chest pain", re: /\b(can'?t breathe|difficulty breathing|short(ness)? of breath|chest pain|breathless)/i },
  { sign: "baby moving less or not at all", re: /\b(baby|fetus|foetus)\b.*\b(not moving|stopped moving|moving less|no movement|isn'?t moving|hasn'?t moved)|\b(reduced|less|no) (fetal |foetal )?movements?\b/i },
  { sign: "waters breaking early", re: /\b(water(s)? (broke|break|breaking)|leaking fluid|gush of (water|fluid))/i },
  { sign: "sudden swelling of face or hands", re: /\b(face|hands?|eyes?)\b.*\b(swell|swollen|puffy)|\b(swell|swollen|puffy)\b.*\b(face|hands?)\b/i },
  { sign: "thoughts of harming herself or the baby", re: /\b(kill (myself|me)|end my life|suicid|hurt (myself|the baby|my baby)|harm (myself|the baby|my baby)|don'?t want to live)/i },
];

/** Returns the list of matched danger signs (empty if none). */
export function screenRedFlags(text) {
  const t = String(text || "");
  return RULES.filter((r) => r.re.test(t)).map((r) => r.sign);
}

export function emergencyMessage(signs) {
  const which = signs.length ? `You mentioned: <b>${signs.join(", ")}</b>.\n\n` : "";
  const mental = signs.some((s) => s.startsWith("thoughts of harming"));
  return (
    "🚨 <b>Please get medical help now.</b>\n\n" +
    which +
    "This can be a danger sign in pregnancy. Go to the nearest hospital or clinic immediately, " +
    "or call your local emergency number. If you can, ask someone to go with you.\n\n" +
    (mental
      ? "You don't have to face this alone. Please also talk to someone you trust or a local crisis line right now.\n\n"
      : "") +
    "Cradle will not try to answer this one. Your safety comes first. ❤️"
  );
}
