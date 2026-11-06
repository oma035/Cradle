// The paid "expert review" endpoint, protected by x402. Payments settle in USDC into the Cradle treasury (escrow).
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { config } from "./config.js";
import { treasury } from "./stellar.js";

export const REVIEW_ROUTE = "/api/reviews";

export function x402Router(db) {
  const auth = { Authorization: `Bearer ${config.ozApiKey}` };
  const facilitator = new HTTPFacilitatorClient({
    url: config.facilitatorUrl,
    createAuthHeaders: async () => ({ verify: auth, settle: auth, supported: auth }),
  });
  const resourceServer = new x402ResourceServer(facilitator).register(
    config.x402Network,
    new ExactStellarScheme()
  );

  const router = express.Router();
  router.use(REVIEW_ROUTE, express.json({ limit: "16kb" }));
  router.use(
    paymentMiddleware(
      {
        [`POST ${REVIEW_ROUTE}`]: {
          accepts: [
            {
              scheme: "exact",
              price: `$${config.reviewPriceUsd}`,
              network: config.x402Network,
              payTo: treasury().publicKey(),
            },
          ],
          description: "Cradle: a verified midwife reviews one maternal-health question",
          mimeType: "application/json",
        },
      },
      resourceServer
    )
  );

  // Only reached after the payment has been verified. The middleware settles it on Stellar
  // before the response leaves the server; the settlement tx comes back in the PAYMENT-RESPONSE header.
  router.post(REVIEW_ROUTE, (req, res) => {
    const { questionId, nonce } = req.body || {};
    const q = db.question(Number(questionId));
    if (!q || q.pay_nonce !== nonce || q.status !== "paying") {
      return res.status(409).json({ error: "This question is not awaiting payment" });
    }
    res.json({ ok: true, ticket: `CRD-${q.id}`, message: "Queued for midwife review" });
  });

  return router;
}
