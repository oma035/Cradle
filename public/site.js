// Fills in live values (bot link, price) on public pages.
(async () => {
  try {
    const c = await (await fetch("/api/public/config")).json();
    document.querySelectorAll(".bot-link").forEach((a) => (a.href = c.botUrl));
    document.querySelectorAll(".price").forEach((el) => (el.textContent = `$${Number(c.price).toFixed(2)}`));
    document.querySelectorAll(".share").forEach((el) => (el.textContent = `$${Number(c.expertShare).toFixed(2)}`));
    document.querySelectorAll(".net").forEach((el) => (el.textContent = c.network === "mainnet" ? "Live on Stellar" : "Stellar testnet"));
  } catch { /* keep defaults */ }
})();
