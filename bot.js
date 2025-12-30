import { Telegraf, Markup } from "telegraf";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = Number(process.env.ADMIN_ID);

const DATA_FILE = "./data.json";
const SUB_FILE = "./subscriber.json";

// ---------- helpers ----------
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

// ---------- start ----------
bot.start((ctx) => {
  ctx.reply("Добро пожаловать!\nИспользуй /subscribe");
});

// ---------- subscribe ----------
bot.command("subscribe", (ctx) => {
  const plans = read(DATA_FILE);
  if (!plans.length) return ctx.reply("Тарифов нет");

  const buttons = plans.map((p) =>
    Markup.button.callback(`${p.name} — ${p.price}₽`, `buy_${p.priceId}`)
  );

  ctx.reply("Выбери тариф:", Markup.inlineKeyboard(buttons));
});

// ---------- select plan ----------
bot.action(/buy_(.+)/, async (ctx) => {
  const priceId = ctx.match[1];
  const plans = read(DATA_FILE);
  const plan = plans.find((p) => p.priceId === priceId);
  if (!plan) return ctx.reply("Тариф не найден");

  const url =
    `${process.env.DOMAIN}/pay?price=${plan.price}` +
    `&user=${ctx.from.id}`;

  ctx.reply(
    `📦 ${plan.name}\n💰 ${plan.price}₽\n\n👉 Оплатить:\n${url}`
  );
});

// ---------- admin ----------
bot.command("admin", (ctx) => {
  if (ctx.chat.id !== ADMIN_ID) return;
  ctx.reply("/addplan <name> <price>");
  ctx.reply("/setprice <name> <newPrice>");
});

// ❗ НЕ ТРОНУТО ❗
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

bot.launch();
console.log("🤖 Bot started");
