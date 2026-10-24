"""User-facing approach summary and observable execution receipts, never raw thinking."""
import time

SUMMARY_OPEN = '<approach_summary>'
SUMMARY_CLOSE = '</approach_summary>'

class ResponseParts:
    def __init__(self):
        self.pending = ''
        self.mode = 'detect'

    def feed(self, text, final=False):
        self.pending += text
        out=[]
        if self.mode == 'detect':
            self.pending=self.pending.lstrip()
            if self.pending.startswith(SUMMARY_OPEN):
                self.pending=self.pending[len(SUMMARY_OPEN):]
                self.mode='summary'
            elif not SUMMARY_OPEN.startswith(self.pending) or final:
                self.mode='answer'
            else:return out
        if self.mode=='summary':
            if SUMMARY_CLOSE in self.pending:
                summary, self.pending=self.pending.split(SUMMARY_CLOSE,1)
                out.append(('summary',summary.strip()))
                self.mode='answer'
            elif final or len(self.pending)>2000:
                # A malformed explanation is not silently discarded.
                self.mode='answer'
            else:return out
        if self.mode=='answer' and self.pending:
            out.append(('delta',self.pending))
            self.pending=''
        return out

def content_text(chunk):
    content=chunk.content
    if isinstance(content,str):return content
    # Thinking/signature blocks from providers are deliberately not exposed.
    return ''.join(b.get('text','') for b in content if isinstance(b,dict) and b.get('type')=='text')

def tick():return int(time.time()*1000)
