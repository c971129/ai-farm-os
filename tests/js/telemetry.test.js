const test = require('node:test');
const assert = require('node:assert/strict');
const {esc, chart, quality, csvCell, cards} = require('../../frontend/assets/telemetry.js');
test('untrusted vendor text is escaped in cards and exports', () => {
  assert.equal(esc('<img onerror="bad">'), '&lt;img onerror=&quot;bad&quot;&gt;');
  assert.equal(csvCell('=cmd()'), '"\'=cmd()"');
  const html = cards([{name:'<script>',did:'x',online:'在线',location:'未知',readings:[]}],false);
  assert.ok(!html.includes('<script>'));
});
test('zero and expired data retain visible warnings', () => {
  assert.equal(quality({quality:'CHECK_ZERO'}),'零值待核查');
  assert.equal(quality({quality:'UNVERIFIED',stale:true}),'数据已过期');
});
test('device cards hide expired observations while retaining fresh observations', () => {
  const html = cards([{
    name:'土壤墒情', did:'soil-1', online:'在线', location:'未绑定地块',
    readings:[
      {name:'过期土壤温度', formatted:'0.0℃', stale:true, quality:'CHECK_ZERO', sample_time:1},
      {name:'土壤湿度', formatted:'59.2%', stale:false, quality:'UNVERIFIED', sample_time:2},
    ],
  }], false);
  assert.ok(!html.includes('过期土壤温度'));
  assert.ok(!html.includes('0.0℃'));
  assert.ok(html.includes('土壤湿度'));
  assert.ok(html.includes('59.2%'));
  assert.ok(!html.includes('已隐去'));
});
test('abnormal vendor metrics stay out of visible cards', () => {
  const html = cards([{
    name:'土壤墒情', did:'soil-1', online:'在线', location:'未绑定地块',
    readings:[
      {property:'0x05wzktrhum', name:'0x05wzktrhum', formatted:'56%', stale:false, sample_time:2},
      {property:'0x05wzktrtem', name:'0x05wzktrtem', formatted:'25℃', stale:false, sample_time:2},
      {property:'AiMiwd', name:'土壤温度', formatted:'24℃', stale:false, sample_time:2},
    ],
  }], false);
  assert.ok(!html.includes('0x05wzktrhum'));
  assert.ok(!html.includes('0x05wzktrtem'));
  assert.ok(html.includes('土壤温度'));
});
test('pest device cards show recognition count species and image', () => {
  const html = cards([{
    name:'虫情设备C3', did:'pest-1', product_id:'InfestationReportC3', online:'在线', location:'未绑定地块',
    readings:[
      {property:'pestCount', name:'识别虫量', formatted:'12 头', value:12, stale:false, sample_time:2},
      {property:'pestSpecies', name:'识别种类', formatted:'沫蝉×1', value:'沫蝉×1', stale:false, sample_time:2},
      {property:'pestImage', name:'识别图片', formatted:'有图', value:'https://store.senoiot.cn/a.jpg', stale:false, sample_time:2},
      {property:'mode', name:'运行模式', formatted:'自动模式', stale:false, sample_time:2},
    ],
  }], false);
  assert.ok(html.includes('tl-pest'));
  assert.ok(html.includes('识别虫量'));
  assert.ok(html.includes('12 头'));
  assert.ok(html.includes('沫蝉×1'));
  assert.ok(html.includes('src="https://store.senoiot.cn/a.jpg"'));
  assert.ok(html.indexOf('识别虫量') < html.indexOf('运行模式'));
});
test('chart supports constant zero, negative values, enum and gaps', () => {
  const start = 1789700000000;
  const rows = [0,0,0].map((v,i)=>({name:'土温',numeric_value:v,sample_time:start+i*1000}));
  assert.ok(!/NaN|Infinity/.test(chart(rows)));
  assert.ok(chart([{...rows[0],numeric_value:-2}]).includes('<circle'));
  assert.ok(chart([{...rows[0],numeric_value:null}]).includes('暂无数值曲线'));
  assert.ok(chart([rows[0],{...rows[1],sample_time:start+600000}]).match(/d="M[^L]* M/));
});
