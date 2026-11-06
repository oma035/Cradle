// Minimal Telegram Bot API client (no dependencies) with long polling.
export function makeTelegram(token) {
  const base = `https://api.telegram.org/bot${token}`;

  async function call(method, payload = {}) {
    const res = await fetch(`${base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
    return data.result;
  }

  return {
    call,
    send: (chatId, text, extra = {}) =>
      call("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra }),
    typing: (chatId) => call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {}),
    answerCallback: (id, text) => call("answerCallbackQuery", { callback_query_id: id, text }).catch(() => {}),
    clearButtons: (chatId, messageId) =>
      call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {}),

    /** Polls for updates forever and hands each one to `onUpdate`. */
    async poll(onUpdate) {
      let offset = 0;
      await call("deleteWebhook").catch(() => {});
      for (;;) {
        try {
          const updates = await call("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] });
          for (const u of updates) {
            offset = u.update_id + 1;
            onUpdate(u).catch((err) => console.error("[bot] update failed", err));
          }
        } catch (err) {
          console.error("[bot] polling error:", err.message);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    },
  };
}
