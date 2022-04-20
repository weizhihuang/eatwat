const Koa = require('koa');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const line = require('@line/bot-sdk');
const bodyParser = require('koa-bodyparser');
const { each, map, chain, toNumber, sample, pick, slice } = require('lodash');

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MAX_SHOP_NAME_LEN = 30;

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
  if (text)
    client.replyMessage(replyToken, { type: 'text', text });
}

function parseShop({ name, closed, rate }) {
  const remark = [];
  if (closed.length) remark.push(`休：${map(closed, day => WEEKDAYS[day]).join('、')}`);
  remark.push(`機率：${rate}`);
  return `${name} （${remark.join('，')}）`; // space for url split
}

function handleParams(params) {
  let closed = [];
  let rate = 1;

  chain(params).slice(2).each(param => {
    switch (param[0]) {
      case '-':
        closed = chain(param).map(day => day % 7).uniq().filter(day => !isNaN(day)).value();
        break;
      case '.':
        rate = toNumber(param) || rate;
        break;
    }
  }).value();

  return { closed, rate };
}

// Koa
app.use(async ({ method }, next) => {
  if (method !== 'POST') return;
  await next();
});

app.use(async ({ request }, next) => {
  const signature = crypto
    .createHmac('SHA256', process.env.CHANNEL_SECRET)
    .update(JSON.stringify(request.body)).digest('base64');
  if (request.header['x-line-signature'] !== signature) return;
  await next();
});

app.use(async ctx => {
  each(ctx.request.body?.events, async ({ type, message, source, replyToken }) => {
    const sourceId = source.groupId || source.userId;
    switch (type) {
      case 'message':
        replyMessage(replyToken, (await Promise.all(map(message.text?.split('\n'), async text => {
          const params = chain(text).split(' ').filter(Boolean).value();
          const cmd = params[0];
          const name = params[1] || '';

          switch (cmd) {
            case '戳':
              console.log(sourceId);
              return `戳屁戳（版本：v${require('./package.json').version}）`;
            case '有啥':
              return map(await Shop.find({ sourceId }), parseShop).join('\n') || '不知道（選項尚未建立）';
            case '今天有啥':
              return map(await Shop.find({ sourceId, closed: { $ne: new Date().getDay() } }), parseShop).join('\n') || '不知道（選項尚未建立）'; //! timezone
            case '可吃':
              if (!name || await Shop.findOne({ name, sourceId })) {
                return `不要（${name} 建立失敗）`;
              } else if (name.length > MAX_SHOP_NAME_LEN) {
                return `不要（${name.slice(0, 15)}... 建立失敗）`;
              } else {
                const shop = new Shop({ name, sourceId, ...handleParams(params) });
                return `好（${parseShop(await shop.save())} 已建立）`;
              }
            case '吃啥':
              const filterList = chain(params).filter(param => param[0] === '-').map(param => param.slice(1)).value();
              const shops = await Shop.find({ name: { $nin: filterList }, sourceId, closed: { $ne: new Date().getDay() } }) //! timezone
              let shop;
              do {
                shop = sample(shops);
              } while (shop && shop.rate < Math.random());
              return shop ? parseShop(shop) : '不知道（沒有選項）';
            case '改吃':
              if ((await Shop.updateOne({ name, sourceId }, { $set: handleParams(params) })).modifiedCount)
                return `好（${parseShop(await Shop.findOne({ name, sourceId }))} 已更新）`;
              else
                return `不要（${name} 更新失敗）`;
            case '不吃':
              return (await Shop.deleteOne({ name, sourceId })).deletedCount ? `不吃就不吃（${name} 已刪除）` : `你要確定欸（${name} 不存在）`;
            case '不吃了':
              await Shop.deleteMany({ sourceId });
              return '不吃就不吃（已清除）';
            case '很匯':
              return map(await Shop.find({ sourceId }), shop => {
                const { name, closed, rate } = pick(shop, ['name', 'closed', 'rate']);
                return `可吃 ${name}${closed.length ? ' -' + closed.join('') : ''}${rate - 1 ? ' ' + rate.toString().slice(1) : ''}`;
              }).join('\n');
            case '要吃啥':
              return sample(slice(params, 1)) || '不知道（沒有選項）';
            case '怎麼吃':
              break;
            default:
              if (source.type === 'user')
                return '公鯊小';
              break;
          }
        }))).join('\n'));
        break;
        case 'unfollow':
        case 'leave':
          await Shop.deleteMany({ sourceId });
          break;
    }
  });
  ctx.status = 200;
});

app.listen(process.env.PORT || 3000);
