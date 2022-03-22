const Koa = require('koa');
const path = require('path');
const crypto = require('crypto');
const line = require('@line/bot-sdk');
const bodyParser = require('koa-bodyparser');

require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const app = new Koa();
app.use(bodyParser());

const client = new line.Client({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
});

function replyMessage(replyToken, text) {
  client.replyMessage(replyToken, { type: 'text', text })
}

app.use(async ({ method, status }, next) => {
  try {
    if (method !== 'POST') throw '';
    await next();
  } catch {
    status = 404;
  }
});

app.use(async ({ request }, next) => {
  const signature = crypto
    .createHmac('SHA256', process.env.CHANNEL_SECRET)
    .update(JSON.stringify(request.body)).digest('base64');

  if (request.header['x-line-signature'] !== signature) throw '';
  await next();
});

app.use(async ({ request }) => {
  request.body?.events?.forEach(({ type, message, replyToken }) => {
    // source.type user/group source.userId/source.groupId
    if (type === 'message') {
      const { text } = message;
      const cmd = text.split(' ');
      switch (cmd[0]) {
        case '戳':
          replyMessage(replyToken, '戳屁戳');
          break;
        case '有啥':
          replyMessage(replyToken, '沒有');
          break;
        case '可吃':
          // cmd[1], cmd[2]
          replyMessage(replyToken, '好');
          break;
        case '吃啥':
          replyMessage(replyToken, '不知道');
          break;
      }
    }
  });
});

app.listen(process.env.PORT || 3000);
