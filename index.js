const Koa = require('koa');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const line = require('@line/bot-sdk');
const bodyParser = require('koa-bodyparser');
const { slice, each, map, chain, isNaN, toNumber, sample, min } = require('lodash');

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MAX_SHOP_LEN = 30;

// Dotenv
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

// Koa
const app = new Koa();
app.use(bodyParser());

// Mongoose
mongoose.connect(process.env.MONGODB_URI);

const shopSchema = new mongoose.Schema({
  name: String,
  sourceId: String,
  closed: [Number],
  rate: Number
});

const Shop = mongoose.model('shop', shopSchema);

// Line
const client = new line.Client({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
});

function replyMessage(replyToken, text) {
  client.replyMessage(replyToken, { type: 'text', text })
}

function parseShop({ name, closed, rate }) {
  const remark = [];
  if (closed.length) remark.push(`休：${map(closed, day => WEEKDAYS[day]).join('、')}`);
  remark.push(`機率：${rate}`);
  return `${name} （${remark.join('，')}）`; // space for url split
}

// Koa
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
  request.body?.events?.forEach(async ({ type, message, source, replyToken }) => {
    //t blocked or deleted // source.type === 'user'
    //t leaved group or nobody in group? // source.type === 'group'
    if (type === 'message') {
      const sourceId = source.userId || source.groupId;
      const cmd = message.text?.split(' ') || []; // prevent undefined error
      const name = cmd[1] || '';
      switch (cmd[0]) {
        case '戳':
          console.log(sourceId);
          replyMessage(replyToken, `戳屁戳（版本：v${require('./package.json').version}）`);
          break;
        case '有啥':
          replyMessage(replyToken,
            map(await Shop.find({ sourceId }), parseShop).join('\n') || '不知道（選項尚未建立）'); // timezone
          break;
        case '可吃':
          if (!name || await Shop.findOne({ name, sourceId })) {
            replyMessage(replyToken, `不要（${name} 建立失敗）`);
          } else if (name.length > MAX_SHOP_LEN) {
            replyMessage(replyToken, `不要（${slice(name, 0, 15).join('')}... 建立失敗）`);
          } else {
            let closed = [];
            let rate = 1;
            each(slice(cmd, 2), c => {
              switch (c[0]) {
                case '-':
                  closed = chain([...c].sort()).map(day => day % 7).sortedUniq().filter(day => !isNaN(day)).value();
                  break;
                case '.':
                  rate = toNumber(c) || 1;
                  break;
              }
            })
            const shop = new Shop({ name, sourceId, closed, rate });
            replyMessage(replyToken, `好（${parseShop(await shop.save())} 已建立）`);
          }
          break;
        case '吃啥':
          //t? help deciding
          const filterList = chain(cmd).filter(c => c[0] === '-').map(c => slice(c, 1).join('')).value();
          const shops = await Shop.find({ name: { $nin: filterList }, sourceId, closed: { $ne: new Date().getDay() } })
          let shop;
          do {
            shop = sample(shops);
          } while (shop && shop.rate < Math.random());
          replyMessage(replyToken, shop ? parseShop(shop) : '不知道（沒有選項）');
          break;
        case '不吃':
          replyMessage(replyToken,
            (await Shop.deleteOne({ name, sourceId })).deletedCount ? `不吃就不吃（${name} 已刪除）` : `你要確定欸（${name} 不存在）`);
          break;
        case '不吃了':
          await Shop.deleteMany({ sourceId });
          replyMessage(replyToken, '不吃就不吃（已清除）');
          break;
        case '怎麼吃':
          break;
        default:
          replyMessage(replyToken, '公鯊小');
          break;
      }
    }
  });
});

app.listen(process.env.PORT || 3000);
