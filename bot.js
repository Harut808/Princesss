import express from "express";
import Stripe from "stripe";
import fs from "fs";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { Telegraf, Markup } from "telegraf";

dotenv.config();

/* ================== INIT ================== */
const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const bot = new Telegraf(process.env.BOT_TOKEN);

const ADMIN_ID = Number(process.env.ADMIN_ID);
const DATA_FILE = "./data.json";
const SUB_FILE = "./subscriber.json";

/* ================== HELPERS ================== */
const read = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
};

const write = (file, data) => {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ================== EXPRESS ================== */
app.use((req, res, next) => {
  if (req.originalUrl === "/stripe/webhook") {
    next();
  } else {
    express.json()(req, res, next);
  }
});

app.get("/", (req, res) => {
  res.send("✅ Server is running");
});

/* ---------- CREATE PAYMENT ---------- */
app.get("/pay", async (req, res) => {
  const { price, user } = req.query;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "rub",
            product_data: { name: "Telegram Subscription" },
            unit_amount: Number(price) * 100,
          },
          quantity: 1,
        },
      ],
      metadata: { user },
      success_url: `${process.env.DOMAIN}/success`,
      cancel_url: `${process.env.DOMAIN}/cancel`,
    });

    res.redirect(session.url);
  } catch (e) {
    console.log("❌ PAY ERROR:", e.message);
    res.sendStatus(500);
  }
});

/* ---------- STRIPE WEBHOOK ---------- */
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
      console.log("❌ WEBHOOK ERROR:", err.message);
      return res.sendStatus(400);
    }

    console.log("🔥 WEBHOOK:", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.metadata.user;
      console.log("👤 USER ID:", userId);

      try {
        const link = await bot.telegram.createChatInviteLink(
          process.env.CHANNEL_ID,
          { member_limit: 1 }
        );

        await delay(2000); // задержка 2 секунды

        await bot.telegram.sendMessage(
          userId,
          `✅ Оплата прошла!\n\n🔗 Одноразовая ссылка:\n${link.invite_link}\n\n⚠️ Работает 1 раз`
        );
        console.log("✅ Ссылка отправлена пользователю");

        const subs = read(SUB_FILE);
        subs.push({ userId, date: Date.now() });
        write(SUB_FILE, subs);
      } catch (e) {
        console.log("❌ TELEGRAM ERROR:", e.message);
      }
    }

    res.json({ received: true });
  }
);

/* ================== BOT COMMANDS ================== */
bot.start((ctx) => {
  ctx.reply("Добро пожаловать!\nИспользуй /subscribe");
});

bot.command("subscribe", (ctx) => {
  const plans = read(DATA_FILE);
  if (!plans.length) return ctx.reply("Тарифов нет");

  const buttons = plans.map((p) =>
    Markup.button.callback(`${p.name} — ${p.price}₽`, `buy_${p.priceId}`)
  );

  ctx.reply("Выбери тариф:", Markup.inlineKeyboard(buttons));
});

bot.action(/buy_(.+)/, async (ctx) => {
  const priceId = ctx.match[1];
  const plans = read(DATA_FILE);
  const plan = plans.find((p) => p.priceId === priceId);
  if (!plan) return ctx.reply("Тариф не найден");

  const url = `${process.env.DOMAIN}/pay?price=${plan.price}&user=${ctx.from.id}`;
  ctx.reply(`📦 ${plan.name}\n💰 ${plan.price}₽\n\n👉 Оплатить:\n${url}`);
});

bot.command("admin", (ctx) => {
  if (ctx.chat.id !== ADMIN_ID) return;
  ctx.reply("/addplan <name> <price>");
  ctx.reply("/setprice <name> <newPrice>");
});

bot.on("text", async (ctx) => {
  const arr = ctx.message.text.split(" ");

  if (arr[0] === "/setprice") {
    if (ctx.chat.id !== ADMIN_ID) return;

    const name = arr[1];
    const newPrice = Number(arr[2]);
    if (isNaN(newPrice)) return ctx.reply("Неверная цена");

    const plans = read(DATA_FILE);
    const plan = plans.find((p) => p.name === name);
    if (!plan) return ctx.reply("Тариф не найден");

    plan.price = newPrice;
    write(DATA_FILE, plans);
    ctx.reply("Цена обновлена");
  }

  if (arr[0] === "/addplan") {
    if (ctx.chat.id !== ADMIN_ID) return;

    const name = arr[1];
    const price = Number(arr[2]);
    if (!name || isNaN(price)) return ctx.reply("Формат: /addplan name price");

    const plans = read(DATA_FILE);
    plans.push({
      name,
      price,
      priceId: "plan_" + Date.now(),
    });

    write(DATA_FILE, plans);
    ctx.reply("Тариф добавлен");
  }
});

/* ================== START ================== */
const PORT = process.env.PORT || 3000;

bot.launch({
  webhook: {
    domain: process.env.DOMAIN,
    port: PORT,
    hookPath: `/bot${process.env.BOT_TOKEN}`,
  },
});

// Express сервер на том же порту
app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
