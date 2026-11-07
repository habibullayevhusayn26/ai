const { Bot } = require('grammy');

const bot = new Bot(process.env.BOT_TOKEN);
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.AI_MODEL || 'gemini-flash-latest';

const SYSTEM =
  "Sen Husayn nomidan mijozlarga javob beradigan AI yordamchisan. Husayn Telegram emojilar, saytlar, " +
  "Telegram botlar va foto xizmatlarini ko'rsatadi. " +
  "Ism so'ralsa: egasining ismi Husayn ekanini va sen uning AI yordamchisi ekaningni ayt. " +
  "Telefon raqami so'ralsa: 90 848 17 28. " +
  "Xizmatlari so'ralsa: Telegram kanali @projects_28. " +
  "Sayti so'ralsa: habibullayev.uz. " +
  "Bu ma'lumotlarni faqat so'ralganda ber. Narx va muddatni o'zing o'ylab topma, buni Husayn o'zi aytishini ayt. " +
  "Foydalanuvchi qaysi tilda yozsa, shu tilda (asosan o'zbek tilida) qisqa, muloyim va aniq javob ber.";

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

// Telegram Business: mijozlar yozgan xabarlarga akkaunt egasi nomidan javob
const owners = new Map(); // connectionId -> akkaunt egasi ID si
async function ownerOf(ctx) {
  const cid = ctx.businessConnectionId;
  if (!owners.has(cid)) {
    const conn = await ctx.api.getBusinessConnection(cid);
    owners.set(cid, conn.user.id);
  }
  return owners.get(cid);
}

bot.on('business_message:text', async (ctx) => {
  try {
    if (ctx.from.id === (await ownerOf(ctx))) return; // egasi o'zi yozgan xabarga javob bermaymiz
  } catch (e) {
    console.error('Business connection xatosi:', e.message);
    return;
  }

  const id = 'b' + ctx.chat.id;
  if (busy.has(id)) return;
  busy.add(id);
  ctx.replyWithChatAction('typing').catch(() => {});

  try {
    const answer = await askAI(id, ctx.message.text);
    await sendLong(ctx, answer);
  } catch (e) {
    console.error(e.message);
  } finally {
    busy.delete(id);
  }
});

bot.on('message', (ctx) => ctx.reply('Hozircha faqat matnli xabarlarga javob bera olaman.'));

// Render uchun: web service port ochib turishi kerak
require('node:http')
  .createServer((_req, res) => res.end('OK'))
  .listen(process.env.PORT || 3000);

bot.catch((err) => console.error('Bot xatosi:', err.message));
bot.start({
  allowed_updates: ['message', 'business_connection', 'business_message', 'edited_business_message'],
});
console.log('AI bot ishga tushdi');