const { Bot } = require('grammy');

const bot = new Bot(process.env.BOT_TOKEN);
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.AI_MODEL || 'gemini-flash-latest';

const SYSTEM =
  "Sen Telegram'dagi foydali AI yordamchisan. Foydalanuvchi qaysi tilda yozsa, shu tilda " +
  "(asosan o'zbek tilida) aniq va tushunarli javob ber. Javoblarni ortiqcha cho'zma.";

const MAX_HISTORY = 12; // oxirgi nechta xabar eslab qolinadi
const history = new Map(); // chatId -> xabarlar
const busy = new Set(); // bir vaqtda bitta so'rov

async function askAI(chatId, text) {
  const h = [...(history.get(chatId) || [])];
  h.push({ role: 'user', parts: [{ text }] });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: h,
      }),
    }
  );
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);

  const data = await res.json();
  const answer = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!answer) throw new Error("Bo'sh javob: " + JSON.stringify(data).slice(0, 300));

  h.push({ role: 'model', parts: [{ text: answer }] });
  history.set(chatId, h.slice(-MAX_HISTORY));
  return answer;
}

async function sendLong(ctx, text) {
  for (let i = 0; i < text.length; i += 4000) {
    await ctx.reply(text.slice(i, i + 4000));
  }
}

bot.command('start', (ctx) =>
  ctx.reply("Salom! Men AI yordamchiman. Istalgan savolingizni yozing.\n\n/new - suhbatni yangidan boshlash")
);

bot.command('new', (ctx) => {
  history.delete(ctx.chat.id);
  return ctx.reply('Suhbat tozalandi. Yangi savol bering.');
});

bot.on('message:text', async (ctx) => {
  const id = ctx.chat.id;
  if (busy.has(id)) return ctx.reply('Oldingi savolingizga javob tayyorlanyapti, biroz kuting...');

  busy.add(id);
  const typing = setInterval(() => ctx.replyWithChatAction('typing').catch(() => {}), 4000);
  ctx.replyWithChatAction('typing').catch(() => {});

  try {
    const answer = await askAI(id, ctx.message.text);
    await sendLong(ctx, answer);
  } catch (e) {
    console.error(e.message);
    await ctx.reply("Xatolik yuz berdi. Birozdan keyin qayta urinib ko'ring.");
  } finally {
    clearInterval(typing);
    busy.delete(id);
  }
});

bot.on('message', (ctx) => ctx.reply('Hozircha faqat matnli xabarlarga javob bera olaman.'));

// Render uchun: web service port ochib turishi kerak
require('node:http')
  .createServer((_req, res) => res.end('OK'))
  .listen(process.env.PORT || 3000);

bot.catch((err) => console.error('Bot xatosi:', err.message));
bot.start();
console.log('AI bot ishga tushdi');
