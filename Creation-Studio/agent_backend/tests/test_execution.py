from types import SimpleNamespace
from app.execution import ResponseParts, content_text

def test_split_summary_tags_stream_correctly():
 parser=ResponseParts()
 events=[]
 for chunk in ['<appro','ach_summary>依据提问','整理方法。</approach_','summary>## 结论','\n正文']:
  events.extend(parser.feed(chunk))
 events.extend(parser.feed('',final=True))
 assert [v for k,v in events if k=='summary']==['依据提问整理方法。']
 assert ''.join(v for k,v in events if k=='delta')=='## 结论\n正文'

def test_plain_answer_and_unclosed_tag_are_preserved():
 for text in ['正常回复','<approach_summary>说明未结束']:
  parser=ResponseParts()
  events=parser.feed(text)+parser.feed('',final=True)
  assert ''.join(v for k,v in events if k=='delta')==text.replace('<approach_summary>','')

def test_private_thinking_blocks_are_not_exposed():
 chunk=SimpleNamespace(content=[{'type':'thinking','thinking':'private internal chain'}, {'type':'text','text':'公开说明'}])
 assert content_text(chunk)=='公开说明'
