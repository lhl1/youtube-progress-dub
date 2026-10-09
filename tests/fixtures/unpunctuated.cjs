// Transcribed from the user's screenshot; timings/row breaks are reconstructed.
const sentences=[
  'but then I thought well if this was an actual Nintendo event then it was probably promoted on their website',
  'so I checked the captures from around the time the game released April 1999 and noticed something at the bottom of the page Super Smash Bros live',
  'upon clicking it open was greeted with text that described a battle taking place on Saturday between the Nintendo characters who appeared in the mascot photo',
  'then right beneath that description was a link to watch a rebroadcast'
];
const text=sentences.join(' ');
const chinese=[
  '但后来我想，如果这真是一场任天堂活动，那他们很可能在官网上宣传过。',
  '于是我查看了游戏在1999年4月发行前后的网站存档，发现页面底部有“任天堂明星大乱斗直播”的内容。',
  '点开后，我看到一段文字，介绍周六由吉祥物合照中的任天堂角色参加的一场对战。',
  '就在这段说明下面，还有一个观看重播的链接。'
];
const words=text.split(' '),rows=[];
for(let i=0;i<words.length;i+=9)rows.push({start:i*.24,end:Math.min(words.length,i+9)*.24,text:words.slice(i,i+9).join(' ')});
module.exports={text,sentences,chinese,rows};
