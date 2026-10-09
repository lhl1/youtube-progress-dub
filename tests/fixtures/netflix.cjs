// User screenshot words retained, including ASR errors; reconstructed timings.
const sentences = [
  "the year is 2019 and an internet user going by the name the upstreamer is watching Netflix when he notices something shocking something he can't explain",
  'this anomaly he found is so strange and so specific that he immediately takes to Reddit to see if anyone else has noticed it',
  'he logs onto the Reddit board are Phantom Dust and writes the following post',
  "did anyone else see this on Netflix's Elite",
  'the pause menu shows up for a moment in season 2 episode 4',
  'and I was completely blown away poured one out'
];
const chinese = [
  '那是2019年，一位网名叫“上游者”的网友正在观看Netflix。他发现了一个让人震惊、却又无法解释的现象。',
  '他发现的这个异常既奇怪又具体，于是立即前往Reddit，想看看是否也有人注意到了。',
  '他登录了Reddit的“幻影尘埃”版块，并写下了这样一个帖子。',
  '还有人在Netflix的《精英》中看到这一幕吗？',
  '第2季第4集里，暂停菜单出现了一会儿。',
  '我完全惊呆了，还为此倒了一杯酒。'
];
const text=sentences.join(' '),words=text.split(' '),rows=[];
for(let i=0;i<words.length;i+=7)rows.push({start:i*.25,end:Math.min(words.length,i+7)*.25,text:words.slice(i,i+7).join(' ')});
module.exports={sentences,chinese,text,rows};
