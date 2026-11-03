"""Preserve provider-returned reasoning on OpenAI-compatible channels."""
from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage,AIMessageChunk

class ObservableChatOpenAI(ChatOpenAI):
    def _convert_chunk_to_generation_chunk(self,chunk,default_chunk_class,base_generation_info):
        result=super()._convert_chunk_to_generation_chunk(chunk,default_chunk_class,base_generation_info)
        choices=chunk.get('choices',[]) or chunk.get('chunk',{}).get('choices',[])
        if result and choices and isinstance(result.message,AIMessageChunk):
            delta=choices[0].get('delta',{})
            text=delta.get('reasoning_content',delta.get('reasoning'))
            if isinstance(text,str):result.message.additional_kwargs['reasoning_content']=text
        return result
    def _create_chat_result(self,response,generation_info=None):
        result=super()._create_chat_result(response,generation_info)
        data=response if isinstance(response,dict) else response.model_dump()
        for choice,generation in zip(data.get('choices',[]),result.generations):
            msg=choice.get('message',{})
            text=msg.get('reasoning_content',msg.get('reasoning'))
            if isinstance(text,str):generation.message.additional_kwargs['reasoning_content']=text
        return result
    def _get_request_payload(self,input_,*,stop=None,**kwargs):
        messages=self._convert_input(input_).to_messages()
        result=super()._get_request_payload(input_,stop=stop,**kwargs)
        # Preserve protocol-required reasoning for tool continuation, not final-answer UI.
        for source,target in zip(messages,result.get('messages',[])):
            if isinstance(source,AIMessage) and source.tool_calls:
                text=source.additional_kwargs.get('reasoning_content')
                if text is not None:target['reasoning_content']=text
        return result
