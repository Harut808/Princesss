import express from "express";
import Stripe from "stripe";
import fs from "fs";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { Telegraf } from "telegraf";

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const bot = new Telegraf(process.env.BOT_TOKEN);

const SUB_FILE = "./subscriber.json";

// ❌ НЕ ставим raw глобально
// app.use(bodyParser.raw({ type: "application/json" }));

// ---------- create payment ----------
app.get("/pay", async (req, res) => {
  const { price, user } = req.query;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "rub",
          product_data: { name: "Telegram Subscription" },
          unit_amount: price * 100,
        },
        quantity: 1,
      },
    ],
    metadata: { user },
    success_url: `${process.env.DOMAIN}/success`,
    cancel_url: `${process.env.DOMAIN}/cancel`,
  });

  res.redirect(session.url);
});

// ---------- STRIPE WEBHOOK (ТОЛЬКО ТУТ raw) ----------
app.post(
  "/stripe/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log("❌ Webhook error:", err.message);
      return res.sendStatus(400);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.metadata.user;

      const link = await bot.telegram.createChatInviteLink(
        process.env.CHANNEL_ID,
        { member_limit: 1 }
      );

      await bot.telegram.sendMessage(
        userId,
        `✅ Оплата прошла!\n\n🔗 Одноразовая ссылка:\n${link.invite_link}\n\n⚠️ Работает 1 раз`
      );

      const subs = fs.existsSync(SUB_FILE)
        ? JSON.parse(fs.readFileSync(SUB_FILE))
        : [];

      subs.push({ userId, date: Date.now() });
      fs.writeFileSync(SUB_FILE, JSON.stringify(subs, null, 2));
    }

    res.json({ received: true });
  }
);

app.listen(process.env.PORT || 3000, () => {
  console.log("🌍 Server started");
});
