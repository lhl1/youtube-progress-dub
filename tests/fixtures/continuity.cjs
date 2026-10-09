// User screenshot wording. Row timings are reconstructed for regression tests,
// not claimed to be exact word timings from the original YouTube transcript.
const rows = [
  {start:1504,end:1510,text:'There was more to do over there. When you stop playing it for so long you kind of forget about it until'},
  {start:1510,end:1516,text:'you see it like physically in front of your face. Yeah. See the stuff in person can bring back real'},
  {start:1516,end:1522,text:'memories. I learned a lot about Marcus in the hours we chatted. His crushing story paired'},
  {start:1522,end:1526,text:'with his optimism made me think.'}
];
const sentences = [
  'There was more to do over there.',
  'When you stop playing it for so long you kind of forget about it until you see it like physically in front of your face.',
  'Yeah.',
  'See the stuff in person can bring back real memories.',
  'I learned a lot about Marcus in the hours we chatted.',
  'His crushing story paired with his optimism made me think.'
];
const chinese = [
  '那里还有更多事情可以做。',
  '当你很久不玩它时，就会渐渐淡忘，直到亲眼看到它出现在面前，才会重新想起来。',
  '是的。',
  '亲眼看到这些东西，能唤起真实的回忆。',
  '在几小时的聊天中，我对马库斯有了很多了解。',
  '他令人心碎的经历与他的乐观相结合，让我陷入了思考。'
];
const longChinese = '当你很久没有玩这个游戏时，你会渐渐淡忘过去一起探索的地方和经历过的挑战，直到你亲眼看到它出现在面前，那些熟悉的场景和真实的回忆才会重新浮现，仿佛一下子又回到了从前。';
module.exports = {rows, sentences, chinese, longChinese};
