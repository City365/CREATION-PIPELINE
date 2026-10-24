"""Preserve valid empty thinking blocks returned by DeepSeek's Anthropic stream."""
from langchain_anthropic import ChatAnthropic

class PatchedChatAnthropic(ChatAnthropic):
    def _get_request_payload(self, input_, *, stop=None, **kwargs):
        payload=super()._get_request_payload(input_,stop=stop,**kwargs)
        for message in payload.get('messages',[]):
            content=message.get('content',[])
            if isinstance(content,list):
                for block in content:
                    if isinstance(block,dict) and block.get('type')=='thinking':
                        # A signature-only stream delta can omit the empty text field.
                        block.setdefault('thinking','')
        return payload
